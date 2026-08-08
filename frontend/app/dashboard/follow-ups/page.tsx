'use client'
// Central de Follow-ups — FILA ÚNICA de ações.
//
// Antes esta tela tinha 3 abas (Atendimento humano / Automático / Manual). Duas delas
// eram só a ORIGEM do item, e origem não é trabalho: o operador precisa decidir pela
// próxima ação de cada conversa, não pelo motor que a produziu. As abas viraram filtros
// rápidos sobre uma fila só; a origem continua visível como atributo e como filtro.
//
// Duas áreas permanecem separadas de propósito:
//   • Fila — o trabalho a fazer (uma linha por conversa, com a próxima ação e a prioridade).
//   • Automação — configuração e SAÚDE do motor (pausar, capacidade, reprocessar falhas).
// Falha é diagnóstico, não tarefa: aparece na fila só quando pedida no filtro "Falhas",
// e o reprocessamento mora em Automação.
//
// O "Manual" NÃO virou filtro: ele é um compositor de mensagem 1:1, e função distinta não
// vira filtro. Virou o botão "Follow-up manual" do cabeçalho, que também é reaproveitado
// pelos itens cuja próxima ação recomendada é escrever manualmente.
//
// Nenhuma regra de negócio mora aqui. A próxima ação, a prioridade e a janela vêm de
// `services/followup-call-score.js`; o estado do automático vem do motor. A montagem da
// fila e os filtros são PUROS e testados em `lib/followups-fila.js`.
//
// Preferência de filtro é de TELA: fica no localStorage. Antes, trocar de aba gravava
// `app.followup_config.modo` na empresa — clicar num filtro não pode escrever configuração.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import ConversaHistoricoModal from '@/components/ConversaHistoricoModal'
import Abas, { PainelAba, type Aba } from '@/components/ui/Abas'
import { IconSend, IconGear, IconPlay, IconAlert, IconClose, IconPlus } from '@/components/ui/icons'
import {
  FILTROS_RAPIDOS,
  VIEW_PADRAO,
  SITUACAO_LABEL,
  montarFila,
  aplicarFiltroRapido,
  aplicarAvancado,
  contagensRapidas,
  contarFiltrosAtivos,
  chipsAtivos,
  opcoesDeAcao,
  resumoFila,
  descricaoPrioridade,
  filtroRapidoValido,
  type ItemFila,
  type ViewFollowups,
  type FiltroRapido,
  type AtendimentoHumano,
  type AgendamentoAuto,
} from '@/lib/followups-fila'

type Config = { modo: 'manual' | 'semi' | 'automatico'; meta_ligacoes_dia: number; pausado: boolean }
type Resultado = 'atendeu' | 'nao_atendeu' | 'agendou' | 'sem_interesse' | 'ligar_depois'
type LigacaoRegistrada = { followup_erro: string | null }
type Resumo = { agendado: number; executado: number; cancelado: number; falhou: number }
type Area = 'fila' | 'automacao'

const RESULTADO_LABEL: Record<Resultado, string> = {
  atendeu: 'Atendeu', nao_atendeu: 'Não atendeu', agendou: 'Agendou reunião',
  sem_interesse: 'Sem interesse', ligar_depois: 'Ligar depois',
}

// Bolinha de prioridade — o mesmo vocabulário de cor de temperatura já usado na tela.
// Cor NUNCA é a única informação: cada bolinha carrega nome acessível e title.
const PRIORIDADE_DOT: Record<string, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-400',
  baixa: 'bg-sky-400',
}
const ACAO_STYLE: Record<string, string> = {
  assumir_conversa: 'border-red-200 bg-red-100 text-red-700',
  ligar: 'border-orange-200 bg-orange-100 text-orange-700',
  copiar_prompt_preview: 'border-violet-200 bg-violet-100 text-violet-700',
  revisar_proposta: 'border-amber-200 bg-amber-100 text-amber-700',
  mensagem_manual: 'border-sky-200 bg-sky-100 text-sky-700',
  aguardar_envio_ia: 'border-slate-200 bg-slate-100 text-slate-600',
  falha_envio_ia: 'border-red-200 bg-red-50 text-red-700',
  follow_up_enviado: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  follow_up_cancelado: 'border-slate-200 bg-slate-50 text-slate-500',
}
const PRAZO_STYLE: Record<string, string> = {
  atrasado: 'text-red-600 font-medium',
  agora: 'text-orange-600 font-medium',
  hoje: 'text-amber-600 font-medium',
}
const STATUS_AUTO_STYLE: Record<string, string> = {
  agendado: 'bg-sky-100 text-sky-700', executado: 'bg-emerald-100 text-emerald-700',
  falhou: 'bg-red-100 text-red-700', cancelado: 'bg-slate-100 text-slate-500',
}

const ID_AREAS = 'followups'
const AREAS: Aba[] = [
  { id: 'fila', titulo: 'Fila', descricao: 'O trabalho a fazer: uma linha por conversa, com a próxima ação.' },
  { id: 'automacao', titulo: 'Automação', descricao: 'Configuração e saúde do motor de follow-up automático.' },
]
const CHAVE_VIEW = 'followupsFila'

function fmtData(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtTelefone(digitos: string): string {
  const d = (digitos || '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`
  return digitos
}

export default function FollowUpsPage() {
  const fb = useFeedback()
  const empresaId = getEmpresaId()
  const base = `/api/empresas/${empresaId}/follow-ups`

  const [area, setArea] = useState<Area>('fila')
  const [config, setConfig] = useState<Config | null>(null)
  const [humanos, setHumanos] = useState<AtendimentoHumano[]>([])
  const [automaticos, setAutomaticos] = useState<AgendamentoAuto[]>([])
  const [resumo, setResumo] = useState<Resumo>({ agendado: 0, executado: 0, cancelado: 0, falhou: 0 })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [rapido, setRapido] = useState<FiltroRapido>('todos')
  const [view, setView] = useState<ViewFollowups>(VIEW_PADRAO)
  const [persAberto, setPersAberto] = useState(false)
  const persBotaoRef = useRef<HTMLButtonElement | null>(null)

  const [numeroHistorico, setNumeroHistorico] = useState<string | null>(null)
  const [roteiro, setRoteiro] = useState<{ nome: string; texto: string } | null>(null)
  const [registro, setRegistro] = useState<ItemFila | null>(null)
  const [manual, setManual] = useState<{ numero: string; nome: string } | null>(null)

  const carregarConfig = useCallback(async () => {
    try {
      const r = await apiFetch<Config>(`${base}/config`)
      setConfig(r.data)
    } catch { /* silencioso — a fila continua util sem a config */ }
  }, [base])

  // Uma carga só alimenta a fila inteira: as duas fontes são do mesmo atendimento.
  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [humano, auto] = await Promise.all([
        apiFetch<{ lista: AtendimentoHumano[] }>(`${base}/call-list`),
        apiFetch<{ itens: AgendamentoAuto[]; resumo: Resumo }>(`${base}/auto?limit=300`),
      ])
      setHumanos(humano.data.lista || [])
      setAutomaticos(auto.data.itens || [])
      setResumo(auto.data.resumo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a fila de follow-ups.')
    } finally { setCarregando(false) }
  }, [base])

  useEffect(() => { carregarConfig() }, [carregarConfig])
  useEffect(() => { carregar() }, [carregar])

  // Preferência de tela (filtro rápido + filtro avançado). Nunca vai para o servidor.
  useEffect(() => {
    try {
      const s = localStorage.getItem(CHAVE_VIEW)
      if (!s) return
      const p = JSON.parse(s)
      if (p.rapido) setRapido(filtroRapidoValido(p.rapido))
      if (p.view) setView({ ...VIEW_PADRAO, ...p.view })
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(CHAVE_VIEW, JSON.stringify({ rapido, view })) } catch { /* ignore */ }
  }, [rapido, view])

  const salvarConfig = useCallback(async (patch: Partial<Config>) => {
    const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify(patch) })
    setConfig(r.data)
    return r.data
  }, [base])

  const fila = useMemo(() => montarFila({ humanos, automaticos }), [humanos, automaticos])
  // O avançado compõe com o rápido: as contagens dos chips já refletem o avançado, senão
  // o número prometeria itens que o clique não mostraria.
  const aposAvancado = useMemo(() => aplicarAvancado(fila, view), [fila, view])
  const contagens = useMemo(() => contagensRapidas(aposAvancado), [aposAvancado])
  const visiveis = useMemo(() => aplicarFiltroRapido(aposAvancado, rapido), [aposAvancado, rapido])
  const filtrosAtivos = contarFiltrosAtivos(view)
  const rotulosDeAcao = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const o of opcoesDeAcao(fila)) mapa[o.valor] = o.label
    return mapa
  }, [fila])
  const chips = useMemo(() => chipsAtivos(view, rotulosDeAcao), [view, rotulosDeAcao])

  // Capacidade de ligações do dia: destaca as primeiras N ligações da fila em aberto.
  // Calculada sobre a fila inteira (não sobre o filtro), senão a marca mudaria de lugar
  // a cada filtro aplicado.
  const meta = config?.meta_ligacoes_dia ?? 12
  const naMeta = useMemo(() => {
    const ids = fila.filter((i) => i.acao === 'ligar').slice(0, meta).map((i) => i.id)
    return new Set(ids)
  }, [fila, meta])

  const limparTudo = useCallback(() => { setView(VIEW_PADRAO); setRapido('todos') }, [])

  const registrarResultado = useCallback(async (item: ItemFila, resultado: Resultado, notas: string, enviarFollowup: boolean) => {
    const out = await fb.runTask(async () => {
      const r = await apiFetch<LigacaoRegistrada>(`${base}/ligacoes`, {
        method: 'POST',
        body: JSON.stringify({ numero: item.numero, resultado, notas: notas || undefined, enviar_followup: enviarFollowup }),
      })
      setRegistro(null)
      await carregar()
      return r.data
    }, { pesada: enviarFollowup, sucesso: null })
    fb.toast(out.followup_erro || 'Ligação registrada', out.followup_erro ? 'error' : 'success')
  }, [base, carregar, fb])

  const gerarRoteiro = useCallback(async (item: ItemFila) => {
    await fb.runTask(async () => {
      const r = await apiFetch<{ roteiro: string }>(`${base}/roteiro`, {
        method: 'POST', body: JSON.stringify({ numero: item.numero, motivo: item.motivo || '' }),
      })
      setRoteiro({ nome: item.nome, texto: r.data.roteiro })
    }, { pesada: true, sucesso: 'Roteiro pronto' })
  }, [base, fb])

  const copiarPromptPreview = useCallback(async (item: ItemFila) => {
    if (!item.prompt_preview) {
      fb.toast('Este lead ainda não possui contexto suficiente para o prompt.', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(item.prompt_preview)
      fb.toast('Prompt copiado. Gere e revise a imagem fora do projeto.', 'success')
    } catch {
      fb.toast('Não foi possível copiar o prompt neste navegador.', 'error')
    }
  }, [fb])

  const cancelarAuto = useCallback(async (item: ItemFila) => {
    await fb.runTask(async () => {
      await apiFetch(`${base}/auto/cancelar`, { method: 'POST', body: JSON.stringify({ numero: item.numero }) })
      await carregar()
    }, { sucesso: 'Follow-up automático cancelado' })
  }, [base, carregar, fb])

  function fecharPersonalizar() {
    setPersAberto(false)
    persBotaoRef.current?.focus()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups</h1>
          <p className="text-sm text-slate-500">
            Uma fila só, organizada pela próxima ação de cada conversa. A origem (humana ou automática) é filtro, não aba.
          </p>
        </div>
        {config?.pausado && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
            <IconAlert className="h-4 w-4" /> Automático pausado
          </span>
        )}
      </div>

      <Abas abas={AREAS} ativa={area} onMudar={(id) => setArea(id as Area)} idBase={ID_AREAS} ariaLabel="Áreas de follow-up" />

      <PainelAba id="fila" idBase={ID_AREAS} ativa={area}>
        <div className="space-y-4">
          {/* Cabeçalho da fila: o que é, quanto tem, como filtrar. Sem repetir contagem em cards. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Fila de trabalho</h2>
              <p className="mt-0.5 text-xs text-slate-500">{resumoFila(contagens)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setManual({ numero: '', nome: '' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-50"
              >
                <IconPlus className="h-4 w-4" /> Follow-up manual
              </button>
              <button onClick={carregar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Atualizar</button>
            </div>
          </div>

          {/* Filtros rápidos com a contagem DENTRO do rótulo (padrão da Aquisição): o número
              fica onde a decisão é tomada e entra no nome acessível do botão. */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar a fila">
            {FILTROS_RAPIDOS.map((f) => {
              const ativo = rapido === f.valor
              return (
                <button
                  key={f.valor}
                  type="button"
                  title={f.descricao}
                  onClick={() => setRapido(f.valor)}
                  aria-pressed={ativo}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${ativo ? 'border-brand bg-brand text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${ativo ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {contagens[f.valor]}
                  </span>
                </button>
              )
            })}
            <button
              ref={persBotaoRef}
              type="button"
              onClick={() => setPersAberto(true)}
              aria-haspopup="dialog"
              aria-expanded={persAberto}
              className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${filtrosAtivos ? 'border-brand text-brand' : ''}`}
            >
              <IconGear className="h-4 w-4" /> Personalizar filtros
              {filtrosAtivos > 0 && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{filtrosAtivos}</span>}
            </button>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-500">{visiveis.length} item(ns) neste recorte</span>
              {chips.map((ch) => <span key={ch} className="rounded-full border bg-slate-100 px-2 py-0.5 text-slate-600">{ch}</span>)}
              <button onClick={limparTudo} className="text-brand hover:underline">Limpar filtros</button>
            </div>
          )}

          {erro ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
              <p>{erro}</p>
              <button onClick={carregar} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium hover:bg-red-50">
                Tentar de novo
              </button>
            </div>
          ) : carregando ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Spinner /><span className="sr-only">Carregando a fila…</span>
            </div>
          ) : fila.length === 0 ? (
            <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">
              Nenhum follow-up em andamento. Quando uma conversa esfriar ou o automático agendar um envio, o item aparece aqui.
            </div>
          ) : visiveis.length === 0 ? (
            <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">
              Nenhum item neste recorte.{' '}
              <button onClick={limparTudo} className="text-brand hover:underline">Limpar filtros</button>{' '}
              para ver a fila inteira.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
              <table className="w-full min-w-[1040px] text-sm">
                <caption className="sr-only">Fila de follow-ups, ordenada pela urgência da próxima ação</caption>
                <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-3"><span className="sr-only">Prioridade</span></th>
                    <th scope="col" className="px-4 py-3">Lead</th>
                    <th scope="col" className="px-4 py-3">Próxima ação</th>
                    <th scope="col" className="px-4 py-3">Prazo</th>
                    <th scope="col" className="px-4 py-3">Por que agora</th>
                    <th scope="col" className="px-4 py-3">Origem</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visiveis.map((item) => (
                    <LinhaFila
                      key={item.id}
                      item={item}
                      naMeta={naMeta.has(item.id)}
                      onAbrirHistorico={setNumeroHistorico}
                      onRoteiro={gerarRoteiro}
                      onRegistrar={setRegistro}
                      onCopiarPrompt={copiarPromptPreview}
                      onManual={(i) => setManual({ numero: i.telefone_digitos, nome: i.nome })}
                      onCancelarAuto={cancelarAuto}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PainelAba>

      <PainelAba id="automacao" idBase={ID_AREAS} ativa={area}>
        <AreaAutomacao
          base={base}
          config={config}
          resumo={resumo}
          falhas={fila.filter((i) => i.tem_falha)}
          onSalvarConfig={salvarConfig}
          onRecarregar={carregar}
          onVerFalhasNaFila={() => { setArea('fila'); setRapido('falhas') }}
          onAbrirHistorico={setNumeroHistorico}
          fb={fb}
        />
      </PainelAba>

      {numeroHistorico && (
        <ConversaHistoricoModal empresaId={empresaId} numero={numeroHistorico} onClose={() => setNumeroHistorico(null)} />
      )}

      {roteiro && (
        <ModalSimples titulo={`📋 Roteiro — ${roteiro.nome}`} onFechar={() => setRoteiro(null)}>
          <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{roteiro.texto}</div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { navigator.clipboard?.writeText(roteiro.texto); fb.toast('Roteiro copiado') }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Copiar</button>
            <button onClick={() => setRoteiro(null)} className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white">Fechar</button>
          </div>
        </ModalSimples>
      )}

      {registro && (
        <ModalRegistrarLigacao item={registro} onFechar={() => setRegistro(null)} onRegistrar={registrarResultado} />
      )}

      {manual && (
        <ModalManual
          base={base}
          inicial={manual}
          onFechar={() => setManual(null)}
          onEnviado={() => { setManual(null); carregar() }}
          fb={fb}
        />
      )}

      {persAberto && (
        <PersonalizarFiltros
          view={view}
          acoes={opcoesDeAcao(fila)}
          onPatch={(p) => setView((v) => ({ ...v, ...p }))}
          onLimpar={() => setView(VIEW_PADRAO)}
          onFechar={fecharPersonalizar}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Linha da fila ─────────────────────────────
function LinhaFila({ item, naMeta, onAbrirHistorico, onRoteiro, onRegistrar, onCopiarPrompt, onManual, onCancelarAuto }: {
  item: ItemFila
  naMeta: boolean
  onAbrirHistorico: (n: string) => void
  onRoteiro: (i: ItemFila) => void
  onRegistrar: (i: ItemFila) => void
  onCopiarPrompt: (i: ItemFila) => void
  onManual: (i: ItemFila) => void
  onCancelarAuto: (i: ItemFila) => void
}) {
  const descricao = descricaoPrioridade(item)
  return (
    <tr className={naMeta ? 'bg-amber-50/40' : ''}>
      <td className="px-3 py-3 align-top">
        {/* Prioridade: cor + nome acessível. Sem faixa calculada, a bolinha é vazada — a
            tela não inventa prioridade para item que nunca passou pelo call score. */}
        <span
          role="img"
          aria-label={descricao}
          title={descricao}
          className={`mt-1 block h-2.5 w-2.5 rounded-full ${item.prioridade ? PRIORIDADE_DOT[item.prioridade] : 'border border-slate-300 bg-white'}`}
        />
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800">{item.nome}</span>
          {item.escalado && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600" title="Ignorou follow-ups no WhatsApp">
              escalado
            </span>
          )}
        </div>
        {item.contexto && <div className="text-xs text-slate-400">{item.contexto}</div>}
        <button onClick={() => onAbrirHistorico(item.numero)} className="text-brand hover:underline">
          {fmtTelefone(item.telefone_digitos)}
        </button>
      </td>
      <td className="px-4 py-3 align-top">
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${ACAO_STYLE[item.acao || ''] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          {item.acao_label || '—'}
        </span>
        {naMeta && <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-600" title="Dentro da capacidade diária de ligações configurada em Automação">na capacidade do dia</div>}
      </td>
      <td className={`px-4 py-3 align-top text-slate-600 ${PRAZO_STYLE[item.prazo_quando || ''] || ''}`}>
        {item.prazo_quando === 'atrasado' && <span className="mr-1" aria-hidden="true">⚠</span>}
        {item.prazo_label || '—'}
        {item.prazo_quando === 'atrasado' && <span className="sr-only"> (atrasado)</span>}
      </td>
      <td className="max-w-sm px-4 py-3 align-top text-slate-600">
        <div>{item.motivo || '—'}</div>
        {item.orientacao && <div className="mt-1 text-xs text-slate-400">{item.orientacao}</div>}
        {item.tem_falha && (
          <div className="mt-1 text-xs text-red-500" title={item.falha_motivo || undefined}>
            Falha no envio automático{item.falha_motivo ? `: ${item.falha_motivo}` : ''}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{item.origem_label}</span>
        {item.ia_status && (
          <div className="mt-1 text-[11px] text-slate-400">
            IA: {SITUACAO_LABEL[item.ia_status === 'falhou' ? 'falha' : item.ia_status === 'executado' ? 'concluido' : item.ia_status === 'cancelado' ? 'cancelado' : 'aguardando']}
            {item.ia_data_label ? ` · ${item.ia_data_label}` : ''}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right align-top">
        <div className="flex justify-end gap-2">
          {item.acao === 'ligar' && (
            <>
              <button onClick={() => onRoteiro(item)} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Roteiro</button>
              <button onClick={() => onRegistrar(item)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Registrar</button>
            </>
          )}
          {item.acao === 'copiar_prompt_preview' && (
            <button onClick={() => onCopiarPrompt(item)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white">Copiar prompt</button>
          )}
          {item.acao === 'mensagem_manual' && (
            <button onClick={() => onManual(item)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Escrever</button>
          )}
          {(item.acao === 'assumir_conversa' || item.acao === 'revisar_proposta') && (
            <button onClick={() => onAbrirHistorico(item.numero)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Abrir conversa</button>
          )}
          {/* Cancelar é ação DESTE item (um lead), não configuração do motor. */}
          {item.ia_agendada && (
            <button onClick={() => onCancelarAuto(item)} className="rounded-lg border px-2.5 py-1 text-xs hover:bg-slate-50" title="Cancela os follow-ups automáticos agendados deste lead">
              Cancelar automático
            </button>
          )}
          {!item.humano && !item.ia_agendada && (
            <button onClick={() => onAbrirHistorico(item.numero)} className="rounded-lg border px-2.5 py-1 text-xs hover:bg-slate-50">Ver conversa</button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ───────────────────────── Automação (configuração + saúde) ─────────────────────────
function AreaAutomacao({ base, config, resumo, falhas, onSalvarConfig, onRecarregar, onVerFalhasNaFila, onAbrirHistorico, fb }: {
  base: string
  config: Config | null
  resumo: Resumo
  falhas: ItemFila[]
  onSalvarConfig: (p: Partial<Config>) => Promise<Config>
  onRecarregar: () => Promise<void> | void
  onVerFalhasNaFila: () => void
  onAbrirHistorico: (n: string) => void
  fb: ReturnType<typeof useFeedback>
}) {
  const [metaInput, setMetaInput] = useState<string>('')
  const meta = config?.meta_ligacoes_dia ?? 12
  useEffect(() => { setMetaInput(String(meta)) }, [meta])

  const togglePausa = useCallback(async () => {
    const novo = !config?.pausado
    await fb.runTask(() => onSalvarConfig({ pausado: novo }), { sucesso: novo ? 'Automático pausado' : 'Automático retomado' })
  }, [config, onSalvarConfig, fb])

  const salvarMeta = useCallback(async () => {
    const n = parseInt(metaInput, 10)
    if (!Number.isFinite(n) || n === meta) return
    await fb.runTask(() => onSalvarConfig({ meta_ligacoes_dia: n }), { sucesso: 'Capacidade atualizada' })
  }, [metaInput, meta, onSalvarConfig, fb])

  const reprocessar = useCallback(async () => {
    await fb.runTask(async () => {
      const r = await apiFetch<{ reprocessados: number }>(`${base}/auto/reprocessar`, { method: 'POST', body: '{}' })
      await onRecarregar()
      return r
    }, { pesada: true, sucesso: 'Follow-ups que falharam foram reenfileirados' })
  }, [base, onRecarregar, fb])

  const cards: [string, number, string][] = [
    ['Agendados', resumo.agendado, 'text-sky-600'],
    ['Enviados', resumo.executado, 'text-emerald-600'],
    ['Falharam', resumo.falhou, 'text-red-600'],
    ['Cancelados', resumo.cancelado, 'text-slate-400'],
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Saúde da automação</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Configuração e diagnóstico do motor. O trabalho do dia continua sendo feito na Fila — aqui não há uma segunda fila.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, n, cor]) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className={`text-2xl font-bold ${cor}`}>{n}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm">
        <button onClick={togglePausa} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${config?.pausado ? 'bg-emerald-600 text-white' : 'border hover:bg-slate-50'}`}>
          {config?.pausado ? <><IconPlay className="h-4 w-4" /> Retomar automático</> : <><IconGear className="h-4 w-4" /> Pausar automático</>}
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="meta-ligacoes" className="text-sm font-medium text-slate-600">Capacidade de ligações/dia</label>
          <input
            id="meta-ligacoes" type="number" min={1} max={100} value={metaInput}
            onChange={(e) => setMetaInput(e.target.value)} onBlur={salvarMeta}
            className="w-20 rounded-lg border px-2 py-1 text-sm"
          />
        </div>
        <p className="text-xs text-slate-400">Marca as primeiras {meta} ligações da fila como “na capacidade do dia”. Não bloqueia envio.</p>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Falhas de envio</h3>
            <p className="text-xs text-slate-500">
              {resumo.falhou > 0
                ? 'Reprocessar reenfileira os follow-ups que falharam. Nada é enviado agora — o motor decide o horário.'
                : 'Nenhuma falha registrada. Nada a reprocessar.'}
            </p>
          </div>
          <div className="flex gap-2">
            {falhas.length > 0 && (
              <button onClick={onVerFalhasNaFila} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Ver na fila</button>
            )}
            {resumo.falhou > 0 && (
              <button onClick={reprocessar} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
                <IconAlert className="h-4 w-4" /> Reprocessar {resumo.falhou} falha(s)
              </button>
            )}
          </div>
        </div>

        {falhas.length > 0 && (
          <ul className="mt-3 divide-y border-t text-sm">
            {falhas.slice(0, 20).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <button onClick={() => onAbrirHistorico(f.numero)} className="font-medium text-brand hover:underline">{f.nome}</button>
                <span className="text-xs text-red-500">{f.falha_motivo || 'sem motivo registrado'}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_AUTO_STYLE[f.ia_status || 'falhou']}`}>
                  {f.ia_status === 'agendado' ? 'já reenfileirado' : 'falhou'} · {fmtData(f.ia_data)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── Modais ─────────────────────────────
// Modal com fundo: fecha no Escape e no clique fora, recebe o foco ao abrir.
function ModalSimples({ titulo, onFechar, largura = 'max-w-lg', children }: {
  titulo: string; onFechar: () => void; largura?: string; children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className={`w-full ${largura} rounded-2xl bg-white p-6 shadow-xl focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{titulo}</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600" aria-label="Fechar"><IconClose className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalRegistrarLigacao({ item, onFechar, onRegistrar }: {
  item: ItemFila
  onFechar: () => void
  onRegistrar: (item: ItemFila, resultado: Resultado, notas: string, enviarFollowup: boolean) => Promise<void>
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [notas, setNotas] = useState('')
  const [enviarFollowup, setEnviarFollowup] = useState(false)
  const resultados: Resultado[] = ['atendeu', 'agendou', 'ligar_depois', 'nao_atendeu', 'sem_interesse']

  return (
    <ModalSimples titulo={`📞 Resultado — ${item.nome}`} largura="max-w-md" onFechar={onFechar}>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Resultado da ligação">
        {resultados.map((r) => (
          <button
            key={r}
            onClick={() => setResultado(r)}
            aria-pressed={resultado === r}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${resultado === r ? 'border-brand bg-brand text-white' : 'hover:bg-slate-50'}`}
          >
            {RESULTADO_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-xs text-slate-500" htmlFor="notas-ligacao">Notas da ligação (opcional)</label>
      <textarea
        id="notas-ligacao"
        value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} maxLength={2000}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
      />
      {resultado === 'nao_atendeu' && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={enviarFollowup} onChange={(e) => setEnviarFollowup(e.target.checked)} />
          Não atendeu? Disparar um follow-up no WhatsApp agora (IA).
        </label>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
        <button
          disabled={!resultado}
          onClick={() => resultado && onRegistrar(item, resultado, notas, enviarFollowup)}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Registrar
        </button>
      </div>
    </ModalSimples>
  )
}

// Compositor manual — a antiga aba "Manual". Mesmos endpoints, mesma revisão humana
// antes do envio; o que mudou é o lugar (ação da fila, não um terceiro modo de trabalho).
function ModalManual({ base, inicial, onFechar, onEnviado, fb }: {
  base: string
  inicial: { numero: string; nome: string }
  onFechar: () => void
  onEnviado: () => void
  fb: ReturnType<typeof useFeedback>
}) {
  const [numero, setNumero] = useState(inicial.numero)
  const [texto, setTexto] = useState('')
  const [gerando, setGerando] = useState(false)

  const numeroJid = useMemo(() => {
    const d = numero.replace(/\D/g, '')
    if (!d) return ''
    return numero.includes('@') ? numero : `${d}@s.whatsapp.net`
  }, [numero])

  const gerar = useCallback(async () => {
    if (!numeroJid) { fb.toast('Informe o telefone do lead', 'error'); return }
    setGerando(true)
    try {
      const r = await apiFetch<{ texto: string }>(`${base}/manual/gerar`, { method: 'POST', body: JSON.stringify({ numero: numeroJid }) })
      setTexto(r.data.texto)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao gerar', 'error') }
    finally { setGerando(false) }
  }, [base, numeroJid, fb])

  const enviar = useCallback(async () => {
    if (!numeroJid || !texto.trim()) { fb.toast('Gere e revise a mensagem antes de enviar', 'error'); return }
    await fb.runTask(async () => {
      await apiFetch(`${base}/manual/enviar`, { method: 'POST', body: JSON.stringify({ numero: numeroJid, texto: texto.trim() }) })
    }, { pesada: true, sucesso: 'Follow-up enviado' })
    onEnviado()
  }, [base, numeroJid, texto, fb, onEnviado])

  return (
    <ModalSimples titulo={inicial.nome ? `✍ Follow-up manual — ${inicial.nome}` : '✍ Follow-up manual'} onFechar={onFechar}>
      <label htmlFor="manual-numero" className="mb-1 block text-sm font-medium text-slate-600">Telefone do lead</label>
      <div className="flex gap-2">
        <input
          id="manual-numero" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={30}
          placeholder="Ex: 11987654321" className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button onClick={gerar} disabled={gerando} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {gerando ? <Spinner /> : <IconGear className="h-4 w-4" />} Gerar por IA
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">A IA usa o histórico e o contexto da empresa. Você revisa antes de enviar.</p>

      {texto && (
        <div className="mt-4">
          <label htmlFor="manual-texto" className="mb-1 block text-sm font-medium text-slate-600">Mensagem (revise e edite se quiser)</label>
          <textarea
            id="manual-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={4096}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
            <button onClick={enviar} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
              <IconSend className="h-4 w-4" /> Enviar follow-up
            </button>
          </div>
        </div>
      )}
    </ModalSimples>
  )
}

// Filtro avançado — mesmo padrão do "Personalizar" do Banco de Leads: painel flutuante,
// arrastável e SEM fundo escuro, para ver a fila mudando atrás enquanto se ajusta. Por
// não bloquear o resto da tela, é um diálogo NÃO modal (sem `aria-modal`): fecha no
// Escape e devolve o foco ao botão que o abriu.
function PersonalizarFiltros({ view, acoes, onPatch, onLimpar, onFechar }: {
  view: ViewFollowups
  acoes: { valor: string; label: string }[]
  onPatch: (p: Partial<ViewFollowups>) => void
  onLimpar: () => void
  onFechar: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ ox: number; oy: number } | null>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [onFechar])

  function startDrag(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ x: rect.left, y: rect.top })
    setDrag({ ox: e.clientX - rect.left, oy: e.clientY - rect.top })
    e.preventDefault()
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => setPos({
      x: Math.max(0, Math.min(e.clientX - drag.ox, window.innerWidth - 260)),
      y: Math.max(0, Math.min(e.clientY - drag.oy, window.innerHeight - 48)),
    })
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [drag])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Personalizar filtros da fila"
      tabIndex={-1}
      style={pos ? { position: 'fixed', left: pos.x, top: pos.y } : undefined}
      className={`z-50 flex max-h-[85vh] w-[640px] max-w-[95vw] flex-col rounded-2xl border bg-white shadow-2xl focus:outline-none ${pos ? '' : 'fixed left-1/2 top-12 -translate-x-1/2'}`}
    >
      <div onMouseDown={startDrag} className="flex cursor-move select-none items-center justify-between rounded-t-2xl border-b bg-slate-50 px-5 py-3">
        <h3 className="text-lg font-semibold">⠿ Personalizar filtros</h3>
        <button onClick={onFechar} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Fechar">×</button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Trabalho</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Campo label="Próxima ação">
              <select value={view.acao} onChange={(e) => onPatch({ acao: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                {acoes.map((a) => <option key={a.valor} value={a.valor}>{a.label}</option>)}
              </select>
            </Campo>
            <Campo label="Prioridade">
              <select value={view.prioridade} onChange={(e) => onPatch({ prioridade: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
                <option value="sem">Não calculada (automático)</option>
              </select>
            </Campo>
            <Campo label="Origem do atendimento">
              <select value={view.origem} onChange={(e) => onPatch({ origem: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                <option value="humano">Atendimento humano</option>
                <option value="ia">Atendimento IA</option>
              </select>
            </Campo>
            <Campo label="Status">
              <select value={view.situacao} onChange={(e) => onPatch({ situacao: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                <option value="aberto">Em aberto (ação humana)</option>
                <option value="aguardando">Aguardando (agendado)</option>
                <option value="falha">Falha</option>
                <option value="concluido">Concluído</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </Campo>
            <Campo label="Tentativas ≥">
              <input type="number" min={0} value={view.tentativasMin} onChange={(e) => onPatch({ tentativasMin: e.target.value })}
                placeholder="0" className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </Campo>
            <Campo label="Lead (nome ou telefone)">
              <input value={view.busca} onChange={(e) => onPatch({ busca: e.target.value })}
                placeholder="ex: Padaria, 11999…" className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </Campo>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Tentativas = follow-ups automáticos já disparados para o lead (ou ignorados por ele, na fila humana).
          </p>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Período e falhas</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Campo label="Prazo de">
              <input type="date" value={view.dataDe} onChange={(e) => onPatch({ dataDe: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </Campo>
            <Campo label="Prazo até">
              <input type="date" value={view.dataAte} onChange={(e) => onPatch({ dataAte: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </Campo>
            <Campo label="Motivo da falha contém">
              <input value={view.falhaTexto} onChange={(e) => onPatch({ falhaTexto: e.target.value })}
                placeholder="ex: crédito, 401" className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </Campo>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            O período usa a data agendada/enviada do automático. Ação humana tem janela recomendada, não data —
            fica de fora quando o período está preenchido. O motivo da falha é o texto registrado pelo motor: não há
            classificação de tipo de falha para filtrar.
          </p>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <button onClick={onLimpar} className="text-sm text-slate-500 hover:text-slate-800">↺ Limpar filtros avançados</button>
        <span className="hidden text-xs text-slate-400 md:inline">Aplica em tempo real · salvo neste navegador · arraste pelo topo</span>
        <button onClick={onFechar} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Concluir</button>
      </div>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-500">{label}</span>
      {children}
    </label>
  )
}
