'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

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
type StatusEvento = {
  id: string
  acao: string
  estado_anterior?: string | null
  estado_novo?: string | null
  contexto?: Record<string, unknown> | null
  ocorrido_em: string
}

const STATUS_LEAD: Record<string, { label: string; detalhe: string; classe: string }> = {
  coletado: { label: 'Sem contato', detalhe: 'Ainda não virou conversa.', classe: 'border-slate-200 bg-slate-50 text-slate-700' },
  contato_encontrado: { label: 'Sem contato', detalhe: 'Telefone encontrado, sem abordagem concluída.', classe: 'border-slate-200 bg-slate-50 text-slate-700' },
  aguardando: { label: 'Sem contato', detalhe: 'Aguardando primeira abordagem.', classe: 'border-slate-200 bg-slate-50 text-slate-700' },
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
  { valor: 'respondido', label: 'Respondido' },
  { valor: 'fechado', label: 'Fechado' },
]
const STATUS_POR_ACAO: Record<string, string> = {
  marcado: 'aprovado',
  contatado: 'enviado',
  respondido: 'respondeu',
  fechado: 'fechado',
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

function rotuloEventoStatus(e: StatusEvento): string {
  if (e.acao === 'abordagem_manual_declarada') return 'Contatado declarado'
  if (e.acao === 'lead_status_alterado') return `${statusLabel(e.estado_anterior)} → ${statusLabel(e.estado_novo)}`
  return e.acao
}

export default function ConversaHistoricoModal({
  empresaId, leadId, numero, titulo, status, mensagemGerada, podeEnviar, podeGerar, motivoEnvioIndisponivel, cooldownS, enviando, gerando, onEnviar, onGerar, onAlterarStatus, onClose,
}: {
  empresaId: string; leadId?: string; numero: string; titulo?: string; status?: string
  mensagemGerada?: string | null; podeEnviar?: boolean; podeGerar?: boolean
  motivoEnvioIndisponivel?: string | null
  cooldownS?: number | null; enviando?: boolean; gerando?: boolean
  onEnviar?: () => void; onGerar?: () => void
  onAlterarStatus?: (status: string) => void | Promise<void>
  onClose: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [historico, setHistorico] = useState<Mensagem[]>([])
  const [historicoStatus, setHistoricoStatus] = useState<StatusEvento[]>([])
  const [carregandoStatus, setCarregandoStatus] = useState(false)
  const [mudandoStatus, setMudandoStatus] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
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

  async function alterarStatus(valor: string) {
    if (!onAlterarStatus) return
    setMudandoStatus(valor)
    try {
      await onAlterarStatus(valor)
      await carregarHistoricoStatus()
    } finally {
      setMudandoStatus(null)
    }
  }

  const vazio = !carregando && historico.length === 0
  const cooldownAtivo = (cooldownS || 0) > 0
  const podeAcionarEnvio = !!onEnviar && !!podeEnviar && !cooldownAtivo && !enviando
  const podeAcionarGeracao = !!onGerar && !!podeGerar && !gerando
  const statusInfo = STATUS_LEAD[String(status || '')] || {
    label: status || 'Sem status',
    detalhe: 'Status atual do lead.',
    classe: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  const textoBotao = enviando
    ? mensagemGerada ? 'Enviando...' : 'Gerando e enviando...'
    : cooldownAtivo
      ? `${mensagemGerada ? 'Enviar' : 'Gerar e enviar'} em ${fmtMMSS(cooldownS || 0)}`
      : mensagemGerada ? 'Enviar mensagem' : 'Gerar e enviar'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-3 border-b">
          <div>
            <h3 className="font-semibold text-lg">Conversa{titulo ? ` — ${titulo}` : ''}</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{fmtNumero(numero)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-50 px-5 py-4 space-y-2 min-h-[160px]">
          {carregando ? (
            <p className="text-sm text-center text-gray-500 py-8">Carregando…</p>
          ) : vazio ? (
            <p className="text-sm text-center text-gray-400 py-10">Nenhuma conversa encontrada para este contato.</p>
          ) : (
            historico.map((m, i) => {
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
          <div className="border-t bg-white px-5 py-4 space-y-3">
            {mensagemGerada ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">Mensagem pronta</span>
                  <span className="text-[11px] text-amber-700">aguardando envio</span>
                </div>
                <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm text-slate-800">
                  {mensagemGerada}
                </div>
              </div>
            ) : motivoEnvioIndisponivel ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {motivoEnvioIndisponivel}{' '}
                <a href="/dashboard/contextos" className="font-semibold underline underline-offset-2">Ir para Instância</a>
              </div>
            ) : podeEnviar ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-slate-700">
                A saudação será gerada e enviada agora para este lead.
              </div>
            ) : null}
            {(onGerar || onEnviar) && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs ${motivoEnvioIndisponivel ? 'text-red-700' : cooldownAtivo ? 'text-amber-700' : podeEnviar ? 'text-emerald-700' : podeGerar ? 'text-slate-600' : 'text-slate-400'}`}>
                  {motivoEnvioIndisponivel || (cooldownAtivo ? `Cooldown ativo: ${fmtMMSS(cooldownS || 0)}` : podeEnviar ? 'Envio liberado' : podeGerar ? 'A mensagem pode ser gerada, mas o envio está indisponível' : 'Envio indisponível para este lead')}
                </span>
                <div className="inline-flex flex-wrap items-center gap-2">
                  {onGerar && mensagemGerada && (
                    <button
                      onClick={onGerar}
                      disabled={!podeAcionarGeracao}
                      className="px-3 py-2 rounded-lg border border-brand text-brand text-sm font-semibold hover:bg-blue-50 disabled:opacity-50"
                    >
                      {gerando ? 'Gerando...' : 'Gerar de novo'}
                    </button>
                  )}
                  {onEnviar && (
                    <button
                      onClick={onEnviar}
                      disabled={!podeAcionarEnvio}
                      className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50 disabled:hover:bg-brand"
                    >
                      {textoBotao}
                    </button>
                  )}
                </div>
              </div>
            )}
            {onAlterarStatus && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Status do lead
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusInfo.classe}`}>
                        {statusInfo.label}
                      </span>
                      <span className="text-xs text-slate-500">{statusInfo.detalhe}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5" aria-label="Alterar status do lead">
                    {STATUS_ACOES.map((a) => {
                      const ativo = STATUS_POR_ACAO[a.valor] === status
                      return (
                        <button
                          key={a.valor}
                          type="button"
                          onClick={() => alterarStatus(a.valor)}
                          disabled={ativo || !!mudandoStatus}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-default disabled:opacity-60 ${ativo ? statusInfo.classe : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
                        >
                          {mudandoStatus === a.valor ? 'Salvando...' : a.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Histórico de status</div>
                  {carregandoStatus ? (
                    <p className="mt-1 text-xs text-slate-400">Carregando histórico…</p>
                  ) : historicoStatus.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {historicoStatus.slice(0, 5).map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs text-slate-600">
                          <span className="font-medium text-slate-700">{rotuloEventoStatus(e)}</span>
                          <span className="text-slate-400">{fmtDataHora(e.ocorrido_em)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">Nenhuma troca registrada ainda.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t flex justify-end">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm">Fechar</button>
        </div>
      </div>
    </div>
  )
}
