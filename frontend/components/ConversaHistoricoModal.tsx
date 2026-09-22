'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  CANAL_OPCOES, PRIORIDADE_OPCOES, montarPayloadProximaAcao, sugerirProximaAcao, validarProximaAcao,
  type FormProximaAcao, type PayloadProximaAcao,
} from '@/lib/follow-up-acao'
import type { AcessoRapido } from '@/lib/lead-acessos'
import { ContatoEditavel } from '@/components/ContatoEditavel'
import { classesFolha, classesFundoFolha } from '@/lib/ui-primitivos'
import Botao from '@/components/ui/Botao'
import { IconClose } from '@/components/ui/icons'
import SeletorSlots from '@/components/SeletorSlots'

// Modal enxuto do Banco de Leads. Reusa o MESMO endpoint da página de Conversas
// (GET /api/empresas/:id/conversas/:numero) — sem recriar a lógica de conversa.
//
// NÃO é o painel de conversa da aplicação: esse é `components/ConversaPainel.tsx`, usado
// pela Central de Mensagens e pela fila de Follow-ups. Este modal existe por causa das props
// de gerar/enviar SAUDAÇÃO (cooldown, template, "Gerar de novo"), que pertencem ao "Rodar
// leads" e não ao atendimento. Ao clicar no telefone na listagem, o operador está decidindo
// um disparo — vê o histórico como contexto dessa decisão.
//
// Se um dia o Banco de Leads precisar do atendimento completo (compositor do operador,
// pausar agente, interesses), a saída é usar `ConversaPainel` e levar a saudação para outro
// lugar — nunca inchar este modal até virar um segundo painel de conversa.
type Mensagem = { role?: string; content?: string; text?: string; timestamp?: string }
type ConversaDetail = { numero?: string; historico?: Mensagem[]; estagio?: string }
type StatusPayload = {
  reuniao?: { data: string; horario: string; duracao_minutos: number; observacoes?: string }
  ligacao?: { resultado: string; duracao_minutos: number; observacoes?: string; follow_up?: PayloadProximaAcao | null }
  descarte?: { motivo: string; observacoes?: string }
}
type StatusEvento = {
  id: string
  acao: string
  estado_anterior?: string | null
  estado_novo?: string | null
  contexto?: Record<string, unknown> | null
  ocorrido_em: string
}

const STATUS_LEAD: Record<string, { label: string; detalhe: string; classe: string }> = {
  coletado: { label: 'Sem contato', detalhe: 'Ainda não virou conversa.', classe: 'border-line bg-surface-2 text-ink-2' },
  contato_encontrado: { label: 'Sem contato', detalhe: 'Telefone encontrado, sem abordagem concluída.', classe: 'border-line bg-surface-2 text-ink-2' },
  aguardando: { label: 'Sem contato', detalhe: 'Aguardando primeira abordagem.', classe: 'border-line bg-surface-2 text-ink-2' },
  aprovado: { label: 'Marcado', detalhe: 'Lead aprovado para o Comercial trabalhar.', classe: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  enviado: { label: 'Contatado', detalhe: 'Mensagem já foi enviada.', classe: 'border-blue-200 bg-blue-50 text-blue-700' },
  respondeu: { label: 'Respondido', detalhe: 'Já respondeu em algum momento.', classe: 'border-orange-200 bg-orange-50 text-orange-700' },
  fechado: { label: 'Fechado', detalhe: 'Negócio marcado como fechado.', classe: 'border-violet-200 bg-violet-50 text-violet-700' },
  rejeitado: { label: 'Rejeitado', detalhe: 'Lead descartado na triagem.', classe: 'border-red-200 bg-red-50 text-red-700' },
  nao_contatar: { label: 'Não contatar', detalhe: 'Lead marcado para não receber contato.', classe: 'border-red-200 bg-red-50 text-red-700' },
}

function fmtNumero(n: string): string {
  return String(n || '').replace('@s.whatsapp.net', '').replace(/^(\d{2})(\d{2})(\d)(\d{4})(\d{4})$/, '+$1 ($2) $3$4-$5')
}
function fmtMMSS(s: number): string {
  const m = Math.floor(s / 60); const ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const STATUS_ACOES: { valor: string; label: string }[] = [
  { valor: 'marcado', label: 'Marcado' },
  { valor: 'contatado', label: 'Contatado' },
  { valor: 'ligacao_realizada', label: 'Ligação feita' },
  { valor: 'respondido', label: 'Respondido' },
  { valor: 'reuniao_agendada', label: 'Reunião' },
  { valor: 'descartado', label: 'Descartado' },
]
const STATUS_POR_ACAO: Record<string, string> = {
  marcado: 'aprovado',
  contatado: 'enviado',
  ligacao_realizada: 'enviado',
  respondido: 'respondeu',
  reuniao_agendada: 'respondeu',
  descartado: 'rejeitado',
}

function statusLabel(status?: string | null): string {
  return STATUS_LEAD[String(status || '')]?.label || (status ? String(status) : 'Sem status')
}

function fmtDataHora(iso?: string | null): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
  } catch { return iso }
}


function hojeInput(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function proximaHoraCheia(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const h = partes.find((p) => p.type === 'hour')?.value || '09'
  return `${h}:00`
}

function rotuloReuniao(e: StatusEvento): string {
  const c = e.contexto || {}
  const data = typeof c.data === 'string' ? c.data : ''
  const horario = typeof c.horario === 'string' ? c.horario : ''
  return data && horario ? `Reunião agendada · ${data} ${horario}` : 'Reunião agendada'
}
function rotuloLigacao(e: StatusEvento): string {
  const c = e.contexto || {}
  const resultado = typeof c.resultado === 'string' ? c.resultado.replaceAll('_', ' ') : ''
  return resultado ? `Ligação realizada · ${resultado}` : 'Ligação realizada'
}

function rotuloDescarte(e: StatusEvento): string {
  const c = e.contexto || {}
  const motivo = typeof c.motivo === 'string' ? c.motivo : ''
  return motivo ? `Descartado · ${motivo}` : 'Descartado'
}

function rotuloFollowUp(e: StatusEvento): string {
  const c = e.contexto || {}
  const acao = typeof c.proxima_acao === 'string' ? c.proxima_acao : ''
  return acao ? `Follow-up criado · ${acao}` : 'Follow-up criado'
}


function rotuloEventoStatus(e: StatusEvento): string {
  if (e.acao === 'abordagem_manual_declarada') return 'Contatado declarado'
  if (e.acao === 'lead_reuniao_agendada') return rotuloReuniao(e)
  if (e.acao === 'lead_ligacao_realizada') return rotuloLigacao(e)
  if (e.acao === 'lead_follow_up_criado') return rotuloFollowUp(e)
  if (e.acao === 'lead_descartado') return rotuloDescarte(e)
  if (e.acao === 'lead_status_alterado') return `${statusLabel(e.estado_anterior)} → ${statusLabel(e.estado_novo)}`
  return e.acao
}

/**
 * Casca compartilhada dos 3 sub-modais de ação (reunião/ligação/descarte). Ela fica presa ao
 * viewport, não ao miolo rolável do modal de conversa; quando era `absolute` dentro do painel,
 * formulários maiores ficavam cortados pelo `overflow-hidden` da moldura principal.
 */
function PainelAcaoConversa({ titulo, descricao, onFechar, rodape, children }: {
  titulo: string
  descricao: string
  onFechar: () => void
  rodape: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/45 px-4 py-6" onClick={onFechar}>
      {/* `role="dialog"` nao e' enfeite: e' por ele que a ficha do lead sabe que ha um
          formulario aberto DENTRO dela e nao fecha tudo no primeiro Escape. */}
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className="max-h-[min(86dvh,760px)] w-full max-w-md overflow-y-auto rounded-lg bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">{titulo}</div>
            <p className="mt-1 text-xs text-ink-3">{descricao}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            <IconClose />
          </button>
        </div>
        {children}
        <div className="mt-3 flex justify-end gap-2">{rodape}</div>
      </div>
    </div>
  )
}

export default function ConversaHistoricoModal({
  empresaId, leadId, numero, titulo, status, acessos, mensagemGerada, podeEnviar, podeGerar, motivoEnvioIndisponivel, cooldownS, enviando, gerando, podeTriarLead = true, onEnviar, onGerar, onAlterarStatus, onSalvarTelefone, onClose, variante = 'modal',
}: {
  /** JID do contato. Vem VAZIO quando o lead ainda não tem telefone — nesse caso o modal
      abre assim mesmo (o lead tem links, status e histórico), declarando a pendência em vez
      de fingir uma conversa que não existe. Ver `telefonePendente`. */
  empresaId: string; leadId?: string; numero: string; titulo?: string; status?: string
  /** Acessos rapidos do lead (rede social, site, ficha no Maps). Chegam PRONTOS de
      `lib/lead-acessos.js` — este modal so desenha, nao decide o que e' site. */
  acessos?: AcessoRapido[]
  mensagemGerada?: string | null; podeEnviar?: boolean; podeGerar?: boolean
  motivoEnvioIndisponivel?: string | null
  cooldownS?: number | null; enviando?: boolean; gerando?: boolean
  podeTriarLead?: boolean
  onEnviar?: () => void; onGerar?: () => void
  onAlterarStatus?: (status: string, payload?: StatusPayload) => void | Promise<void>
  /** Salva o telefone do lead. OPCIONAL: sem ele o número é só texto, como era antes.
      É aqui que a EDIÇÃO do número vive — na listagem ela ocupava espaço na linha sem ser o
      trabalho mais frequente. Quem valida (formato, número já usado por outro lead) é o
      backend; este modal não conhece a regra. */
  onSalvarTelefone?: (telefone: string) => Promise<void>
  onClose: () => void
  /**
   * `'modal'` (padrao) = a folha flutuante de sempre, com fundo proprio.
   *
   * `'embutido'` = so o CONTEUDO, para viver como a aba "Conversa" da ficha lateral
   * (`components/FichaLead.tsx`), que ja fornece a moldura, o cabecalho do lead e o fechar.
   * Nao existe um SEGUNDO componente de conversa no Banco de Leads — seria a duplicacao que
   * `ConversaPainel` (Central de Mensagens / Follow-ups) ja documenta como proibida.
   */
  variante?: 'modal' | 'embutido'
}) {
  const [carregando, setCarregando] = useState(true)
  const [historico, setHistorico] = useState<Mensagem[]>([])
  const [historicoStatus, setHistoricoStatus] = useState<StatusEvento[]>([])
  const [carregandoStatus, setCarregandoStatus] = useState(false)
  const [mudandoStatus, setMudandoStatus] = useState<string | null>(null)
  const [modalAcao, setModalAcao] = useState<null | 'reuniao' | 'ligacao' | 'descarte'>(null)
  const [dataReuniao, setDataReuniao] = useState(hojeInput)
  const [horarioReuniao, setHorarioReuniao] = useState(proximaHoraCheia)
  const [duracaoReuniao, setDuracaoReuniao] = useState(30)
  const [observacoesReuniao, setObservacoesReuniao] = useState('')
  const [resultadoLigacao, setResultadoLigacao] = useState('atendeu')
  const [duracaoLigacao, setDuracaoLigacao] = useState(5)
  const [observacoesLigacao, setObservacoesLigacao] = useState('')
  const [proxAcaoLigacao, setProxAcaoLigacao] = useState<FormProximaAcao>(() => sugerirProximaAcao('atendeu'))
  const [errosProxAcao, setErrosProxAcao] = useState<Record<string, string>>({})
  const [motivoDescarte, setMotivoDescarte] = useState('')
  const [observacoesDescarte, setObservacoesDescarte] = useState('')

  useEffect(() => {
    let vivo = true
    // Sem telefone não há conversa a buscar: pedir `/conversas/` sem número seria uma
    // requisição que só pode falhar, e o estado de pendência já é a resposta certa.
    if (!numero) { setHistorico([]); setCarregando(false); return }
    setCarregando(true)
    apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(numero)}`)
      .then((r) => { if (vivo) setHistorico(r.data.historico || []) })
      .catch(() => { if (vivo) setHistorico([]) }) // 404 = sem conversa ainda → estado vazio
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [empresaId, numero])

  const carregarHistoricoStatus = useCallback(async () => {
    if (!leadId) { setHistoricoStatus([]); return }
    setCarregandoStatus(true)
    try {
      const r = await apiFetch<StatusEvento[]>(`/api/empresas/${empresaId}/banco-leads/leads/${leadId}/status-historico`)
      setHistoricoStatus(r.data || [])
    } catch {
      setHistoricoStatus([])
    } finally {
      setCarregandoStatus(false)
    }
  }, [empresaId, leadId])

  useEffect(() => {
    carregarHistoricoStatus()
  }, [carregarHistoricoStatus])

  async function alterarStatus(valor: string, payload?: StatusPayload) {
    if (!onAlterarStatus) return
    if (valor === 'reuniao_agendada' && !payload) { setModalAcao('reuniao'); return }
    if (valor === 'ligacao_realizada' && !payload) { setModalAcao('ligacao'); return }
    if (valor === 'descartado' && !payload) { setModalAcao('descarte'); return }
    setMudandoStatus(valor)
    try {
      await onAlterarStatus(valor, payload)
      if (valor === 'reuniao_agendada') {
        setModalAcao(null)
        setObservacoesReuniao('')
      }
      if (valor === 'ligacao_realizada') {
        setModalAcao(null)
        setObservacoesLigacao('')
        setProxAcaoLigacao(sugerirProximaAcao(resultadoLigacao))
        setErrosProxAcao({})
      }
      if (valor === 'descartado') {
        setModalAcao(null)
        setMotivoDescarte('')
        setObservacoesDescarte('')
      }
      await carregarHistoricoStatus()
    } finally {
      setMudandoStatus(null)
    }
  }

  async function salvarReuniao() {
    await alterarStatus('reuniao_agendada', {
      reuniao: {
        data: dataReuniao,
        horario: horarioReuniao,
        duracao_minutos: duracaoReuniao,
        observacoes: observacoesReuniao,
      },
    })
  }

  function trocarResultadoLigacao(valor: string) {
    setResultadoLigacao(valor)
    setProxAcaoLigacao(sugerirProximaAcao(valor))
    setErrosProxAcao({})
  }

  async function salvarLigacao() {
    const validacao = validarProximaAcao(proxAcaoLigacao)
    if (!validacao.ok) { setErrosProxAcao(validacao.erros); return }
    await alterarStatus('ligacao_realizada', {
      ligacao: {
        resultado: resultadoLigacao,
        duracao_minutos: duracaoLigacao,
        observacoes: observacoesLigacao,
        follow_up: montarPayloadProximaAcao(proxAcaoLigacao),
      },
    })
  }

  async function salvarDescarte() {
    await alterarStatus('descartado', {
      descarte: {
        motivo: motivoDescarte,
        observacoes: observacoesDescarte,
      },
    })
  }

  // Telefone pendente: o lead existe e é trabalhável (links, status, histórico), mas não há
  // canal de WhatsApp — nem conversa para mostrar, nem mensagem para enviar.
  const telefonePendente = !numero
  const vazio = !carregando && !telefonePendente && historico.length === 0
  const cooldownAtivo = (cooldownS || 0) > 0
  const podeAcionarEnvio = !!onEnviar && !!podeEnviar && !cooldownAtivo && !enviando
  const podeAcionarGeracao = !!onGerar && !!podeGerar && !gerando
  const statusInfo = STATUS_LEAD[String(status || '')] || {
    label: status || 'Sem status',
    detalhe: 'Status atual do lead.',
    classe: 'border-line bg-surface-2 text-ink-2',
  }
  const textoBotao = enviando
    ? mensagemGerada ? 'Enviando...' : 'Gerando e enviando...'
    : cooldownAtivo
      ? `${mensagemGerada ? 'Enviar' : 'Gerar e enviar'} em ${fmtMMSS(cooldownS || 0)}`
      : mensagemGerada ? 'Enviar mensagem' : 'Gerar e enviar'
  const acoesStatusVisiveis = podeTriarLead
    ? STATUS_ACOES
    : STATUS_ACOES.filter((a) => a.valor !== 'marcado')
  const valorSlotReuniao = dataReuniao && horarioReuniao ? `${dataReuniao} ${horarioReuniao}` : null

  const conteudo = (
      <>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-lg">{telefonePendente ? 'Lead' : 'Conversa'}{titulo ? ` — ${titulo}` : ''}</h3>
            {/* Numero + acessos rapidos na MESMA linha: o operador confere de onde veio o
                lead (rede social, site, ficha no Maps) sem sair da conversa. Some quando o
                lead nao tem link nenhum — cabecalho nao desenha estado vazio. */}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {telefonePendente ? (
                <>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                    title="Este lead entrou na base sem telefone. Sem número não há WhatsApp nem conversa."
                  >
                    Telefone pendente
                  </span>
                  {/* A pendência é declarada e RESOLVÍVEL no mesmo lugar: sem isto o operador
                      leria "falta telefone" e teria de voltar à listagem para digitá-lo. */}
                  {onSalvarTelefone && (
                    <ContatoEditavel
                      value={null}
                      onSave={onSalvarTelefone}
                      rotuloVazio="+ telefone"
                      placeholder="DDD + número"
                      tipo="tel"
                      titulo="Adicionar o telefone deste lead"
                      largura="w-36"
                    />
                  )}
                </>
              ) : onSalvarTelefone ? (
                /* O número É o controle: clicar nele abre para escrever. Um botão "editar" ao
                   lado diria a mesma coisa ocupando mais espaço — e na listagem era exatamente
                   esse espaço que faltava. O `title` é o que revela a ação para quem não
                   descobriria pelo hover. */
                <ContatoEditavel
                  /* Dígitos, nunca o JID: o campo abre com o que a pessoa reconhece como o
                     número, não com `...@s.whatsapp.net`. */
                  value={String(numero).replace(/\D/g, '')}
                  onSave={onSalvarTelefone}
                  rotuloVazio="+ telefone"
                  placeholder="DDD + número"
                  tipo="tel"
                  titulo="Clique para corrigir o telefone deste lead"
                  largura="w-36"
                  classeValor="rounded font-mono text-xs text-ink-3 underline decoration-dotted decoration-slate-300 underline-offset-2 hover:text-brand hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {fmtNumero(numero)}
                </ContatoEditavel>
              ) : (
                <span className="font-mono text-xs text-ink-3">{fmtNumero(numero)}</span>
              )}
              {(acessos || []).map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  target="_blank"
                  rel="noreferrer"
                  title={a.dica}
                  aria-label={a.dica}
                  className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2 transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {a.rotulo}<span aria-hidden="true" className="text-ink-3">↗</span>
                </a>
              ))}
            </div>
          </div>
          {/* Alvo de 44px: o × de 12px era, no telefone, o menor alvo da tela inteira.
              No modo embutido o × e' o da ficha — dois no mesmo canto seriam dois controles
              para a mesma acao. */}
          {variante === 'modal' && (
            <button type="button" onClick={onClose} aria-label="Fechar"
              className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              <IconClose />
            </button>
          )}
        </div>

        {/* Sem historico, esta area encolhe: o aviso curto fica colado no bloco de acoes
            (aviso de conexao + status), em vez de empurra-lo para fora da tela com um
            estado vazio de dez linhas de altura. */}
        <div className={`flex-1 overflow-y-auto bg-gray-50 px-5 space-y-2 ${telefonePendente || (vazio && !carregando) ? 'py-2 min-h-0' : 'py-4 min-h-[160px]'}`}>
          {telefonePendente ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900">Este lead ainda não tem telefone.</p>
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                Sem número não há conversa de WhatsApp para mostrar, nem mensagem para enviar.
                Os acessos rápidos acima, o status e o histórico abaixo continuam disponíveis.
              </p>
            </div>
          ) : carregando ? (
            <p className="text-sm text-center text-gray-500 py-8">Carregando…</p>
          ) : vazio ? (
            <p className="text-center text-xs text-ink-3">Nenhuma conversa ainda com este contato.</p>
          ) : (
            historico.map((m, i) => {
              const isUser = m.role === 'user'
              const isAssistant = m.role === 'assistant'
              const isOperator = m.role === 'operator'
              const bubble = isUser
                ? 'bg-surface border border-gray-200 mr-auto'
                : isAssistant
                  ? 'bg-brand text-white ml-auto'
                  : isOperator
                    ? 'bg-amber-100 text-amber-900 ml-auto'
                    : 'bg-gray-200 text-gray-700 mx-auto'
              const label = isUser ? 'Lead' : isAssistant ? 'Agente' : isOperator ? 'Operador' : (m.role || '?')
              return (
                <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${bubble}`}>
                  <div className={`text-[10px] uppercase mb-0.5 ${isAssistant ? 'text-white/70' : 'text-gray-500'}`}>{label}</div>
                  <div className="whitespace-pre-wrap break-words">{m.content || m.text || '(vazio)'}</div>
                </div>
              )
            })
          )}
        </div>

        {(mensagemGerada || onEnviar || onGerar || onAlterarStatus) && (
          <div className="border-t bg-surface px-5 py-4 space-y-3">
            {mensagemGerada && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">Mensagem pronta</span>
                  <span className="text-[11px] text-amber-700">aguardando envio</span>
                </div>
                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm text-ink">
                  {mensagemGerada}
                </div>
              </div>
            )}
            {/* O aviso aparece SEMPRE que o envio esta bloqueado — inclusive com a mensagem ja
                gerada, caso em que antes ele sumia e sobrava so um botao desabilitado sem
                explicacao. Enquanto ele estiver de pe, Gerar/Enviar nao sao oferecidos: o
                proximo passo e' resolver a conexao, e botao inerte so convida ao clique. */}
            {telefonePendente ? (
              /* A conexão da instância não é o bloqueio aqui: falta o canal. Mostrar o aviso
                 de instância mandaria o operador reconectar um número que não resolveria nada. */
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Sem telefone cadastrado, este lead não recebe mensagem. Dá para trabalhar por
                outro canal (rede social ou site, acima) e registrar o resultado no status abaixo.
              </div>
            ) : motivoEnvioIndisponivel ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {motivoEnvioIndisponivel}{' '}
                <a href="/dashboard/contextos" className="font-semibold underline underline-offset-2">Ir para Instância</a>
              </div>
            ) : !mensagemGerada && podeEnviar ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-ink-2">
                A saudação será gerada e enviada agora para este lead.
              </div>
            ) : null}
            {!telefonePendente && !motivoEnvioIndisponivel && (onGerar || onEnviar) && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs ${cooldownAtivo ? 'text-amber-700' : podeEnviar ? 'text-emerald-700' : podeGerar ? 'text-ink-2' : 'text-ink-3'}`}>
                  {cooldownAtivo ? `Cooldown ativo: ${fmtMMSS(cooldownS || 0)}` : podeEnviar ? 'Envio liberado' : podeGerar ? 'A mensagem pode ser gerada, mas o envio está indisponível' : 'Envio indisponível para este lead'}
                </span>
                <div className="inline-flex flex-wrap items-center gap-2">
                  {onGerar && mensagemGerada && (
                    <Botao variante="secundaria" onClick={onGerar} disabled={!podeAcionarGeracao} carregando={gerando}>
                      Gerar de novo
                    </Botao>
                  )}
                  {onEnviar && (
                    <Botao variante="primaria" onClick={onEnviar} disabled={!podeAcionarEnvio} carregando={enviando}>
                      {textoBotao}
                    </Botao>
                  )}
                </div>
              </div>
            )}
            {onAlterarStatus && (
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                      {podeTriarLead ? 'Status do lead' : 'Ações comerciais'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusInfo.classe}`}>
                        {statusInfo.label}
                      </span>
                      <span className="text-xs text-ink-3">{statusInfo.detalhe}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label="Alterar status do lead">
                    {acoesStatusVisiveis.map((a) => {
                      const ativo = !['reuniao_agendada', 'ligacao_realizada'].includes(a.valor) && STATUS_POR_ACAO[a.valor] === status
                      return (
                        <button
                          key={a.valor}
                          type="button"
                          onClick={() => alterarStatus(a.valor)}
                          disabled={ativo || !!mudandoStatus}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-default disabled:opacity-60 ${ativo ? statusInfo.classe : 'border-line bg-surface text-ink-2 hover:bg-surface-3'}`}
                        >
                          {mudandoStatus === a.valor ? 'Salvando...' : a.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-3 border-t border-line pt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Histórico de status</div>
                  {carregandoStatus ? (
                    <p className="mt-1 text-xs text-ink-3">Carregando histórico…</p>
                  ) : historicoStatus.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {historicoStatus.slice(0, 5).map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5 text-xs text-ink-2">
                          <span className="font-medium text-ink-2">{rotuloEventoStatus(e)}</span>
                          <span className="text-ink-3">{fmtDataHora(e.ocorrido_em)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-ink-3">Nenhuma troca registrada ainda.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {modalAcao === 'reuniao' && (
          <PainelAcaoConversa
            titulo="Agendar reunião"
            descricao="Só será marcado quando você salvar. Vai para a agenda de quem está alterando."
            onFechar={() => setModalAcao(null)}
            rodape={
              <>
                <Botao variante="neutra" tamanho="sm" onClick={() => setModalAcao(null)}>Cancelar</Botao>
                <Botao variante="primaria" tamanho="sm" onClick={salvarReuniao}
                  disabled={!dataReuniao || !horarioReuniao} carregando={mudandoStatus === 'reuniao_agendada'}>
                  Salvar reunião
                </Botao>
              </>
            }
          >
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-ink-2">Dia
                <input type="date" value={dataReuniao} onChange={(e) => setDataReuniao(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-ink-2">Duração
                <select value={duracaoReuniao} onChange={(e) => setDuracaoReuniao(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm">
                  <option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hora</option>
                </select>
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-ink">Horários disponíveis</div>
                  <p className="text-[11px] text-ink-3">Clique em um horário livre para preencher a reunião.</p>
                </div>
                <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2">
                  {horarioReuniao || '--:--'}
                </span>
              </div>
              <SeletorSlots
                empresaId={empresaId}
                dataInicial={dataReuniao}
                dias={1}
                duracaoMin={duracaoReuniao}
                valor={valorSlotReuniao}
                onEscolher={(data, horario) => { setDataReuniao(data); setHorarioReuniao(horario) }}
                compacto
              />
            </div>
            <label className="mt-2 block text-xs text-ink-2">Horário selecionado
              <input type="time" value={horarioReuniao} onChange={(e) => setHorarioReuniao(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
            </label>
            <label className="mt-2 block text-xs text-ink-2">Observações rápidas
              <textarea value={observacoesReuniao} onChange={(e) => setObservacoesReuniao(e.target.value)} rows={3} placeholder="Ex.: confirmar orçamento, falar com sócio, enviar proposta antes da reunião…" className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
            </label>
          </PainelAcaoConversa>
        )}

        {modalAcao === 'ligacao' && (
          <PainelAcaoConversa
            titulo="Registrar ligação realizada"
            descricao="Registra a ligação no histórico e marca o lead como contatado."
            onFechar={() => setModalAcao(null)}
            rodape={
              <>
                <Botao variante="neutra" tamanho="sm" onClick={() => setModalAcao(null)}>Cancelar</Botao>
                <Botao variante="primaria" tamanho="sm" onClick={salvarLigacao}
                  carregando={mudandoStatus === 'ligacao_realizada'}>
                  Salvar ligação
                </Botao>
              </>
            }
          >
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs text-ink-2">Resultado
                <select value={resultadoLigacao} onChange={(e) => trocarResultadoLigacao(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm">
                  <option value="atendeu">Atendeu</option><option value="nao_atendeu">Não atendeu</option><option value="ocupado">Ocupado</option><option value="caixa_postal">Caixa postal</option><option value="numero_invalido">Número inválido</option><option value="reagendou">Reagendou</option>
                </select>
              </label>
              <label className="text-xs text-ink-2">Duração
                <select value={duracaoLigacao} onChange={(e) => setDuracaoLigacao(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm">
                  <option value={1}>1 min</option><option value={3}>3 min</option><option value={5}>5 min</option><option value={10}>10 min</option><option value={15}>15 min</option><option value={30}>30 min</option>
                </select>
              </label>
            </div>
            <label className="mt-2 block text-xs text-ink-2">Observações da ligação
              <textarea value={observacoesLigacao} onChange={(e) => setObservacoesLigacao(e.target.value)} rows={3} placeholder="Ex.: pediu retorno amanhã, não era decisor, demonstrou interesse…" className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
            </label>
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Próxima ação</div>
              <div className="inline-flex w-full rounded-lg border bg-surface p-0.5" role="group" aria-label="Canal da próxima ação">
                {CANAL_OPCOES.map((o) => (
                  <button key={o.valor} type="button" onClick={() => { setProxAcaoLigacao((f) => ({ ...f, canal: o.valor })); setErrosProxAcao({}) }} aria-pressed={proxAcaoLigacao.canal === o.valor}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${proxAcaoLigacao.canal === o.valor ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-2'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-ink-3">{CANAL_OPCOES.find((o) => o.valor === proxAcaoLigacao.canal)?.ajuda}</p>
              {proxAcaoLigacao.canal !== 'nenhuma' && (
                <>
                  <label className="block text-xs text-ink-2">O que fazer
                    <input value={proxAcaoLigacao.proxima_acao} onChange={(e) => { setProxAcaoLigacao((f) => ({ ...f, proxima_acao: e.target.value })); setErrosProxAcao({}) }} placeholder="Ex.: retomar pelo preço" className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${errosProxAcao.proxima_acao ? 'border-red-400' : 'border-line'}`} />
                    {errosProxAcao.proxima_acao && <span className="mt-0.5 block text-[11px] text-red-600">{errosProxAcao.proxima_acao}</span>}
                  </label>
                  <label className="block text-xs text-ink-2">Quando
                    <input type="datetime-local" value={proxAcaoLigacao.agendado_para} onChange={(e) => { setProxAcaoLigacao((f) => ({ ...f, agendado_para: e.target.value })); setErrosProxAcao({}) }} className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${errosProxAcao.agendado_para ? 'border-red-400' : 'border-line'}`} />
                    {errosProxAcao.agendado_para && <span className="mt-0.5 block text-[11px] text-red-600">{errosProxAcao.agendado_para}</span>}
                  </label>
                  <label className="block text-xs text-ink-2">Prioridade
                    <select value={proxAcaoLigacao.prioridade || 'media'} onChange={(e) => setProxAcaoLigacao((f) => ({ ...f, prioridade: e.target.value as FormProximaAcao['prioridade'] }))} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm">
                      {PRIORIDADE_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                    </select>
                  </label>
                  <p className="text-[11px] text-ink-3">Se salvar, entra na fila de Follow-ups já ligado a esta ligação.</p>
                </>
              )}
            </div>
          </PainelAcaoConversa>
        )}

        {modalAcao === 'descarte' && (
          <PainelAcaoConversa
            titulo="Descartar lead"
            descricao="Informe o motivo. Se sair sem salvar, nada será alterado."
            onFechar={() => setModalAcao(null)}
            rodape={
              <>
                <Botao variante="neutra" tamanho="sm" onClick={() => setModalAcao(null)}>Cancelar</Botao>
                <Botao variante="perigosa" tamanho="sm" onClick={salvarDescarte}
                  disabled={!motivoDescarte.trim()} carregando={mudandoStatus === 'descartado'}>
                  Descartar lead
                </Botao>
              </>
            }
          >
            <label className="mt-3 block text-xs text-ink-2">Motivo do descarte
              <input value={motivoDescarte} onChange={(e) => setMotivoDescarte(e.target.value)} placeholder="Ex.: sem perfil, número inválido, sem interesse…" className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
            </label>
            <label className="mt-2 block text-xs text-ink-2">Observações
              <textarea value={observacoesDescarte} onChange={(e) => setObservacoesDescarte(e.target.value)} rows={3} placeholder="Detalhe rápido para a equipe entender a decisão." className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
            </label>
          </PainelAcaoConversa>
        )}

        {/* No modo embutido quem fecha e' a ficha: um segundo "Fechar" dentro dela fecharia a
            mesma coisa duas vezes e ocuparia a linha onde as acoes do lead moram. */}
        {variante === 'modal' && (
          <div className="px-5 py-3 border-t border-line flex justify-end">
            <Botao variante="neutra" onClick={onClose}>Fechar</Botao>
          </div>
        )}
      </>
  )

  if (variante === 'embutido') {
    // `min-h-0 flex-1 flex-col`: a area de mensagens usa `flex-1 overflow-y-auto`, entao ela
    // precisa de um pai com altura limitada — sem `min-h-0` o flex nao deixa o filho encolher
    // e a conversa empurra o rodape da ficha para fora da tela.
    return <div className="flex min-h-0 flex-1 flex-col">{conteudo}</div>
  }

  return (
    /* A geometria vem do PRIMITIVO (`lib/ui-primitivos.js`): folha inferior no celular, modal
       centrado a partir de `sm`. Escrevê-la à mão aqui criaria uma segunda régua — foi assim
       que os três modais desta tela acabaram com três alturas e três larguras diferentes.
       O `max-w-lg` anterior também era estreito demais para uma conversa no computador. */
    <div className={classesFundoFolha()} onClick={onClose}>
      <div className={classesFolha({ tamanho: 'md', extra: 'relative' })} onClick={(e) => e.stopPropagation()}>
        {/* Alça: só no celular, onde a folha sobe de baixo. */}
        <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        {conteudo}
      </div>
    </div>
  )
}
