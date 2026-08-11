'use client'
// Central de Mensagens — LISTA de conversas. O detalhe de uma conversa NAO mora aqui.
//
// O painel de detalhe vivia inline nesta pagina (cabecalho de prioridade comercial, abas
// Conversa/Interesses, feedback por mensagem, compositor do operador, pausar/retomar agente,
// reenviar WhatsApp, deletar historico). Enquanto isso, o "Abrir conversa" da fila de
// Follow-ups abria um modal somente-leitura: mesma conversa, mesmas permissoes, experiencia
// diferente. O painel foi extraido para `components/ConversaPainel.tsx` e as duas telas
// passaram a ser apenas PORTAS DE ENTRADA para ele.
//
// O que sobra aqui: encontrar a conversa (busca, filtros de temperatura, alerta de leads
// esfriando) e remover o contato. A partir do clique em "Histórico", quem manda e o painel.
import { useEffect, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconTrash } from '@/components/ui/icons'
import ConversaPainel, {
  InteresseBadge,
  TempBadge,
  scoreValue,
  type ConversaResumo,
} from '@/components/ConversaPainel'
import { identidadeConversa, nomeColunaLead } from '@/lib/lead-identidade'
import AlternadorModoIa from '@/components/ui/AlternadorModoIa'
import {
  ajudaPadraoGlobal,
  descreverModo,
  houveMudancaDeModo,
  normalizarModo,
  opcoesDeModo,
  rotuloAcessivelPadrao,
} from '@/lib/conversa-modo-ia'
import type { ModoIa } from '@/lib/conversa-modo-ia'

type Conversa = ConversaResumo

function fmtData(s?: string): string {
  if (!s) return ''
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

type Faixa = 'quente' | 'morno' | 'frio'

const FILTRO_META: Record<Faixa, { label: string; chip: string }> = {
  quente: { label: '🔥 Quentes', chip: 'border-orange-500 bg-orange-50 text-orange-700' },
  morno: { label: '🌤️ Mornos', chip: 'border-amber-500 bg-amber-50 text-amber-700' },
  frio: { label: '❄️ Frios', chip: 'border-sky-400 bg-sky-50 text-sky-700' },
}

// Classifica a conversa em quente/morno/frio combinando a temperatura comercial do
// perfil com o score de interesse (fallback quando a temperatura ainda não foi definida).
function classificar(c: Conversa): Faixa {
  const t = c.temperatura_lead
  if (t === 'quente' || t === 'morno' || t === 'frio') return t
  const f = c.score_interesse_faixa
  if (f === 'alto') return 'quente'
  if (f === 'medio') return 'morno'
  return 'frio'
}

function normTitulo(s?: string): string {
  return String(s || '').toLowerCase()
}

// "Esfriando": o lead demonstrou calor (temperatura quente, etapa avançada ou sinais
// de compra) mas surgiram sinais de resfriamento (silêncio, adiamento ou recusa).
function esfriando(c: Conversa): boolean {
  const crit = c.score_interesse_criterios || []
  const teveCalor =
    c.temperatura_lead === 'quente' ||
    ['proposta', 'fechamento', 'handoff', 'reuniao_agendada'].includes(c.estagio) ||
    crit.some((x) => x.delta > 0 && /(preco|proximo passo|reuniao|urgencia|etapa comercial avancada)/.test(normTitulo(x.titulo)))
  const esfriou = crit.some((x) => x.delta < 0 && /(sem resposta|postergou|recusou)/.test(normTitulo(x.titulo)))
  return teveCalor && esfriou
}

export default function ConversasPage() {
  const [lista, setLista] = useState<Conversa[]>([])
  const [erro, setErro] = useState('')
  // Guarda so o NUMERO: quem carrega a conversa e o painel, que assim garante estado de
  // carregando, erro com "Tentar de novo" e a troca rapida entre conversas sem vazamento.
  const [numeroAberto, setNumeroAberto] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'todos' | Faixa | 'esfriando'>('todos')
  const [buscaNumero, setBuscaNumero] = useState('')
  const [carregandoLista, setCarregandoLista] = useState(true)
  // Padrao GLOBAL da IA (app.empresas.config.modo_ia_padrao). `null` = ainda carregando:
  // desenhar "Conversa" antes de saber mostraria um estado que talvez nao seja o real.
  const [modoPadrao, setModoPadrao] = useState<ModoIa | null>(null)
  const [alterandoPadrao, setAlterandoPadrao] = useState(false)
  const requisicaoLista = useRef(0)
  const fb = useFeedback()

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function carregar(numeroBuscado = buscaNumero) {
    if (!empresaId) return
    const requisicao = ++requisicaoLista.current
    const numero = numeroBuscado.replace(/\D/g, '').slice(0, 20)
    const params = new URLSearchParams({ limit: '100' })
    if (numero) params.set('numero', numero)

    setCarregandoLista(true)
    setErro('')
    apiFetch<Conversa[]>(`/api/empresas/${empresaId}/conversas?${params.toString()}`)
      .then((r) => {
        if (requisicao === requisicaoLista.current) setLista(r.data)
      })
      .catch((e) => {
        if (requisicao === requisicaoLista.current) setErro(e.message)
      })
      .finally(() => {
        if (requisicao === requisicaoLista.current) setCarregandoLista(false)
      })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => carregar(buscaNumero), 300)
    return () => window.clearTimeout(timer)
  }, [empresaId, buscaNumero])

  // O padrao global e' carregado uma vez, fora do ciclo da busca: ele nao depende de filtro
  // nem de texto digitado. Falha aqui NAO vira erro na tela — a lista de conversas continua
  // util sem o controle, e um alarme vermelho no topo diria que a Central quebrou.
  useEffect(() => {
    if (!empresaId) return
    let vivo = true
    apiFetch<{ modo: string }>(`/api/empresas/${empresaId}/modo-ia-padrao`)
      .then((r) => { if (vivo) setModoPadrao(normalizarModo(r.data.modo)) })
      .catch(() => { /* sem controle global; o resto da tela segue */ })
    return () => { vivo = false }
  }, [empresaId])

  /**
   * OTIMISTA com reversao, como no painel: o efeito vale para mensagens futuras e esperar a
   * rede faria o operador clicar duas vezes. Falhou, volta ao valor anterior — a tela nunca
   * pode afirmar "Análise" enquanto o motor continua respondendo.
   */
  async function alterarModoPadrao(novo: ModoIa) {
    if (!empresaId || alterandoPadrao) return
    const anterior = modoPadrao
    if (!houveMudancaDeModo(anterior, novo)) return
    setAlterandoPadrao(true)
    setModoPadrao(novo)
    try {
      const r = await fb.runTask(
        () => apiFetch<{ modo: string }>(`/api/empresas/${empresaId}/modo-ia-padrao`, {
          method: 'PATCH',
          body: JSON.stringify({ modo: novo }),
        }),
        { sucesso: `Modo padrão da Central: ${descreverModo(novo).rotulo}.` }
      )
      setModoPadrao(normalizarModo(r.data.modo))
    } catch {
      setModoPadrao(anterior)
    } finally {
      setAlterandoPadrao(false)
    }
  }

  async function removerConversa(c: Conversa) {
    if (!empresaId) return
    const identidade = identidadeConversa(c)
    if (!confirm(`Remover ${identidade.titulo} do banco?\n\nIsso apaga a conversa, perfil do lead e insights. Ação irreversível.`)) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`, { method: 'DELETE' }),
        { sucesso: 'Conversa removida.' })
      setLista((prev) => prev.filter((x) => x.numero !== c.numero))
      if (numeroAberto === c.numero) setNumeroAberto(null)
    } catch { /* erro já exibido pelo feedback */ }
  }

  // Classifica cada conversa (faixa quente/morno/frio) e marca as que estão esfriando.
  const enriquecidas = lista.map((c) => ({ c, faixa: classificar(c), alerta: esfriando(c) }))
  const cont = {
    todos: enriquecidas.length,
    quente: enriquecidas.filter((x) => x.faixa === 'quente').length,
    morno: enriquecidas.filter((x) => x.faixa === 'morno').length,
    frio: enriquecidas.filter((x) => x.faixa === 'frio').length,
    esfriando: enriquecidas.filter((x) => x.alerta).length,
  }
  const visiveis = enriquecidas
    .filter((x) => (filtro === 'todos' ? true : filtro === 'esfriando' ? x.alerta : x.faixa === filtro))
    // Mais quente primeiro: maior score de interesse no topo.
    .sort((a, b) => (scoreValue(b.c.score_interesse) ?? -1) - (scoreValue(a.c.score_interesse) ?? -1))

  const FILTROS: { valor: 'todos' | Faixa | 'esfriando'; label: string; n: number }[] = [
    { valor: 'todos', label: 'Todos', n: cont.todos },
    { valor: 'quente', label: FILTRO_META.quente.label, n: cont.quente },
    { valor: 'morno', label: FILTRO_META.morno.label, n: cont.morno },
    { valor: 'frio', label: FILTRO_META.frio.label, n: cont.frio },
    { valor: 'esfriando', label: '⚠️ Esfriando', n: cont.esfriando },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Conversas</h1>
          <p className="mt-1 text-sm text-slate-500">Encontre um contato e acompanhe o histórico do atendimento.</p>
        </div>
        {/* Padrao GLOBAL da IA. So aparece depois de carregado: um controle que mostra
            "Conversa" antes de saber o valor real e' pior que controle nenhum.
            Padrao compacto de controle de ativacao: NOME + icone de informacao + controle.
            O estado por extenso e os dois paragrafos fixos sairam — a opcao marcada JA e' o
            estado, e a consequencia + o limite das excecoes vivem no balao (`ajudaPadraoGlobal`)
            e no `aria-label`, sem ocupar espaco permanente no topo da tela. */}
        {modoPadrao && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Modo padrão da IA</span>
            <AlternadorModoIa
              opcoes={opcoesDeModo()}
              selecionado={modoPadrao}
              onMudar={(id) => alterarModoPadrao(id as ModoIa)}
              ocupado={alterandoPadrao}
              compacto
              ajuda={ajudaPadraoGlobal(modoPadrao)}
              ariaLabel={rotuloAcessivelPadrao(modoPadrao)}
            />
          </div>
        )}
      </div>
      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {cont.esfriando > 0 && (
        <button
          onClick={() => setFiltro('esfriando')}
          className="flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left transition hover:bg-red-100"
        >
          <span className="text-xl">⚠️</span>
          <span className="text-sm text-red-800">
            <strong>{cont.esfriando} lead{cont.esfriando > 1 ? 's' : ''} esfriando</strong> — mostrou interesse mas começou a
            perder calor (silêncio, adiamento ou recusa). Clique para ver e intervir.
          </span>
        </button>
      )}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4">
          <div className="min-w-[240px] flex-1 sm:max-w-xl">
            <label htmlFor="busca-numero" className="mb-1 block text-xs font-medium text-slate-500">Pesquisar número</label>
            <div className="relative">
              <input
                id="busca-numero"
                type="search"
                inputMode="tel"
                value={buscaNumero}
                onChange={(e) => setBuscaNumero(e.target.value)}
                placeholder="Ex.: (11) 99999-9999"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
              {buscaNumero && (
                <button
                  type="button"
                  onClick={() => setBuscaNumero('')}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-brand"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
          <p className="pb-2 text-xs text-slate-500" aria-live="polite">
            {carregandoLista ? 'Buscando conversas…' : `${visiveis.length} conversa${visiveis.length === 1 ? '' : 's'} encontrada${visiveis.length === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b bg-slate-50/60 px-4 py-3">
          {FILTROS.map((f) => {
            const ativo = filtro === f.valor
            const isAlerta = f.valor === 'esfriando'
            return (
              <button
                key={f.valor}
                onClick={() => setFiltro(f.valor)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  ativo
                    ? isAlerta ? 'border-red-600 bg-red-600 text-white' : 'border-brand bg-brand text-white'
                    : isAlerta ? 'border-red-200 bg-white text-red-600 hover:bg-red-50' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {f.label} <span className={ativo ? 'opacity-80' : 'text-slate-400'}>({f.n})</span>
              </button>
            )
          })}
        </div>

        <DataTableFrame
          className="rounded-b-2xl"
          ariaLabel="Rolagem horizontal da tabela de conversas"
        >
      <table className="w-full min-w-max text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
          <tr>
            <th className="text-left px-4 py-2">Lead</th>
            <th className="text-left px-4 py-2">Telefone</th>
            <th className="text-left px-4 py-2">Temperatura</th>
            <th className="text-left px-4 py-2">Interesse</th>
            <th className="text-left px-4 py-2">Estágio</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-right px-4 py-2">Atualizado</th>
            <th className="text-right px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {carregandoLista ? (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Buscando conversas…</td></tr>
          ) : visiveis.map(({ c, alerta }) => {
            // Coluna Lead = SÓ nome (resolvido no backend: WhatsApp → Google Maps → vazio).
            // O telefone tem coluna própria ao lado; repeti-lo aqui seria o mesmo dado duas
            // vezes na linha. `identidade` continua servindo a coluna Telefone e a confirmação
            // de remoção, onde o telefone é a identificação de segurança.
            const identidade = identidadeConversa(c)
            const nomeLead = nomeColunaLead(c)
            return (
            <tr key={c.numero} className={`hover:bg-slate-50/70 ${alerta ? 'bg-red-50/60' : ''}`}>
              <td className="px-4 py-3 font-medium text-slate-800">{nomeLead}</td>
              <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600">{identidade.telefone || '—'}</td>
              <td className="px-4 py-3">
                <div className="inline-flex items-center gap-1.5">
                  <TempBadge t={c.temperatura_lead} />
                  {alerta && <span title="Era quente e está esfriando — intervir" className="text-sm">⚠️</span>}
                </div>
              </td>
              <td className="px-4 py-3"><InteresseBadge c={c} compact /></td>
              <td className="px-4 py-3">{c.estagio}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.status}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-gray-500">
                {fmtData(c.atualizado_em)}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => setNumeroAberto(c.numero)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
                  >
                    Histórico
                  </button>
                  <button
                    onClick={() => removerConversa(c)}
                    title="Remover contato e dados deste número"
                    aria-label="Remover"
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5 transition-colors"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
            )
          })}
          {!carregandoLista && visiveis.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">
              {buscaNumero.replace(/\D/g, '')
                ? 'Nenhuma conversa encontrada para esse número.'
                : lista.length === 0 ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa neste filtro.'}
            </td></tr>
          )}
        </tbody>
      </table>
        </DataTableFrame>
      </section>

      {numeroAberto && (
        <ConversaPainel
          empresaId={empresaId}
          numero={numeroAberto}
          onFechar={() => setNumeroAberto(null)}
          onAtualizou={() => carregar()}
        />
      )}
    </div>
  )
}
