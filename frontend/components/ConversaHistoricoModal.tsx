'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

// Modal enxuto (somente leitura) do histórico de conversa de um contato. Reusa o MESMO
// endpoint da página de Conversas (GET /api/empresas/:id/conversas/:numero) — sem recriar
// a lógica de conversa. Usado ao clicar no telefone na listagem do Banco de Leads.
type Mensagem = { role?: string; content?: string; text?: string; timestamp?: string }
type ConversaDetail = { numero?: string; historico?: Mensagem[]; estagio?: string }

function fmtNumero(n: string): string {
  return String(n || '').replace('@s.whatsapp.net', '').replace(/^(\d{2})(\d{2})(\d)(\d{4})(\d{4})$/, '+$1 ($2) $3$4-$5')
}
function fmtMMSS(s: number): string {
  const m = Math.floor(s / 60); const ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function ConversaHistoricoModal({
  empresaId, numero, titulo, status, mensagemGerada, podeEnviar, podeGerar, motivoEnvioIndisponivel, cooldownS, enviando, gerando, onEnviar, onGerar, onFechar, onReabrir, onClose,
}: {
  empresaId: string; numero: string; titulo?: string; status?: string
  mensagemGerada?: string | null; podeEnviar?: boolean; podeGerar?: boolean
  motivoEnvioIndisponivel?: string | null
  cooldownS?: number | null; enviando?: boolean; gerando?: boolean
  onEnviar?: () => void; onGerar?: () => void
  onFechar?: () => void; onReabrir?: () => void
  onClose: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [historico, setHistorico] = useState<Mensagem[]>([])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(numero)}`)
      .then((r) => { if (vivo) setHistorico(r.data.historico || []) })
      .catch(() => { if (vivo) setHistorico([]) }) // 404 = sem conversa ainda → estado vazio
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [empresaId, numero])

  const vazio = !carregando && historico.length === 0
  const cooldownAtivo = (cooldownS || 0) > 0
  const podeAcionarEnvio = !!onEnviar && !!podeEnviar && !cooldownAtivo && !enviando
  const podeAcionarGeracao = !!onGerar && !!podeGerar && !gerando
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

        {(mensagemGerada || onEnviar || onGerar || onFechar || onReabrir) && (
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
            {(onFechar || onReabrir) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <span className="text-xs text-slate-500">Status: {status || 'sem status'}</span>
                {status === 'fechado' ? (
                  <button
                    onClick={onReabrir}
                    className="px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50"
                  >
                    Reabrir lead
                  </button>
                ) : (
                  <button
                    onClick={onFechar}
                    className="px-3 py-2 rounded-lg border border-violet-300 text-violet-700 text-sm font-medium hover:bg-violet-50"
                  >
                    Marcar como fechado
                  </button>
                )}
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
