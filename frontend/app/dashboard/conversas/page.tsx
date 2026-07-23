'use client'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconSend, IconStar, IconThumbDown, IconThumbUp, IconTrash } from '@/components/ui/icons'

type ScoreCriterio = {
  delta: number
  titulo: string
  detalhe?: string
  tipo?: 'positivo' | 'negativo' | 'neutro'
}

type Conversa = {
  numero: string
  estagio: string
  status: string
  negocio?: string
  temperatura_lead?: string | null
  score_dor?: number | null
  score_lead?: number | null
  score_interesse?: number | null
  score_interesse_faixa?: 'alto' | 'medio' | 'baixo' | string | null
  score_interesse_label?: string | null
  score_interesse_resumo?: string | null
  score_interesse_criterios?: ScoreCriterio[]
  score_interesse_mensagens_lead?: number | null
  evolution_instance?: string | null
  atualizado_em: string
}

const TEMP_STYLE: Record<string, { label: string; cls: string }> = {
  quente: { label: '🔥 Quente', cls: 'bg-orange-100 text-orange-700' },
  morno: { label: '🌤️ Morno', cls: 'bg-amber-100 text-amber-700' },
  frio: { label: '❄️ Frio', cls: 'bg-sky-100 text-sky-700' },
}

function TempBadge({ t }: { t?: string | null }) {
  if (!t || !TEMP_STYLE[t]) return <span className="text-gray-400 text-xs">—</span>
  return <span className={`px-2 py-0.5 rounded-full text-xs ${TEMP_STYLE[t].cls}`}>{TEMP_STYLE[t].label}</span>
}
const INTERESSE_STYLE: Record<string, { cls: string; text: string }> = {
  alto: { cls: 'border-emerald-500 bg-emerald-50 text-emerald-700', text: 'Alto' },
  medio: { cls: 'border-amber-500 bg-amber-50 text-amber-700', text: 'Medio' },
  baixo: { cls: 'border-slate-400 bg-slate-50 text-slate-600', text: 'Baixo' },
}

function scoreValue(score?: number | null) {
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
}

function InteresseBadge({ c, compact = false }: { c: Pick<Conversa, 'score_interesse' | 'score_interesse_faixa' | 'score_interesse_label' | 'score_interesse_resumo'>; compact?: boolean }) {
  const score = scoreValue(c.score_interesse)
  const faixa = c.score_interesse_faixa && INTERESSE_STYLE[c.score_interesse_faixa] ? c.score_interesse_faixa : 'baixo'
  const st = INTERESSE_STYLE[faixa]
  const label = c.score_interesse_label || `Interesse ${st.text.toLowerCase()}`
  if (compact) {
    return (
      <span
        title={`${label}${c.score_interesse_resumo ? ` - ${c.score_interesse_resumo}` : ''}`}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${st.cls}`}
      >
        {score ?? '--'}
      </span>
    )
  }
  return (
    <div className="inline-flex min-w-0 items-center gap-2">
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${st.cls}`}>
        {score ?? '--'}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-500">{c.score_interesse_resumo || 'Sem resumo disponivel'}</div>
      </div>
    </div>
  )
}

function criterioDelta(c: ScoreCriterio) {
  if (!c.delta) return '0'
  return c.delta > 0 ? `+${c.delta}` : String(c.delta)
}

function criterioClasse(c: ScoreCriterio) {
  if (c.delta > 0) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (c.delta < 0) return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-500 border-gray-200'
}

type Mensagem = { role?: string; content?: string; text?: string; timestamp?: string }
type ConversaDetail = Conversa & {
  historico?: Mensagem[]
  agente_pausado?: boolean
  ultima_falha_resposta_codigo?: string | null
  ultima_falha_resposta_msg?: string | null
  ultima_falha_resposta_em?: string | null
}

type OrientacaoResposta = {
  explicacao: string
  resposta: string
  confianca?: 'alta' | 'media' | 'baixa' | string
  alertas?: string[]
}

type FeedbackTipo = 'positivo' | 'negativo'
type FeedbackState = {
  tipo?: FeedbackTipo
  enviando?: boolean
  feedback_id?: string
  sugestao_id?: string | null
  criou_sugestao?: boolean
}
type FeedbackResponse = {
  feedback_id: string
  tipo: FeedbackTipo
  criou_sugestao: boolean
  sugestao_id: string | null
  contexto_versao_id: string | null
}

const FEEDBACK_TAGS = [
  { id: 'tom_ruim', label: 'Tom ruim' },
  { id: 'nao_respondeu', label: 'Nao respondeu' },
  { id: 'inventou_informacao', label: 'Inventou info' },
  { id: 'preco_link_errado', label: 'Preco/link errado' },
  { id: 'repetiu_pergunta', label: 'Repetiu pergunta' },
  { id: 'fora_do_contexto', label: 'Fora do contexto' },
] as const

function fmtNumero(n: string): string {
  return String(n || '').replace('@s.whatsapp.net', '').replace(/^(\d{2})(\d{2})(\d)(\d{4})(\d{4})$/, '+$1 ($2) $3$4-$5')
}

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
  const [aberta, setAberta] = useState<ConversaDetail | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [mensagemManual, setMensagemManual] = useState('')
  const [enviandoManual, setEnviandoManual] = useState(false)
  const [alterandoPausa, setAlterandoPausa] = useState(false)
  const [composerAberto, setComposerAberto] = useState(false)
  const [orientandoResposta, setOrientandoResposta] = useState(false)
  const [orientacaoResposta, setOrientacaoResposta] = useState<OrientacaoResposta | null>(null)
  const [abaModal, setAbaModal] = useState<'chat' | 'interesses'>('chat')
  const [filtro, setFiltro] = useState<'todos' | Faixa | 'esfriando'>('todos')
  const [buscaNumero, setBuscaNumero] = useState('')
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [feedbacksMensagem, setFeedbacksMensagem] = useState<Record<number, FeedbackState>>({})
  const [feedbackNegativo, setFeedbackNegativo] = useState<{ index: number; observacao: string; tags: string[] } | null>(null)
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

  async function removerConversa(c: Conversa) {
    if (!empresaId) return
    if (!confirm(`Remover ${fmtNumero(c.numero)} do banco?\n\nIsso apaga a conversa, perfil do lead e insights. Ação irreversível.`)) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`, { method: 'DELETE' }),
        { sucesso: 'Conversa removida.' })
      setLista((prev) => prev.filter((x) => x.numero !== c.numero))
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function abrirHistorico(c: Conversa) {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    setMensagemManual('')
    setOrientacaoResposta(null)
    setComposerAberto(false)
    setAbaModal('chat')
    setFeedbacksMensagem({})
    setFeedbackNegativo(null)
    try {
      const r = await apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`)
      setAberta(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar histórico.')
    } finally {
      setCarregando(false)
    }
  }

  function fecharHistorico() {
    setAberta(null)
    setMensagemManual('')
    setOrientacaoResposta(null)
    setComposerAberto(false)
    setAbaModal('chat')
    setFeedbacksMensagem({})
    setFeedbackNegativo(null)
  }

  async function deletarHistorico() {
    if (!aberta || !empresaId) return
    if (!confirm(`Apagar TODO o histórico de ${fmtNumero(aberta.numero)}?\n\nIsso limpa as mensagens, reseta o estágio e despausa o agente. A próxima mensagem do contato vai começar do zero.\n\nAção irreversível.`)) return
    setApagando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/historico`, { method: 'DELETE' }),
        { sucesso: 'Histórico apagado.' })
      setAberta((p) => p ? { ...p, historico: [], estagio: 'primeiro_contato' } : p)
      await new Promise((r) => setTimeout(r, 200))
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setApagando(false) }
  }

  async function reenviarUltimaResposta() {
    if (!aberta || !empresaId) return
    setReenviando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/reprocessar`, { method: 'POST' }),
        { sucesso: 'Resposta reenviada.' })
      setAberta((p) => p ? {
        ...p,
        ultima_falha_resposta_codigo: null,
        ultima_falha_resposta_msg: null,
        ultima_falha_resposta_em: null,
      } : p)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setReenviando(false) }
  }

  async function enviarMensagemOperador() {
    if (!aberta || !empresaId) return
    const texto = mensagemManual.trim()
    if (!texto) {
      fb.toast('Escreva a mensagem antes de enviar.', 'error')
      return
    }
    setEnviandoManual(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/mensagem`, {
          method: 'POST',
          body: JSON.stringify({ texto, assumir: true }),
        }),
        { sucesso: 'Mensagem enviada e conversa assumida.' }
      )
      setAberta((p) => p ? {
        ...p,
        ...r.data,
        historico: r.data.historico || p.historico,
        agente_pausado: true,
      } : p)
      setMensagemManual('')
      setOrientacaoResposta(null)
      setComposerAberto(false)
      carregar()
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setEnviandoManual(false) }
  }

  async function orientarResposta() {
    if (!aberta || !empresaId) return
    setOrientandoResposta(true)
    setComposerAberto(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<OrientacaoResposta>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/orientador-resposta`, {
          method: 'POST',
          body: JSON.stringify({ rascunho: mensagemManual.trim() }),
        }),
        { sucesso: 'Resposta orientada.' }
      )
      setOrientacaoResposta(r.data)
      setMensagemManual(r.data.resposta || '')
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setOrientandoResposta(false) }
  }

  async function alterarPausaAgente(pausado: boolean) {
    if (!aberta || !empresaId) return
    setAlterandoPausa(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/agente`, {
          method: 'PATCH',
          body: JSON.stringify({ pausado }),
        }),
        { sucesso: pausado ? 'Agente pausado nesta conversa.' : 'Agente retomado nesta conversa.' }
      )
      setAberta((p) => p ? { ...p, ...r.data, agente_pausado: r.data.agente_pausado } : p)
      carregar()
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setAlterandoPausa(false) }
  }

  function toggleFeedbackTag(tag: string) {
    setFeedbackNegativo((atual) => {
      if (!atual) return atual
      const tags = atual.tags.includes(tag)
        ? atual.tags.filter((t) => t !== tag)
        : [...atual.tags, tag]
      return { ...atual, tags }
    })
  }

  async function enviarFeedbackMensagem(index: number, tipo: FeedbackTipo, dados?: { observacao?: string; tags?: string[] }) {
    if (!aberta || !empresaId) return
    const observacao = (dados?.observacao || '').trim()
    if (tipo === 'negativo' && !observacao) {
      fb.toast('Explique rapidamente o motivo do nao gostei.', 'error')
      return
    }
    setFeedbacksMensagem((prev) => ({ ...prev, [index]: { ...prev[index], tipo, enviando: true } }))
    try {
      const r = await fb.runTask(
        () => apiFetch<FeedbackResponse>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/feedback`, {
          method: 'POST',
          body: JSON.stringify({
            mensagem_index: index,
            tipo,
            observacao,
            tags: dados?.tags || [],
          }),
        }),
        { sucesso: tipo === 'positivo' ? 'Feedback registrado.' : 'Feedback registrado para revisao.' }
      )
      setFeedbacksMensagem((prev) => ({
        ...prev,
        [index]: {
          tipo,
          enviando: false,
          feedback_id: r.data.feedback_id,
          sugestao_id: r.data.sugestao_id,
          criou_sugestao: r.data.criou_sugestao,
        },
      }))
      if (tipo === 'negativo') setFeedbackNegativo(null)
    } catch {
      setFeedbacksMensagem((prev) => ({ ...prev, [index]: { ...prev[index], enviando: false } }))
    }
  }

  const historicoAberto = aberta?.historico || []
  const ultimaMensagemAberta = historicoAberto[historicoAberto.length - 1]
  const podeReenviarUltimaResposta = ultimaMensagemAberta?.role === 'assistant'
  const criteriosInteresse = aberta?.score_interesse_criterios || []

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
      <div>
        <h1 className="text-2xl font-bold">Conversas</h1>
        <p className="mt-1 text-sm text-slate-500">Encontre um contato e acompanhe o histórico do atendimento.</p>
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
            <th className="text-left px-4 py-2">Número</th>
            <th className="text-left px-4 py-2">Negócio</th>
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
          ) : visiveis.map(({ c, alerta }) => (
            <tr key={c.numero} className={`hover:bg-slate-50/70 ${alerta ? 'bg-red-50/60' : ''}`}>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-slate-700">{fmtNumero(c.numero)}</td>
              <td className="px-4 py-3 font-medium text-slate-800">{c.negocio || '—'}</td>
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
                    onClick={() => abrirHistorico(c)}
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
          ))}
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

      {aberta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={fecharHistorico}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 border-b flex justify-between items-start gap-4">
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-[220px]">
                <h3 className="font-semibold text-base">{fmtNumero(aberta.numero)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Estágio: <span className="font-medium">{aberta.estagio}</span> ·
                  Status: <span className="font-medium">{aberta.status}</span> ·
                  {aberta.historico?.length || 0} msgs
                </p>
                </div>
                <div className="min-w-[320px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prioridade comercial</div>
                  <div className="flex flex-wrap items-center gap-2">
                  <InteresseBadge c={aberta} compact />
                  <span className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs ${aberta.agente_pausado ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    Agente: <strong className="ml-1">{aberta.agente_pausado ? 'pausado' : 'ativo'}</strong>
                  </span>
                  {scoreValue(aberta.score_lead) != null && (
                    <span className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600">
                      Fit do lead: <strong className="ml-1 text-gray-900">{scoreValue(aberta.score_lead)}</strong>
                    </span>
                  )}
                  <TempBadge t={aberta.temperatura_lead} />
                  {aberta.evolution_instance && (
                    <span className="inline-flex items-center rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                      WhatsApp: <strong className="ml-1">{aberta.evolution_instance}</strong>
                    </span>
                  )}
                  </div>
                </div>
                {aberta.ultima_falha_resposta_em && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Falha no envio: {aberta.ultima_falha_resposta_msg || aberta.ultima_falha_resposta_codigo || 'erro desconhecido'}
                  </div>
                )}
              </div>
              <button
                onClick={fecharHistorico}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="border-b bg-white px-6 py-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setAbaModal('chat')}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition ${abaModal === 'chat' ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Conversa
                </button>
                <button
                  type="button"
                  onClick={() => setAbaModal('interesses')}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition ${abaModal === 'interesses' ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Interesses
                </button>
              </div>
            </div>

            {abaModal === 'interesses' && (
              <div className="flex-1 overflow-y-auto bg-gray-50 px-7 py-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Interesses detalhados</h4>
                    <div className="mt-1 text-xs text-gray-500">{aberta.score_interesse_mensagens_lead ?? 0} mensagens do lead analisadas</div>
                  </div>
                  <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    Score {scoreValue(aberta.score_interesse) ?? '--'}
                  </span>
                </div>
                {criteriosInteresse.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {criteriosInteresse.map((c, i) => (
                    <div key={`${c.titulo}-${i}`} className="flex min-w-0 gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                      <span className={`inline-flex h-7 min-w-12 shrink-0 items-center justify-center rounded-full border px-2 text-xs font-semibold ${criterioClasse(c)}`}>
                        {criterioDelta(c)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{c.titulo}</div>
                        {c.detalhe ? (
                          <div className="mt-1 text-sm leading-relaxed text-gray-600">{c.detalhe}</div>
                        ) : (
                          <div className="mt-1 text-sm text-gray-400">Sem detalhe registrado.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-400">
                    Ainda nao ha criterios detalhados para este lead.
                  </div>
                )}
              </div>
            )}

            {abaModal === 'chat' && (
            <>
            <div className="flex-1 overflow-y-auto bg-gray-50 px-7 py-6 space-y-4">
              {carregando ? (
                <p className="text-sm text-center text-gray-500 py-8">Carregando…</p>
              ) : !aberta.historico || aberta.historico.length === 0 ? (
                <p className="text-sm text-center text-gray-400 py-8">Sem mensagens no histórico.</p>
              ) : (
                aberta.historico.map((m, i) => {
                  const isUser = m.role === 'user'
                  const isAssistant = m.role === 'assistant'
                  const isOperator = m.role === 'operator'
                  const bubble = isUser
                    ? 'bg-white border border-gray-200 mr-auto'
                    : isAssistant
                      ? 'bg-brand text-white ml-auto'
                      : isOperator
                        ? 'bg-amber-100 text-amber-900 ml-auto'
                        : 'bg-gray-200 text-gray-700 mx-auto'
                  const label = isUser ? 'Lead' : isAssistant ? 'Agente' : isOperator ? 'Operador' : (m.role || '?')
                  const feedbackAtual = feedbacksMensagem[i]
                  const formAberto = feedbackNegativo?.index === i
                  const align = isAssistant || isOperator ? 'items-end' : isUser ? 'items-start' : 'items-center'
                  return (
                    <div key={i} className={`group flex flex-col ${align}`}>
                      <div className={`max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${bubble}`}>
                        <div className={`text-[10px] uppercase mb-1 ${isAssistant ? 'text-white/70' : 'text-gray-500'}`}>{label}</div>
                        <div className="whitespace-pre-wrap break-words">{m.content || m.text || '(vazio)'}</div>
                      </div>
                      {isAssistant && (
                        <>
                          <div className={`mt-1 flex max-w-[72%] flex-wrap items-center justify-end gap-1.5 text-[11px] transition ${feedbackAtual?.tipo || formAberto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                            {feedbackAtual?.tipo ? (
                              <span className={`rounded-full border px-2 py-1 ${feedbackAtual.tipo === 'positivo' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                                {feedbackAtual.enviando ? 'Registrando...' : feedbackAtual.tipo === 'positivo' ? 'Gostei registrado' : 'Feedback registrado'}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => enviarFeedbackMensagem(i, 'positivo')}
                                  disabled={!!feedbackAtual?.enviando}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50"
                                >
                                  <IconThumbUp className="h-3.5 w-3.5" />
                                  Gostei
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setFeedbackNegativo({ index: i, observacao: '', tags: [] })}
                                  disabled={!!feedbackAtual?.enviando}
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-700 shadow-sm transition hover:bg-amber-50 disabled:opacity-50"
                                >
                                  <IconThumbDown className="h-3.5 w-3.5" />
                                  Nao gostei
                                </button>
                              </>
                            )}
                          </div>
                          {formAberto && (
                            <div className="mt-2 w-full max-w-[72%] rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
                              <div className="mb-2 flex flex-wrap gap-1.5">
                                {FEEDBACK_TAGS.map((tag) => (
                                  <button
                                    key={tag.id}
                                    type="button"
                                    onClick={() => toggleFeedbackTag(tag.id)}
                                    className={`rounded-full border px-2 py-1 text-[11px] transition ${feedbackNegativo?.tags.includes(tag.id) ? 'border-amber-500 bg-amber-100 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                                  >
                                    {tag.label}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                value={feedbackNegativo?.observacao || ''}
                                onChange={(e) => setFeedbackNegativo((atual) => atual ? { ...atual, observacao: e.target.value } : atual)}
                                rows={3}
                                maxLength={2000}
                                placeholder="O que ficou errado nessa resposta?"
                                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                              />
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-500">
                                  Vai para Contextos como sugestao pendente.
                                </span>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setFeedbackNegativo(null)}
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => enviarFeedbackMensagem(i, 'negativo', feedbackNegativo || undefined)}
                                    disabled={!!feedbackAtual?.enviando || !feedbackNegativo?.observacao.trim()}
                                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {feedbackAtual?.enviando ? 'Registrando...' : 'Registrar'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          {feedbackAtual?.tipo === 'negativo' && !feedbackAtual.enviando && (
                            <a href="/dashboard/contextos" className="mt-1 max-w-[72%] text-[11px] font-medium text-amber-700 underline underline-offset-2">
                              Revisar em Contextos
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <div className={`border-t bg-white px-6 transition-all duration-200 ${composerAberto ? 'py-4' : 'py-2'}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setComposerAberto((v) => !v)}
                  className="flex min-w-[180px] flex-1 items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-100"
                  aria-expanded={composerAberto}
                >
                  <span>Mensagem do operador</span>
                  <span className="text-slate-400">{composerAberto ? 'Recolher' : 'Escrever'}</span>
                </button>
                <button
                  type="button"
                  onClick={orientarResposta}
                  disabled={orientandoResposta}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <IconStar className="h-3.5 w-3.5" />
                  {orientandoResposta ? 'Orientando...' : 'Orientar resposta'}
                </button>
              </div>
              <div className={`grid transition-all duration-200 ${composerAberto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="min-h-0 overflow-hidden">
                  {orientacaoResposta && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Por que essa resposta</div>
                      <p className="leading-relaxed">{orientacaoResposta.explicacao}</p>
                      {orientacaoResposta.alertas && orientacaoResposta.alertas.length > 0 && (
                        <div className="mt-2 text-xs text-amber-800">
                          {orientacaoResposta.alertas.join(' ')}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="relative">
                    <textarea
                      id="mensagem-operador"
                      value={mensagemManual}
                      onFocus={() => setComposerAberto(true)}
                      onChange={(e) => setMensagemManual(e.target.value)}
                      maxLength={4096}
                      rows={3}
                      placeholder="Escreva uma mensagem para enviar pelo WhatsApp..."
                      className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 pr-14 text-sm leading-relaxed outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={enviarMensagemOperador}
                      disabled={enviandoManual || !mensagemManual.trim()}
                      title="Enviar mensagem"
                      aria-label="Enviar mensagem"
                      className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconSend className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </>
            )}

            <div className="px-5 py-3 border-t flex flex-wrap justify-between items-center gap-3">
              <button
                onClick={deletarHistorico}
                disabled={apagando || !aberta.historico?.length}
                className="text-xs px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apagando ? 'Apagando…' : 'Deletar histórico'}
              </button>
              <button
                onClick={reenviarUltimaResposta}
                disabled={reenviando || !podeReenviarUltimaResposta}
                className="text-xs px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reenviando ? 'Reenviando...' : 'Reenviar WhatsApp'}
              </button>
              <button
                onClick={() => alterarPausaAgente(!aberta.agente_pausado)}
                disabled={alterandoPausa}
                className={`text-xs px-3 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed ${aberta.agente_pausado ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
              >
                {alterandoPausa ? 'Atualizando...' : aberta.agente_pausado ? 'Retomar agente' : 'Pausar agente'}
              </button>
              <button
                onClick={fecharHistorico}
                className="text-sm px-3 py-2 border rounded-lg"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
