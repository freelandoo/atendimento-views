'use client'
// Painel de DETALHE de uma conversa — ponto unico, para qualquer tela que precise abrir uma
// conversa.
//
// Por que existe: Central de Mensagens e Follow-ups sao apenas PORTAS DE ENTRADA diferentes
// para a mesma conversa. Antes, o Historico abria este painel (inline, dentro de
// `dashboard/conversas/page.tsx`) e o "Abrir conversa" da fila de Follow-ups abria o
// `ConversaHistoricoModal`, que so LE o historico: o operador que chegava pela fila nao tinha
// compositor do operador, orientacao de resposta, pausar/retomar agente, reenviar WhatsApp,
// prioridade comercial nem a aba de Interesses — para a MESMA conversa, com as MESMAS
// permissoes (`GET/POST /api/empresas/:id/conversas/:numero…`, `requireAuth` +
// `requireEmpresaAccess` nos dois caminhos). A divergencia era 100% de apresentacao.
//
// Contrato com quem abre:
//   • a tela passa `numero` e `onFechar` — nada mais. Origem de entrada muda so o DESTINO do
//     fechamento; nunca dados, permissoes ou acoes disponiveis;
//   • `onAtualizou` avisa que algo mudou no servidor (mensagem enviada, agente pausado,
//     historico apagado), para a lista de tras recarregar. Opcional: quem nao passa, nao
//     recarrega — o painel nao conhece a lista de ninguem.
//
// O painel CARREGA a conversa sozinho, a partir do numero. Isso e o que garante as tres
// regras de carregamento em qualquer porta de entrada:
//   1. estado de carregando explicito;
//   2. troca rapida de conversa nunca mostra o conteudo da anterior (token de requisicao +
//      limpeza do estado a cada `numero`);
//   3. erro tem mensagem simples e "Tentar de novo" — nao vira estado vazio silencioso.
//
// `ConversaHistoricoModal` continua existindo para o Banco de Leads: la ele carrega props de
// gerar/enviar SAUDACAO, que sao do "Rodar leads" e nao deste painel.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconPause, IconPlay, IconSend, IconStar, IconThumbDown, IconThumbUp } from '@/components/ui/icons'
import { identidadeConversa } from '@/lib/lead-identidade'
import BolinhaPontuacao from '@/components/ui/BolinhaPontuacao'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import TextoTruncado from '@/components/ui/TextoTruncado'
import { VARIANTES, O_QUE_MEDE, fatoresDeInteresse } from '@/lib/pontuacao-indicador'
import AlternadorModoIa from '@/components/ui/AlternadorModoIa'
import {
  avisoDoCompositor,
  descreverPreferencia,
  explicarOrigem,
  houveMudancaDePreferencia,
  normalizarPreferencia,
  opcoesDePreferencia,
  preverEfetivo,
  rotuloAcessivel,
} from '@/lib/conversa-modo-ia'
import type { PreferenciaModoIa } from '@/lib/conversa-modo-ia'

export type ScoreCriterio = {
  delta: number
  titulo: string
  detalhe?: string
  tipo?: 'positivo' | 'negativo' | 'neutro'
}

/** O que qualquer tela precisa saber de uma conversa para mostrar prioridade comercial. */
export type ConversaResumo = {
  numero: string
  estagio: string
  status: string
  negocio?: string
  /**
   * Nome ja RESOLVIDO pelo backend (`lead-nome-exibicao.js`): nome do WhatsApp e, na falta
   * dele, nome do Google Maps. `null` = nenhuma fonte tinha nome valido. A tela nao recalcula
   * a prioridade; ver `lib/lead-identidade.js`.
   */
  nome_exibicao?: string | null
  /** De onde saiu o nome acima: 'whatsapp' | 'google_maps' | null. */
  nome_exibicao_fonte?: 'whatsapp' | 'google_maps' | null
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

type Mensagem = { role?: string; content?: string; text?: string; timestamp?: string }

type ConversaDetail = ConversaResumo & {
  historico?: Mensagem[]
  agente_pausado?: boolean
  /**
   * Politica de resposta da conversa, TODA calculada no backend e entregue pelo
   * `GET /conversas/:numero` — nao ha requisicao extra e a tela nao recalcula a
   * precedencia (excecao da conversa > padrao da Central).
   *
   *   modo_ia         PREFERENCIA desta conversa: herdar | conversa | analise.
   *                   `herdar` = sem excecao (o default).
   *   modo_ia_padrao  o padrao da Central de Mensagens, para a tela poder dizer o que a
   *                   conversa esta herdando.
   *   modo_ia_efetivo o que vale AGORA.
   *   modo_ia_origem  excecao | herdado.
   *
   * Nada disso e' derivado de `agente_pausado`, nem o substitui: a pausa e' temporaria,
   * nasce do atendimento humano e o envio exige os dois liberados.
   */
  modo_ia?: string | null
  modo_ia_padrao?: string | null
  modo_ia_efetivo?: string | null
  modo_ia_origem?: string | null
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

const TEMP_STYLE: Record<string, { label: string; cls: string }> = {
  quente: { label: '🔥 Quente', cls: 'bg-orange-100 text-orange-700' },
  morno: { label: '🌤️ Morno', cls: 'bg-amber-100 text-amber-700' },
  frio: { label: '❄️ Frio', cls: 'bg-sky-100 text-sky-700' },
}

const ROTULO_FAIXA_INTERESSE: Record<string, string> = { alto: 'alto', medio: 'medio', baixo: 'baixo' }

export function scoreValue(score?: number | null) {
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null
}

export function TempBadge({ t }: { t?: string | null }) {
  if (!t || !TEMP_STYLE[t]) return <span className="text-gray-400 text-xs">—</span>
  return <span className={`px-2 py-0.5 rounded-full text-xs ${TEMP_STYLE[t].cls}`}>{TEMP_STYLE[t].label}</span>
}

/**
 * Bolinha de INTERESSE COMERCIAL da conversa. Antes era um circulo inline com `title=` apenas:
 * sem foco por teclado, sem `aria-label` e sem os criterios — que a API JA mandava em
 * `score_interesse_criterios`. O resumo de uma linha escondia a informacao mais util da
 * pontuacao: os deltas NEGATIVOS. "Interesse 38" e' muito diferente de "38 porque pediu preco e
 * depois recusou", e so' o segundo diz o que fazer.
 *
 * Nenhum calculo aqui: score, faixa, rotulo e criterios vem prontos de
 * `services/lead-interest-score.js`.
 */
export function InteresseBadge({ c, compact = false }: {
  c: Pick<ConversaResumo,
    'score_interesse' | 'score_interesse_faixa' | 'score_interesse_label' | 'score_interesse_resumo'
    | 'score_interesse_criterios' | 'score_interesse_mensagens_lead'>
  compact?: boolean
}) {
  const score = scoreValue(c.score_interesse)
  const faixa = c.score_interesse_faixa || 'baixo'
  const label = c.score_interesse_label || `Interesse ${ROTULO_FAIXA_INTERESSE[faixa] || 'baixo'}`
  const msgs = c.score_interesse_mensagens_lead ?? 0
  const bolinha = (
    <BolinhaPontuacao
      valor={score}
      maximo={100}
      faixa={faixa}
      titulo={label}
      oQueMede={O_QUE_MEDE.interesse_conversa}
      fatores={fatoresDeInteresse(c.score_interesse_criterios)}
      nota={msgs ? `${msgs} mensagem${msgs > 1 ? 's' : ''} do lead analisada${msgs > 1 ? 's' : ''}.` : undefined}
      variante={VARIANTES.PRIORIDADE}
      rotuloSemValor="Interesse ainda não calculado"
    />
  )
  if (compact) return bolinha
  return (
    <div className="inline-flex min-w-0 items-center gap-2">
      {bolinha}
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

export default function ConversaPainel({ empresaId, numero, onFechar, onAtualizou, contextoOrigem, abaInicial }: {
  empresaId: string
  numero: string
  /** Destino do fechamento — a UNICA coisa que a origem de entrada pode mudar. */
  onFechar: () => void
  /** Avisa a tela de tras que algo mudou no servidor. Opcional. */
  onAtualizou?: () => void
  /**
   * Contexto do EVENTO que originou a abertura (ex.: o follow-up criado numa ligacao).
   * Sao DADOS prontos, nunca uma requisicao: quem abre ja os tem, e o painel e o mesmo nas
   * duas portas de entrada — buscar aqui obrigaria a Central de Mensagens (que nao e
   * admin-only) a chamar uma rota admin-only e tomar 403.
   * Apresentacao pura: nao muda dados, permissoes nem acoes disponiveis.
   */
  contextoOrigem?: { titulo: string; linhas: string[] } | null
  /**
   * Aba com que o painel abre ('chat' por padrao). Deep-link aditivo: quem abre a partir de
   * um botao "Detalhes" ao lado do interesse (Central de Mensagens) passa 'interesses' aqui —
   * dado pronto de quem chama, nao uma rota nem query string nova.
   */
  abaInicial?: 'chat' | 'interesses'
}) {
  const fb = useFeedback()
  const [aberta, setAberta] = useState<ConversaDetail | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [naoEncontrada, setNaoEncontrada] = useState(false)

  const [apagando, setApagando] = useState(false)
  const [confirmarApagar, setConfirmarApagar] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [mensagemManual, setMensagemManual] = useState('')
  const [enviandoManual, setEnviandoManual] = useState(false)
  const [alterandoPausa, setAlterandoPausa] = useState(false)
  const [alterandoModo, setAlterandoModo] = useState(false)
  const [composerAberto, setComposerAberto] = useState(false)
  const [orientandoResposta, setOrientandoResposta] = useState(false)
  const [orientacaoResposta, setOrientacaoResposta] = useState<OrientacaoResposta | null>(null)
  const [abaModal, setAbaModal] = useState<'chat' | 'interesses'>('chat')
  const [feedbacksMensagem, setFeedbacksMensagem] = useState<Record<number, FeedbackState>>({})
  const [feedbackNegativo, setFeedbackNegativo] = useState<{ index: number; observacao: string; tags: string[] } | null>(null)

  // Token de requisicao: so a resposta do ULTIMO numero pedido escreve na tela. Sem isso,
  // trocar de conversa rapido deixaria a resposta atrasada da anterior aparecer como se
  // fosse da nova selecao.
  const requisicao = useRef(0)

  const carregarConversa = useCallback(async () => {
    if (!empresaId || !numero) return
    const meu = ++requisicao.current
    // Limpar ANTES de pedir: enquanto carrega, a tela nao mostra nada da conversa anterior.
    setAberta(null)
    setErro(null)
    setNaoEncontrada(false)
    setCarregando(true)
    setMensagemManual('')
    setOrientacaoResposta(null)
    setComposerAberto(false)
    setAbaModal(abaInicial || 'chat')
    setFeedbacksMensagem({})
    setFeedbackNegativo(null)
    try {
      const r = await apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(numero)}`)
      if (meu !== requisicao.current) return
      setAberta(r.data)
    } catch (e: unknown) {
      if (meu !== requisicao.current) return
      // 404 nao e falha: e um contato que ainda nao tem conversa nesta empresa. Merece
      // estado vazio explicativo, nao um alarme com "Tentar de novo".
      if ((e as { status?: number })?.status === 404) setNaoEncontrada(true)
      else setErro(e instanceof Error ? e.message : 'Não foi possível carregar a conversa.')
    } finally {
      if (meu === requisicao.current) setCarregando(false)
    }
  }, [empresaId, numero, abaInicial])

  useEffect(() => { carregarConversa() }, [carregarConversa])

  // Escape fecha o painel, como nos demais modais da aplicacao.
  useEffect(() => {
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [onFechar])

  const avisar = useCallback(() => { onAtualizou?.() }, [onAtualizou])

  async function deletarHistorico() {
    if (!aberta || !empresaId) return
    setApagando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/historico`, { method: 'DELETE' }),
        { sucesso: 'Histórico apagado.' })
      setAberta((p) => p ? { ...p, historico: [], estagio: 'primeiro_contato' } : p)
      await new Promise((r) => setTimeout(r, 200))
      avisar()
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
      avisar()
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
      avisar()
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setAlterandoPausa(false) }
  }

  /**
   * Troca a PREFERENCIA de modo desta conversa (`herdar` remove a excecao).
   *
   * OTIMISTA: o controle responde no clique, porque o efeito vale so' para mensagens
   * futuras e esperar a rede faria o operador clicar duas vezes. A previsao local
   * (`preverEfetivo`) so' existe para o intervalo do request — a resposta do servidor
   * sobrescreve, e o backend continua sendo a autoridade sobre o modo efetivo.
   *
   * Falhou, VOLTA ao estado anterior INTEIRO e o erro aparece: a tela nunca pode afirmar
   * "Análise" enquanto o backend continua em "Conversa", que e' onde o cliente sentiria a
   * diferenca.
   */
  async function alterarModoIa(nova: PreferenciaModoIa) {
    if (!aberta || !empresaId || alterandoModo) return
    const anterior = {
      modo_ia: aberta.modo_ia,
      modo_ia_padrao: aberta.modo_ia_padrao,
      modo_ia_efetivo: aberta.modo_ia_efetivo,
      modo_ia_origem: aberta.modo_ia_origem,
    }
    if (!houveMudancaDePreferencia(anterior.modo_ia, nova)) return
    setAlterandoModo(true)
    const previsto = preverEfetivo({ preferencia: nova, modoPadrao: anterior.modo_ia_padrao })
    setAberta((p) => p ? { ...p, ...previsto } : p)
    try {
      const r = await fb.runTask(
        () => apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/modo-ia`, {
          method: 'PATCH',
          body: JSON.stringify({ modo: nova }),
        }),
        { sucesso: `Modo desta conversa: ${descreverPreferencia(nova).rotulo}.` }
      )
      setAberta((p) => p ? {
        ...p,
        modo_ia: r.data.modo_ia,
        modo_ia_padrao: r.data.modo_ia_padrao,
        modo_ia_efetivo: r.data.modo_ia_efetivo,
        modo_ia_origem: r.data.modo_ia_origem,
      } : p)
      avisar()
    } catch {
      setAberta((p) => p ? { ...p, ...anterior } : p)
    } finally {
      setAlterandoModo(false)
    }
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

  // Identidade HUMANA do contato: nome do negocio em destaque, telefone como linha
  // secundaria. O identificador tecnico do Evolution nunca e a informacao principal.
  // Enquanto carrega, o numero pedido ja da o telefone — o titulo nao "pisca" vazio.
  const identidade = identidadeConversa(aberta || { numero })
  const historicoAberto = aberta?.historico || []
  const ultimaMensagemAberta = historicoAberto[historicoAberto.length - 1]
  const podeReenviarUltimaResposta = ultimaMensagemAberta?.role === 'assistant'
  const criteriosInteresse = aberta?.score_interesse_criterios || []
  // Aviso no compositor: existe quando a IA nao vai responder — por modo, por pausa, ou
  // pelos dois. Aponta o caminho que JA existe para o atendente obter uma sugestao da IA,
  // revisar e enviar ele mesmo.
  const avisoModo = aberta
    ? avisoDoCompositor({ modoEfetivo: aberta.modo_ia_efetivo, agentePausado: aberta.agente_pausado })
    : null

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Conversa com ${identidade.titulo}`}
        className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-2.5 border-b flex justify-between items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-[220px] max-w-full">
              <h3 className="font-semibold text-base">
                <TextoTruncado texto={identidade.titulo} className="max-w-full" />
              </h3>
              {identidade.temNome && identidade.telefone && (
                <p className="text-xs tabular-nums text-slate-500">{identidade.telefone}</p>
              )}
              {aberta && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Estágio: <span className="font-medium">{aberta.estagio}</span> ·
                  Status: <span className="font-medium">{aberta.status}</span> ·
                  {aberta.historico?.length || 0} msgs
                </p>
              )}
            </div>
            {aberta && (
              <div className="min-w-[380px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-[200px] flex-1">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prioridade comercial</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <InteresseBadge c={aberta} compact />
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
                  {/* "Modo desta conversa" dividindo espaco com Prioridade comercial, no mesmo
                      cartao — decisao de produto (2026-08-14): o controle de pausa do agente
                      passou a viver ao lado deste bloco (ver "Agente" abaixo), entao os dois
                      ficaram fisicamente proximos de proposito. `modo_ia` (preferencia
                      persistente desta conversa) e `agente_pausado` (pausa efemera, escrita
                      pelo proprio atendimento) continuam sendo DUAS coisas diferentes — a
                      proximidade visual e so isso, proximidade; o titulo/tooltip de cada
                      controle segue explicito sobre o que cada um faz, e o aviso no
                      compositor (`avisoDoCompositor`) e quem fala da combinacao dos dois. */}
                  <div className="min-w-[220px] shrink-0 border-slate-200 sm:border-l sm:pl-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Modo desta conversa
                    </div>
                    <AlternadorModoIa
                      opcoes={opcoesDePreferencia()}
                      selecionado={normalizarPreferencia(aberta.modo_ia)}
                      onMudar={(id) => alterarModoIa(id as PreferenciaModoIa)}
                      ocupado={alterandoModo}
                      compacto
                      // Mesmo mecanismo do controle GLOBAL (`dashboard/conversas/page.tsx`): o
                      // parágrafo fixo com o modo efetivo e a origem saiu da tela e virou o texto
                      // do balão — a opção marcada já mostra a escolha, e o balão diz o que está
                      // valendo agora. A pausa tem aviso próprio no compositor logo abaixo
                      // (`avisoDoCompositor`); repeti-la aqui duplicaria o mesmo aviso.
                      ajuda={explicarOrigem({
                        origem: aberta.modo_ia_origem,
                        modoEfetivo: aberta.modo_ia_efetivo,
                        modoPadrao: aberta.modo_ia_padrao,
                      })}
                      ariaLabel={rotuloAcessivel({
                        modoEfetivo: aberta.modo_ia_efetivo,
                        origem: aberta.modo_ia_origem,
                        modoPadrao: aberta.modo_ia_padrao,
                      })}
                    />
                  </div>
                </div>
              </div>
            )}
            {aberta && (
              <div className="flex shrink-0 items-center gap-2 self-center rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-xs text-slate-400">
                  {alterandoPausa ? 'Atualizando…' : aberta.agente_pausado ? 'Agente pausado' : 'Agente ativo'}
                </span>
                <button
                  type="button"
                  onClick={() => alterarPausaAgente(!aberta.agente_pausado)}
                  disabled={alterandoPausa}
                  title={aberta.agente_pausado ? 'Retomar agente' : 'Pausar agente'}
                  aria-label={aberta.agente_pausado ? 'Retomar agente' : 'Pausar agente'}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {alterandoPausa ? (
                    <Spinner size={12} />
                  ) : aberta.agente_pausado ? (
                    <IconPlay className="h-3.5 w-3.5" />
                  ) : (
                    <IconPause className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}
            {contextoOrigem && contextoOrigem.linhas.length > 0 && (
              <div className="min-w-[260px] rounded-lg border border-brand/30 bg-blue-50/60 px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
                  {contextoOrigem.titulo}
                </div>
                <ul className="space-y-0.5 text-xs text-slate-600">
                  {contextoOrigem.linhas.map((linha, i) => <li key={i}>{linha}</li>)}
                </ul>
              </div>
            )}
            {aberta?.ultima_falha_resposta_em && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                Falha no envio: {aberta.ultima_falha_resposta_msg || aberta.ultima_falha_resposta_codigo || 'erro desconhecido'}
              </div>
            )}
          </div>
          <button
            onClick={onFechar}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {carregando ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-gray-50 px-6 py-16" role="status" aria-live="polite">
            <Spinner size={22} />
            <p className="text-sm text-slate-500">Carregando a conversa…</p>
          </div>
        ) : erro ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-gray-50 px-6 py-16 text-center">
            <p className="text-sm text-red-700">{erro}</p>
            <button
              onClick={carregarConversa}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Tentar de novo
            </button>
          </div>
        ) : naoEncontrada || !aberta ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-gray-50 px-6 py-16 text-center">
            <p className="text-sm text-slate-500">Nenhuma conversa encontrada para este contato.</p>
            <p className="text-xs text-slate-400">A conversa aparece aqui assim que houver a primeira mensagem.</p>
          </div>
        ) : (
          <>
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
                  {!aberta.historico || aberta.historico.length === 0 ? (
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
                  {avisoModo && (
                    <div className="mb-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span className="font-semibold">{avisoModo.titulo}.</span> {avisoModo.texto}
                    </div>
                  )}
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
          </>
        )}

        <div className="px-5 py-2.5 border-t flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setConfirmarApagar(true)}
              disabled={!aberta || apagando || !aberta.historico?.length}
              className="text-xs px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {apagando ? 'Apagando…' : 'Deletar histórico'}
            </button>
            <button
              onClick={reenviarUltimaResposta}
              disabled={!aberta || reenviando || !podeReenviarUltimaResposta}
              className="text-xs px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reenviando ? 'Reenviando...' : 'Reenviar WhatsApp'}
            </button>
          </div>
          <button
            onClick={onFechar}
            className="text-sm px-3 py-2 border rounded-lg"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
    {/* Fora da <div> de fundo do painel (onClick={onFechar}): ModalConfirmar tem seu
        próprio backdrop, sem stopPropagation nele. Aninhado ali dentro, clicar no fundo
        do ModalConfirmar borbulharia para o onClick do painel e fecharia os dois de uma
        vez — por isso vira irmão, não filho. */}
    {aberta && confirmarApagar && (
      <ModalConfirmar
        titulo="Apagar histórico"
        corpo={`Apagar TODO o histórico de ${identidade.titulo}?`}
        aviso="Isso limpa as mensagens, reseta o estágio e despausa o agente. A próxima mensagem do contato vai começar do zero. Ação irreversível."
        rotuloConfirmar="Apagar histórico"
        tom="perigo"
        ocupado={apagando}
        onConfirmar={() => { setConfirmarApagar(false); deletarHistorico() }}
        onCancelar={() => setConfirmarApagar(false)}
      />
    )}
    </>
  )
}
