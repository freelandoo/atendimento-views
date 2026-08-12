'use client'
// Central de Follow-ups — FILA OPERACIONAL ÚNICA, paginada.
//
// A tela responde quatro perguntas na ordem em que o operador as faz: quem precisa de
// ação, qual ação, quando agir e com que prioridade. Tudo o que não ajuda a responder
// isso saiu.
//
// Histórico das duas reduções, para ninguém as desfazer sem saber o que desfaz:
//
//  1. As 3 abas (Atendimento humano / Automático / Manual) viraram FILTROS sobre uma fila
//     só. Duas delas eram apenas a ORIGEM do item, e origem não é trabalho. O "Manual" não
//     virou filtro: é um compositor de mensagem 1:1 (função distinta não vira filtro) e
//     virou o botão "Follow-up manual" do cabeçalho.
//  2. A área "Automação" (cards de saúde, capacidade de ligações/dia, reprocessar falhas)
//     saiu inteira: logs, telemetria e reprocessamento não pertencem a uma fila de
//     trabalho. Do que ela tinha, sobrou o que é DECISÃO diária e não diagnóstico — o
//     toggle de ligar/desligar o follow-up automático, no cabeçalho.
//     Consequências declaradas, aceitas com o operador:
//       • `meta_ligacoes_dia` deixou de ter editor. A marca "na capacidade do dia" segue
//         lendo o valor já salvo da empresa (`GET /config`); o contrato `PUT /config`
//         continua intacto para quando a área nascer em Configurações.
//       • Reprocessar falhas saiu da UI. `POST /auto/reprocessar` continua existindo no
//         backend; a retomada silenciosa do motor é quem cuida do caso normal.
//
// Nenhuma regra de negócio mora aqui. A próxima ação, a prioridade e a janela vêm de
// `services/followup-call-score.js`; o estado do automático vem do motor; a montagem da
// fila, os filtros, o rótulo do lead e a paginação são PUROS (`lib/followups-fila.js`,
// que reexporta `lib/paginacao.js` — o mesmo da Aquisição e da Central de Ligações).
//
// Preferência de filtro é de TELA: fica no localStorage. Antes, trocar de aba gravava
// `app.followup_config.modo` na empresa — clicar num filtro não pode escrever configuração.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import ConversaPainel from '@/components/ConversaPainel'
import { IconSend, IconGear, IconAlert, IconClose, IconPlus } from '@/components/ui/icons'
import InterruptorAtivacao from '@/components/ui/InterruptorAtivacao'
import MenuRadialAcoes, { type AcaoRadial } from '@/components/ui/MenuRadialAcoes'
import {
  FILTROS_RAPIDOS,
  VIEW_PADRAO,
  SITUACAO_LABEL,
  POR_PAGINA_PADRAO,
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
  formatarTelefone,
  paginar,
  resumoIntervalo,
  // Vocabulário e ações da PRÓXIMA AÇÃO registrada (migration 062). Mesmo módulo puro que a
  // Central de Ligações usa para criá-la — a fila só traduz o que o backend decidiu.
  opcoesDeResponsavel,
  iconeCanal,
  rotuloCanal,
  rotuloOrigem,
  rotuloEvento,
  formatarQuando,
  paraInputLocal,
  deInputLocal,
  contextoDeOrigem,
  // Disponibilidade de canal do CONTATO (migration 066). Quem DECIDE o canal é o backend;
  // aqui só há o texto da consequência e o estado do controle.
  MARCAR_SEM_WHATSAPP_LABEL,
  MARCAR_SEM_WHATSAPP_AJUDA,
  AVISO_TROCA_PARA_LIGACAO,
  AVISO_CANAL_DESCARTADO,
  rotuloDisponibilidadeWhatsapp,
  estadoDisponibilidadeInicial,
  alternarSemWhatsapp,
  patchDisponibilidade,
  PRIORIDADE_OPCOES,
  ORIGEM_LABEL,
  type ItemFila,
  type ViewFollowups,
  type FiltroRapido,
  type AtendimentoHumano,
  type AgendamentoAuto,
  type SugestaoLead,
  type PaginaLista,
  type FollowUpApi,
  type ContextoOrigem,
  type EventoContato,
} from '@/lib/followups-fila'

type Config = { modo: 'manual' | 'semi' | 'automatico'; meta_ligacoes_dia: number; pausado: boolean }
type Resultado = 'atendeu' | 'nao_atendeu' | 'agendou' | 'sem_interesse' | 'ligar_depois'
type LigacaoRegistrada = { followup_erro: string | null }

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
  // Follow-up REGISTRADO: destacado do resto porque é compromisso assumido com o cliente,
  // não recomendação do sistema.
  followup_whatsapp: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  followup_ligacao: 'border-indigo-300 bg-indigo-50 text-indigo-800',
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

const CHAVE_VIEW = 'followupsFila'

export default function FollowUpsPage() {
  const fb = useFeedback()
  const empresaId = getEmpresaId()
  const base = `/api/empresas/${empresaId}/follow-ups`

  const [config, setConfig] = useState<Config | null>(null)
  const [humanos, setHumanos] = useState<AtendimentoHumano[]>([])
  const [automaticos, setAutomaticos] = useState<AgendamentoAuto[]>([])
  const [followups, setFollowups] = useState<FollowUpApi[]>([])
  const [responsaveis, setResponsaveis] = useState<{ id: string; nome: string }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [rapido, setRapido] = useState<FiltroRapido>('todos')
  const [view, setView] = useState<ViewFollowups>(VIEW_PADRAO)
  const [pagina, setPagina] = useState(1)
  const [persAberto, setPersAberto] = useState(false)
  const persBotaoRef = useRef<HTMLButtonElement | null>(null)

  const [numeroHistorico, setNumeroHistorico] = useState<string | null>(null)
  const [contextoAberto, setContextoAberto] = useState<ContextoOrigem | null>(null)
  const [reagendando, setReagendando] = useState<ItemFila | null>(null)
  const [historicoContato, setHistoricoContato] = useState<ItemFila | null>(null)

  // Regra de roteamento, num lugar só: WhatsApp executa na Central de Mensagens; ligação
  // executa na Central de Ligações. A fila OPERA os dois; ela não executa nenhum.
  const executarItem = useCallback((item: ItemFila) => {
    if (item.destino === 'central_ligacoes') {
      if (!item.campanha_lead_id) {
        fb.toast('Este follow-up não está ligado a uma campanha — abra a Central de Ligações e escolha o lead.', 'info')
        return
      }
      // A campanha vem junto do item; o lead é encontrado na fila daquela campanha.
      window.location.href = `/dashboard/central-ligacoes?campanha=${encodeURIComponent(item.campanha_id || '')}&lead=${encodeURIComponent(item.campanha_lead_id)}`
      return
    }
    if (!item.numero) {
      fb.toast('Este contato ainda não tem conversa de WhatsApp aberta.', 'info')
      return
    }
    setContextoAberto(contextoDeOrigem(item))
    setNumeroHistorico(item.numero)
  }, [fb])
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
      const [humano, auto, registrados] = await Promise.all([
        apiFetch<{ lista: AtendimentoHumano[] }>(`${base}/call-list`),
        apiFetch<{ itens: AgendamentoAuto[] }>(`${base}/auto?limit=300`),
        apiFetch<{ itens: FollowUpApi[] }>(`${base}/itens?limit=300`),
      ])
      setHumanos(humano.data.lista || [])
      setAutomaticos(auto.data.itens || [])
      setFollowups(registrados.data.itens || [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a fila de follow-ups.')
    } finally { setCarregando(false) }
  }, [base])

  // Lista de responsáveis: alimenta só o SELETOR do filtro. Falha silenciosa — a fila
  // continua utilizável sem ela (os nomes já vêm junto de cada item).
  const carregarResponsaveis = useCallback(async () => {
    try {
      const r = await apiFetch<{ itens: { id: string; nome: string }[] }>(`${base}/responsaveis`)
      setResponsaveis(r.data.itens || [])
    } catch { /* silencioso */ }
  }, [base])

  useEffect(() => { carregarConfig() }, [carregarConfig])
  useEffect(() => { carregarResponsaveis() }, [carregarResponsaveis])
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

  // Mexer em filtro volta para a página 1: manter a página 7 depois de restringir o
  // recorte mostraria uma janela vazia (ou, pior, itens que não são os do topo).
  useEffect(() => { setPagina(1) }, [rapido, view])

  const salvarConfig = useCallback(async (patch: Partial<Config>) => {
    const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify(patch) })
    setConfig(r.data)
    return r.data
  }, [base])

  const alternarAutomatico = useCallback(async () => {
    const novo = !config?.pausado
    await fb.runTask(() => salvarConfig({ pausado: novo }), {
      sucesso: novo ? 'Follow-up automático desativado' : 'Follow-up automático ativado',
    })
  }, [config, salvarConfig, fb])

  const fila = useMemo(() => montarFila({ humanos, automaticos, followups }), [humanos, automaticos, followups])
  // O avançado compõe com o rápido: as contagens dos chips já refletem o avançado, senão
  // o número prometeria itens que o clique não mostraria.
  const aposAvancado = useMemo(() => aplicarAvancado(fila, view), [fila, view])
  const contagens = useMemo(() => contagensRapidas(aposAvancado), [aposAvancado])
  const visiveis = useMemo(() => aplicarFiltroRapido(aposAvancado, rapido), [aposAvancado, rapido])
  // Pagina DEPOIS de filtrar e ordenar: a página é só a janela visível sobre o conjunto
  // inteiro já priorizado pelo backend. `paginar` clampa a página, então encolher a lista
  // nunca deixa o operador numa página vazia.
  const pg = useMemo(() => paginar(visiveis, pagina, POR_PAGINA_PADRAO), [visiveis, pagina])
  const filtrosAtivos = contarFiltrosAtivos(view)
  const rotulosDeAcao = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const o of opcoesDeAcao(fila)) mapa[o.valor] = o.label
    return mapa
  }, [fila])
  const rotulosDeResponsavel = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const u of responsaveis) mapa[u.id] = u.nome
    for (const o of opcoesDeResponsavel(fila)) mapa[o.valor] = mapa[o.valor] || o.label
    return mapa
  }, [responsaveis, fila])
  const chips = useMemo(() => chipsAtivos(view, rotulosDeAcao, rotulosDeResponsavel), [view, rotulosDeAcao, rotulosDeResponsavel])

  // Capacidade de ligações do dia: destaca as primeiras N ligações da fila em aberto.
  // Calculada sobre a fila inteira (não sobre o filtro nem sobre a página), senão a marca
  // mudaria de lugar a cada filtro aplicado.
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
      setRoteiro({ nome: item.rotulo, texto: r.data.roteiro })
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

  // Concluir / cancelar. Idempotentes no backend: repetir o clique não move a hora do fim.
  const mudarStatusFollowUp = useCallback(async (item: ItemFila, status: 'concluido' | 'cancelado', nota?: string) => {
    if (!item.followup_id) return
    await fb.runTask(async () => {
      await apiFetch(`${base}/itens/${item.followup_id}/status`, {
        method: 'POST', body: JSON.stringify({ status, nota: nota || undefined }),
      })
      await carregar()
    }, { sucesso: status === 'concluido' ? 'Follow-up concluído' : 'Follow-up cancelado' })
  }, [base, carregar, fb])

  const reagendarFollowUp = useCallback(async (item: ItemFila, patch: Record<string, unknown>) => {
    if (!item.followup_id) return
    await fb.runTask(async () => {
      await apiFetch(`${base}/itens/${item.followup_id}/reagendar`, {
        method: 'POST', body: JSON.stringify(patch),
      })
      await carregar()
    }, { sucesso: 'Follow-up reagendado' })
  }, [base, carregar, fb])

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

  const pausado = config?.pausado === true

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups</h1>
          <p className="text-sm text-slate-500">
            Uma fila só, organizada pela próxima ação de cada conversa. A origem (humana ou automática) é filtro, não aba.
          </p>
        </div>
        {/* O que sobrou da área de Automação: a decisão diária de deixar o motor rodar ou
            não. Passou a usar o controle de ativação padronizado (nome + ícone de informação
            + interruptor), o mesmo padrão da Central de Mensagens. O "ativo/desativado" por
            extenso saiu: o interruptor já mostra o estado pela POSIÇÃO (não só pela cor) e
            `role="switch"` + `aria-checked` o levam ao leitor de tela. A consequência de
            ligar e a de desligar ficaram no balão, sem ocupar espaço fixo no topo.
            `desabilitado` enquanto `config` não chegou: o bloqueio existente foi preservado. */}
        <InterruptorAtivacao
          rotulo="Follow-up automático"
          ligado={!pausado}
          onMudar={alternarAutomatico}
          desabilitado={!config}
          ajuda="Ligado: o motor agenda e envia follow-ups automáticos conforme as regras da empresa. Desligado: ele não agenda nem envia nada — a fila desta tela continua funcionando normalmente."
          ariaLabel={`Follow-up automático: ${pausado ? 'desativado' : 'ativo'}. Ativar ou desativar o envio automático de follow-ups pelo motor.`}
        />
      </div>

      {pausado && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            O follow-up automático está desativado: nada é agendado nem enviado pelo motor. As ações desta fila
            continuam disponíveis normalmente.
          </span>
        </p>
      )}

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
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <caption className="sr-only">Fila de follow-ups, ordenada pela urgência da próxima ação</caption>
                <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-3"><span className="sr-only">Prioridade</span></th>
                    <th scope="col" className="px-4 py-3">Lead</th>
                    <th scope="col" className="px-4 py-3">Canal</th>
                    <th scope="col" className="px-4 py-3">Próxima ação</th>
                    <th scope="col" className="px-4 py-3">Prazo</th>
                    <th scope="col" className="px-4 py-3">Por que agora</th>
                    <th scope="col" className="px-4 py-3">Origem</th>
                    {/* Coluna própria e fixa para o radial: largura mínima suficiente para o
                        gatilho "⋯" abrir sem colar na borda direita da tabela nem sobrepor a
                        bolinha central (o radial posiciona as bolinhas satélite a 56px do centro
                        do gatilho, então precisa de espaço à direita dele — não só do texto). */}
                    <th scope="col" className="w-40 min-w-[10rem] px-4 py-3 text-center"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pg.itens.map((item) => (
                    <LinhaFila
                      key={item.id}
                      item={item}
                      naMeta={naMeta.has(item.id)}
                      onAbrirHistorico={(n) => { setContextoAberto(null); setNumeroHistorico(n) }}
                      onRoteiro={gerarRoteiro}
                      onRegistrar={setRegistro}
                      onCopiarPrompt={copiarPromptPreview}
                      onManual={(i) => setManual({ numero: i.telefone_digitos, nome: i.rotulo })}
                      onCancelarAuto={cancelarAuto}
                      onExecutar={executarItem}
                      onConcluir={(i) => mudarStatusFollowUp(i, 'concluido')}
                      onCancelarFollowUp={(i) => mudarStatusFollowUp(i, 'cancelado')}
                      onReagendar={setReagendando}
                      onHistorico={setHistoricoContato}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <RodapeFila pg={pg} onPagina={setPagina} />
          </div>
        )}
      </div>

      {/* MESMO painel do Histórico da Central de Mensagens (`components/ConversaPainel.tsx`).
          A fila é só uma porta de entrada: a origem muda apenas o DESTINO do fechamento
          (voltar para a fila, com filtros, ordenação e página intactos — eles vivem no estado
          desta página e no localStorage, e o painel não os toca). Dados, permissões e ações
          são os mesmos nas duas entradas. Não recriar um modal exclusivo daqui. */}
      {numeroHistorico && (
        <ConversaPainel
          empresaId={empresaId}
          numero={numeroHistorico}
          onFechar={() => { setNumeroHistorico(null); setContextoAberto(null) }}
          onAtualizou={carregar}
          /* Contexto da ligação/evento que originou o item. São DADOS, não requisição: o
             painel é o mesmo da Central de Mensagens, que não pode chamar rota admin-only. */
          contextoOrigem={contextoAberto}
        />
      )}

      {reagendando && (
        <ModalReagendar
          item={reagendando}
          responsaveis={responsaveis}
          onFechar={() => setReagendando(null)}
          onConfirmar={async (patch) => { await reagendarFollowUp(reagendando, patch); setReagendando(null) }}
        />
      )}

      {historicoContato && (
        <ModalHistoricoContato base={base} item={historicoContato} onFechar={() => setHistoricoContato(null)} />
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
          responsaveis={opcoesDeResponsavel(fila)}
          onPatch={(p) => setView((v) => ({ ...v, ...p }))}
          onLimpar={() => setView(VIEW_PADRAO)}
          onFechar={fecharPersonalizar}
        />
      )}
    </div>
  )
}

// ───────────────────────────── Rodapé da fila ─────────────────────────────
// Mesmo padrão do rodapé da listagem da Aquisição: resumo do intervalo à esquerda,
// navegação à direita; empilha no mobile com alvos de toque de 36px. Toda a aritmética
// vem de lib/paginacao — aqui é só apresentação.
function RodapeFila({ pg, onPagina }: { pg: PaginaLista<ItemFila>; onPagina: (p: number) => void }) {
  return (
    <div className="flex flex-col gap-2 border-t px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-500" aria-live="polite">
        <span className="tabular-nums">
          {resumoIntervalo(pg, { singular: 'follow-up', plural: 'follow-ups' })}
        </span>
      </p>
      {(pg.temAnterior || pg.temProxima) && (
        <div className="flex items-center gap-1 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => onPagina(pg.pagina - 1)}
            disabled={!pg.temAnterior}
            aria-label="Página anterior"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ◀ <span className="hidden sm:inline">Anterior</span>
          </button>
          <span className="px-1 text-xs text-slate-500">
            Página <b className="tabular-nums text-slate-700">{pg.pagina}</b> de <span className="tabular-nums">{pg.totalPaginas}</span>
          </span>
          <button
            type="button"
            onClick={() => onPagina(pg.pagina + 1)}
            disabled={!pg.temProxima}
            aria-label="Próxima página"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <span className="hidden sm:inline">Próxima</span> ▶
          </button>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── Linha da fila ─────────────────────────────
function LinhaFila({ item, naMeta, onAbrirHistorico, onRoteiro, onRegistrar, onCopiarPrompt, onManual, onCancelarAuto, onExecutar, onConcluir, onCancelarFollowUp, onReagendar, onHistorico }: {
  item: ItemFila
  naMeta: boolean
  onAbrirHistorico: (n: string) => void
  onRoteiro: (i: ItemFila) => void
  onRegistrar: (i: ItemFila) => void
  onCopiarPrompt: (i: ItemFila) => void
  onManual: (i: ItemFila) => void
  onCancelarAuto: (i: ItemFila) => void
  onExecutar: (i: ItemFila) => void
  onConcluir: (i: ItemFila) => void
  onCancelarFollowUp: (i: ItemFila) => void
  onReagendar: (i: ItemFila) => void
  onHistorico: (i: ItemFila) => void
}) {
  const registrado = !!item.followup_id
  const emAberto = registrado && item.followup_status === 'aguardando'
  const descricao = descricaoPrioridade(item)

  // Ações desta linha, absorvidas pelo menu radial (⋯) para não quebrar linha —
  // Follow-ups é a tela com mais botões simultâneos do produto (relatório de
  // padronização visual, seção 6). "Registrar"/"Escrever"/"Copiar prompt" continuam
  // botões comuns fora do radial (são ações distintas, não compactação de "Abrir
  // conversa"). "Abrir conversa"/"Ir para a ligação" ENTRA no radial junto das demais —
  // dobrada aqui em vez de ficar como botão `bg-brand` à parte, para a linha ficar só
  // com o radial nos estados em que essa era a única ação visível.
  const acoesSecundarias: AcaoRadial[] = []
  if (emAberto) {
    acoesSecundarias.push(
      // 4ª bolinha (zona `baixo`): Concluir/Reagendar/Cancelar já ocupam os 3 slots
      // direcionais, e esta é a 4ª ação principal da linha — vira a bolinha de baixo em
      // vez de cair sem zona no painel de extras (era um quadrado só com esta ação).
      // Rótulo curto porque o espaço da bolinha é pequeno; a descrição carrega o texto
      // completo para o tooltip e o `aria-label`.
      {
        id: 'executar',
        rotulo: item.destino === 'central_ligacoes' ? 'Ligação' : 'Conversa',
        zona: 'baixo',
        // Azul (navegação/abertura) — diferente de "Concluir" (verde, confirmação): abrir a
        // conversa/ligação não conclui nada, só leva para outra tela.
        tom: 'navegacao',
        descricao: item.destino === 'central_ligacoes' ? 'Ir para a ligação — ação recomendada agora para este contato.' : 'Abrir conversa — ação recomendada agora para este contato.',
        onSelecionar: () => onExecutar(item),
      },
      { id: 'concluir', rotulo: 'Concluir', zona: 'direita', tom: 'positivo', onSelecionar: () => onConcluir(item) },
      { id: 'reagendar', rotulo: 'Reagendar', zona: 'cima', onSelecionar: () => onReagendar(item) },
      { id: 'cancelar', rotulo: 'Cancelar', zona: 'esquerda', tom: 'negativo', onSelecionar: () => onCancelarFollowUp(item) },
    )
  }
  if (item.acao === 'ligar') {
    acoesSecundarias.push({ id: 'roteiro', rotulo: 'Roteiro', zona: 'cima', onSelecionar: () => onRoteiro(item) })
  }
  if (item.acao === 'assumir_conversa' || item.acao === 'revisar_proposta') {
    acoesSecundarias.push({ id: 'abrir_conversa', rotulo: 'Abrir conversa', zona: 'direita', tom: 'navegacao', onSelecionar: () => onAbrirHistorico(item.numero) })
  }
  if (item.ia_agendada) {
    // Ação rara e de maior consequência: fica sem zona de propósito, um nível mais
    // fundo na lista — nunca num atalho de um clique só.
    acoesSecundarias.push({
      id: 'cancelar_automatico',
      rotulo: 'Cancelar automático',
      descricao: 'Cancela os follow-ups automáticos agendados deste lead',
      onSelecionar: () => onCancelarAuto(item),
    })
  }

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
        {/* Nome do negócio; telefone formatado só como fallback (já resolvido em
            `rotuloLead`). O rótulo "escalado" saiu: quem precisa de gente é dito pela
            própria próxima ação ("Ligar", "Assumir conversa") e pelo "Por que agora" —
            um selo solto ao lado do nome não dizia o que fazer. */}
        {/* O rótulo é sempre o caminho para a conversa — inclusive quando ele já É o
            telefone. Antes, só o telefone era clicável, e a linha sem nome ficava sem
            porta de entrada para o histórico. */}
        <button
          onClick={() => onAbrirHistorico(item.numero)}
          className="rounded font-medium text-slate-800 hover:text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title="Abrir a conversa deste lead"
        >
          {item.rotulo}
        </button>
        {/* Só a localização (cidade) — negócio/nicho já apareceu no rótulo acima; repeti-lo
            aqui era o mesmo texto duas vezes na mesma linha. `item.contexto` (negócio+cidade)
            continua existindo só para a busca da fila, não para esta linha. */}
        {item.localizacao && (
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <span aria-hidden="true">📍</span>
            {item.localizacao}
          </div>
        )}
        {/* Telefone como linha extra só quando o rótulo é um nome — senão seria o mesmo
            dado duas vezes. */}
        {item.nome && (
          <div className="text-xs tabular-nums text-slate-500">{formatarTelefone(item.telefone_digitos)}</div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {/* Canal: discreto, com ícone E rótulo em texto — cor/glifo nunca sozinhos.
            Item derivado não tem canal escolhido: a célula diz isso em vez de presumir um. */}
        {item.canal ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
            <span aria-hidden="true">{iconeCanal(item.canal)}</span>
            {rotuloCanal(item.canal)}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400" title="Item sem canal escolhido: veio da recomendação ou do motor automático">—</span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${ACAO_STYLE[item.acao || ''] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
          {item.acao_label || '—'}
        </span>
        {naMeta && <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-600" title="Dentro da capacidade diária de ligações configurada para a empresa">na capacidade do dia</div>}
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
        {registrado && (
          <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
            <div>{item.responsavel_nome ? `Responsável: ${item.responsavel_nome}` : 'Não atribuído'}</div>
            {item.campanha_nome && <div>{item.campanha_nome}</div>}
            <button onClick={() => onHistorico(item)} className="text-brand hover:underline">Histórico do contato</button>
          </div>
        )}
        {item.ia_status && (
          <div className="mt-1 text-[11px] text-slate-400">
            IA: {SITUACAO_LABEL[item.ia_status === 'falhou' ? 'falha' : item.ia_status === 'executado' ? 'concluido' : item.ia_status === 'cancelado' ? 'cancelado' : 'aguardando']}
            {item.ia_data_label ? ` · ${item.ia_data_label}` : ''}
          </div>
        )}
      </td>
      <td className="w-40 min-w-[10rem] px-4 py-3 text-center align-top">
        {/* Centralizado, não colado à borda direita: é o que dá folga para o radial abrir sem
            a bolinha "direita" (Concluir) encostar no gatilho central. */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* O nome (coluna Lead) já é um botão que abre a mesma conversa em QUALQUER estado da
              linha — por isso os botões secundários "Ver conversa" que só repetiam
              `onAbrirHistorico` sem nenhum sinal visual próprio já tinham sido removidos daqui.
              "Abrir conversa"/"Ir para a ligação" (`emAberto` e `assumir_conversa`/
              `revisar_proposta`) DOBRARAM para dentro do radial (`acoesSecundarias` acima) —
              nos estados em que essa era a única ação da linha, a linha fica só com o radial.
              Registrar/Copiar prompt/Escrever continuam botões comuns: são ações distintas de
              "abrir a conversa", não compactação do mesmo destino. */}
          {item.acao === 'ligar' && (
            <button onClick={() => onRegistrar(item)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Registrar</button>
          )}
          {item.acao === 'copiar_prompt_preview' && (
            <button onClick={() => onCopiarPrompt(item)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white">Copiar prompt</button>
          )}
          {item.acao === 'mensagem_manual' && (
            <button onClick={() => onManual(item)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Escrever</button>
          )}
          {acoesSecundarias.length > 0 && (
            <MenuRadialAcoes acoes={acoesSecundarias} rotuloContexto={item.rotulo} />
          )}
        </div>
      </td>
    </tr>
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
    <ModalSimples titulo={`📞 Resultado — ${item.rotulo}`} largura="max-w-md" onFechar={onFechar}>
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

// Compositor manual — a antiga aba "Manual". Mesmos endpoints de geração e envio, mesma
// revisão humana antes de enviar; o que mudou é o lugar (ação da fila) e a ENTRADA:
//
//   • Uma caixa só aceita nome do negócio OU telefone, e sugere leads que a empresa já
//     conhece (`GET /manual/leads`, com atraso de 300ms). Selecionar preenche tudo — o
//     operador não redigita nem adivinha o número.
//   • Número sem lead correspondente pode virar conversa nova (`POST /manual/iniciar`),
//     que nasce com o AGENTE PAUSADO e deixa registro de origem em app.auditoria_eventos.
//     O aviso disso fica na tela, antes do clique: é escrita de produção.
//
// A sugestão nunca mostra o identificador do Evolution — só nome e telefone formatado.
// ─────────────── Reagendar um follow-up (move o MESMO item) ───────────────
// Reagendar não é "cancelar e criar outro": o item mantém origem, contexto e rastreabilidade,
// e o histórico do contato não ganha um cancelamento que nunca aconteceu.
function ModalReagendar({ item, responsaveis, onFechar, onConfirmar }: {
  item: ItemFila
  responsaveis: { id: string; nome: string }[]
  onFechar: () => void
  onConfirmar: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [quando, setQuando] = useState(() => paraInputLocal(item.prazo))
  const [acao, setAcao] = useState(item.acao_label || '')
  const [prioridade, setPrioridade] = useState(item.prioridade || 'media')
  const [responsavel, setResponsavel] = useState(item.responsavel_id || '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // Veredito HUMANO sobre o WhatsApp do CONTATO (migration 066), tri-estado. O inicial é o
  // que o backend informou — nunca um palpite da tela.
  const dispInicial = estadoDisponibilidadeInicial(item)
  const [disp, setDisp] = useState(dispInicial)
  const [dispMotivo, setDispMotivo] = useState('')
  const semWhatsapp = disp === false
  // Consequência anunciada ANTES do clique: só há troca de canal quando o item ainda é de
  // WhatsApp. Num item que já é de ligação a marcação continua valendo como fato do contato,
  // mas não move trabalho nenhum.
  const vaiTrocarCanal = semWhatsapp && item.canal === 'whatsapp'

  const confirmar = async () => {
    const iso = deInputLocal(quando)
    if (!iso) { setErro('Informe a nova data e hora.'); return }
    if (!acao.trim()) { setErro('Descreva o que precisa ser feito.'); return }
    setErro(null)
    setSalvando(true)
    try {
      await onConfirmar({
        agendado_para: iso,
        proxima_acao: acao.trim(),
        prioridade,
        // `null` explícito devolve o item para "não atribuído" — é uma escolha, não omissão.
        responsavel_id: responsavel || null,
        // Só vai quando o operador MUDOU o veredito aqui: reenviar o mesmo valor gravaria uma
        // marcação nova e uma linha de auditoria a cada mexida na data.
        ...patchDisponibilidade(dispInicial, disp, dispMotivo),
      })
    } finally { setSalvando(false) }
  }

  return (
    <ModalSimples titulo={`Reagendar — ${item.rotulo}`} onFechar={onFechar}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          A origem ({rotuloOrigem(item.origem) || '—'}) não muda, e o canal ({rotuloCanal(item.canal) || '—'})
          não é um campo deste formulário: trocar de canal à mão é outra decisão, tomada onde a ação é
          executada. Ele só muda como consequência do que você declarar sobre o contato, abaixo.
        </p>
        <label className="block text-sm">O que fazer
          <input value={acao} onChange={(e) => setAcao(e.target.value)}
            className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="block text-sm">Nova data e hora
          <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)}
            className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">Prioridade
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as typeof prioridade)}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
              {PRIORIDADE_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">Responsável
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}
              className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
              <option value="">Não atribuído</option>
              {responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
        </div>
        {/* Disponibilidade de canal do CONTATO (migration 066). Fala do contato, não deste
            item — e é sempre uma afirmação de PESSOA: o sistema nunca conclui "não tem
            WhatsApp" a partir de falha de envio. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={semWhatsapp}
              onChange={(e) => setDisp(alternarSemWhatsapp(dispInicial, e.target.checked))}
            />
            <span>
              <span className="font-medium text-slate-700">{MARCAR_SEM_WHATSAPP_LABEL}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{MARCAR_SEM_WHATSAPP_AJUDA}</span>
            </span>
          </label>
          {/* Estado atual em TEXTO — "não verificado" não pode parecer "não tem". */}
          <p className="mt-2 text-xs text-slate-500">
            Situação registrada hoje: {rotuloDisponibilidadeWhatsapp(dispInicial)}
            {dispInicial === false && item.whatsapp_motivo ? ` — ${item.whatsapp_motivo}` : ''}
            {dispInicial === false ? '. Desmarque para desfazer (Tem WhatsApp).' : ''}
          </p>
          {semWhatsapp && (
            <label className="mt-2 block text-xs text-slate-600">Por quê? (opcional)
              <input
                value={dispMotivo}
                onChange={(e) => setDispMotivo(e.target.value)}
                placeholder="ex.: número só de telefone fixo"
                className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
              />
            </label>
          )}
          {vaiTrocarCanal && (
            <p className="mt-2 text-xs font-medium text-amber-700">{AVISO_TROCA_PARA_LIGACAO}</p>
          )}
          {dispInicial === false && item.canal === 'whatsapp' && (
            <p className="mt-2 text-xs text-amber-700">{AVISO_CANAL_DESCARTADO}</p>
          )}
        </div>
        {erro && <p className="text-xs text-red-600" role="alert">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Voltar</button>
          <button onClick={confirmar} disabled={salvando}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Reagendar'}
          </button>
        </div>
      </div>
    </ModalSimples>
  )
}

// ─────────────── Linha do tempo do contato ───────────────
// Responde "por que esta ação existe": ligações, follow-ups criados e como cada um terminou.
// NÃO repete as mensagens — elas são do painel de conversa, que mostra o histórico inteiro.
function ModalHistoricoContato({ base, item, onFechar }: {
  base: string
  item: ItemFila
  onFechar: () => void
}) {
  const [eventos, setEventos] = useState<EventoContato[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    setEventos(null)
    try {
      const r = await apiFetch<{ eventos: EventoContato[] }>(
        `${base}/contatos/${encodeURIComponent(item.telefone_digitos)}/historico`)
      setEventos(r.data.eventos || [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o histórico.')
    }
  }, [base, item.telefone_digitos])

  useEffect(() => { carregar() }, [carregar])

  return (
    <ModalSimples titulo={`Histórico — ${item.rotulo}`} onFechar={onFechar}>
      {erro ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
          <p>{erro}</p>
          <button onClick={carregar} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium">
            Tentar de novo
          </button>
        </div>
      ) : eventos === null ? (
        <div className="flex justify-center py-10" role="status" aria-live="polite">
          <Spinner /><span className="sr-only">Carregando o histórico…</span>
        </div>
      ) : eventos.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          Ainda não há ligações nem follow-ups registrados para este contato.
        </p>
      ) : (
        <ol className="space-y-2">
          {eventos.map((ev, i) => (
            <li key={`${ev.tipo}-${ev.referencia_id || i}`} className="rounded-xl border bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">{rotuloEvento(ev.tipo)}</span>
                <span className="text-xs tabular-nums text-slate-500">{formatarQuando(ev.ocorrido_em)}</span>
              </div>
              <div className="text-xs text-slate-600">
                {ev.rotulo || '—'}
                {ev.canal ? ` · ${rotuloCanal(ev.canal)}` : ''}
                {ev.detalhe ? ` · ${ev.detalhe}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-slate-400">
        As mensagens não aparecem aqui: elas ficam no painel de conversa, que mostra o histórico completo.
      </p>
    </ModalSimples>
  )
}

function ModalManual({ base, inicial, onFechar, onEnviado, fb }: {
  base: string
  inicial: { numero: string; nome: string }
  onFechar: () => void
  onEnviado: () => void
  fb: ReturnType<typeof useFeedback>
}) {
  // `alvo` = lead já resolvido (veio da fila ou de uma sugestão escolhida).
  const [alvo, setAlvo] = useState<{ numero: string; rotulo: string } | null>(
    inicial.numero ? { numero: inicial.numero, rotulo: inicial.nome || formatarTelefone(inicial.numero) } : null
  )
  const [termo, setTermo] = useState('')
  const [sugestoes, setSugestoes] = useState<SugestaoLead[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [iniciando, setIniciando] = useState(false)
  const [texto, setTexto] = useState('')
  const [gerando, setGerando] = useState(false)

  const termoDigitos = termo.replace(/\D/g, '')
  const podeCriarPorNumero = !alvo && termoDigitos.length >= 10 && termoDigitos.length <= 15

  // Busca com atraso controlado: digitar não dispara uma requisição por tecla, e uma
  // resposta atrasada nunca sobrescreve o resultado de um termo mais novo.
  useEffect(() => {
    if (alvo) return
    const q = termo.trim()
    if (q.length < 2) { setSugestoes([]); setErroBusca(null); setBuscando(false); return }
    let vivo = true
    setBuscando(true)
    const t = setTimeout(() => {
      apiFetch<{ itens: SugestaoLead[] }>(`${base}/manual/leads?q=${encodeURIComponent(q)}`)
        .then((r) => { if (vivo) { setSugestoes(r.data.itens || []); setErroBusca(null) } })
        .catch((e) => { if (vivo) { setSugestoes([]); setErroBusca(e instanceof Error ? e.message : 'Falha na busca.') } })
        .finally(() => { if (vivo) setBuscando(false) })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [base, termo, alvo])

  const iniciarPorNumero = useCallback(async () => {
    setIniciando(true)
    try {
      const r = await apiFetch<{ numero: string; criada: boolean }>(`${base}/manual/iniciar`, {
        method: 'POST', body: JSON.stringify({ numero: termoDigitos }),
      })
      setAlvo({ numero: r.data.numero, rotulo: formatarTelefone(termoDigitos) })
      fb.toast(r.data.criada
        ? 'Conversa criada com o agente pausado. O bot não responderá sozinho.'
        : 'Este número já tinha conversa nesta empresa.', 'success')
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível iniciar a conversa.', 'error')
    } finally { setIniciando(false) }
  }, [base, termoDigitos, fb])

  const gerar = useCallback(async () => {
    if (!alvo) return
    setGerando(true)
    try {
      const r = await apiFetch<{ texto: string }>(`${base}/manual/gerar`, { method: 'POST', body: JSON.stringify({ numero: alvo.numero }) })
      setTexto(r.data.texto)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao gerar', 'error') }
    finally { setGerando(false) }
  }, [base, alvo, fb])

  const enviar = useCallback(async () => {
    if (!alvo || !texto.trim()) { fb.toast('Escreva ou gere a mensagem antes de enviar', 'error'); return }
    await fb.runTask(async () => {
      await apiFetch(`${base}/manual/enviar`, { method: 'POST', body: JSON.stringify({ numero: alvo.numero, texto: texto.trim() }) })
    }, { pesada: true, sucesso: 'Follow-up enviado' })
    onEnviado()
  }, [base, alvo, texto, fb, onEnviado])

  return (
    <ModalSimples titulo={alvo ? `✍ Follow-up manual — ${alvo.rotulo}` : '✍ Follow-up manual'} onFechar={onFechar}>
      {alvo ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{alvo.rotulo}</p>
            <p className="text-xs text-slate-500">Follow-up será enviado para este lead.</p>
          </div>
          <button
            onClick={() => { setAlvo(null); setTermo(''); setTexto('') }}
            className="shrink-0 rounded-lg border px-2.5 py-1 text-xs hover:bg-white"
          >
            Trocar lead
          </button>
        </div>
      ) : (
        <div>
          <label htmlFor="manual-busca" className="mb-1 block text-sm font-medium text-slate-600">
            Buscar lead por nome ou telefone
          </label>
          <input
            id="manual-busca"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            maxLength={80}
            autoComplete="off"
            role="combobox"
            aria-expanded={sugestoes.length > 0}
            aria-controls="manual-sugestoes"
            placeholder="Ex: Padaria do Zé, ou 11987654321"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />

          <div id="manual-sugestoes" role="listbox" aria-label="Leads encontrados" className="mt-2">
            {termo.trim().length > 0 && termo.trim().length < 2 ? (
              <p className="px-1 text-xs text-slate-400">Digite ao menos 2 caracteres.</p>
            ) : buscando ? (
              <p className="px-1 text-xs text-slate-400" role="status">Procurando…</p>
            ) : erroBusca ? (
              <p className="px-1 text-xs text-red-600">{erroBusca}</p>
            ) : sugestoes.length > 0 ? (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border">
                {sugestoes.map((s) => {
                  const rot = s.nome || formatarTelefone(s.telefone_digitos)
                  return (
                    <li key={s.numero}>
                      <button
                        role="option"
                        aria-selected={false}
                        onClick={() => { setAlvo({ numero: s.numero, rotulo: rot }); setSugestoes([]) }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{rot}</span>
                          {s.cidade && <span className="block truncate text-xs text-slate-400">{s.cidade}</span>}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatarTelefone(s.telefone_digitos)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : termo.trim().length >= 2 ? (
              <div className="rounded-xl border border-dashed px-3 py-3">
                <p className="text-xs text-slate-500">Nenhum lead encontrado para “{termo.trim()}”.</p>
                {podeCriarPorNumero ? (
                  <>
                    <p className="mt-1 text-xs text-slate-400">
                      A conversa com <b>{formatarTelefone(termoDigitos)}</b> será criada com o <b>agente pausado</b> — o
                      bot não responderá sozinho até alguém liberar na Central de Mensagens. A origem fica registrada.
                    </p>
                    <button
                      onClick={iniciarPorNumero}
                      disabled={iniciando}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-xs font-medium text-brand hover:bg-blue-50 disabled:opacity-50"
                    >
                      {iniciando ? <Spinner /> : <IconPlus className="h-4 w-4" />}
                      Iniciar follow-up com este número
                    </button>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">
                    Para abrir um follow-up com um número novo, digite o telefone completo com DDD.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {alvo && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="manual-texto" className="block text-sm font-medium text-slate-600">Mensagem</label>
            <button
              onClick={gerar}
              disabled={gerando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1 text-xs font-medium text-brand hover:bg-blue-50 disabled:opacity-50"
            >
              {gerando ? <Spinner /> : <IconGear className="h-4 w-4" />} Gerar por IA
            </button>
          </div>
          <textarea
            id="manual-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={4096}
            placeholder="Escreva a mensagem, ou gere uma sugestão por IA e revise."
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">A IA usa o histórico e o contexto da empresa. Você revisa antes de enviar.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
            <button
              onClick={enviar}
              disabled={!texto.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
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
function PersonalizarFiltros({ view, acoes, responsaveis, onPatch, onLimpar, onFechar }: {
  view: ViewFollowups
  acoes: { valor: string; label: string }[]
  responsaveis: { valor: string; label: string }[]
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
            <Campo label="Canal">
              <select value={view.canal} onChange={(e) => onPatch({ canal: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="ligacao">Ligação</option>
              </select>
            </Campo>
            <Campo label="Origem do atendimento">
              <select value={view.origem} onChange={(e) => onPatch({ origem: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                <option value="humano">Atendimento humano</option>
                <option value="ia">Atendimento IA</option>
              </select>
            </Campo>
            <Campo label="Origem da próxima ação">
              <select value={view.origemAcao} onChange={(e) => onPatch({ origemAcao: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                {Object.entries(ORIGEM_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Campo>
            <Campo label="Responsável">
              <select value={view.responsavel} onChange={(e) => onPatch({ responsavel: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                {responsaveis.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
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
            Canal, origem da próxima ação e responsável só existem em follow-up <b>registrado</b> — item vindo da
            recomendação ou do motor automático fica de fora desses três filtros, em vez de receber um valor presumido.
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
