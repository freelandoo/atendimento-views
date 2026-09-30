'use client'
// Compositor do operador — escreve/envia uma mensagem pelo WhatsApp e pede "Orientar resposta"
// (sugestão da IA com base no contexto/interesses da conversa). Extraído do `ConversaPainel` para
// ser reusado também na ficha do lead aberta pela Central de Mensagens, sem duplicar a lógica.
//
// Os endpoints são os MESMOS do ConversaPainel: POST /:numero/mensagem e /:numero/orientador-resposta.
// Envio "assume" a conversa (o mesmo contrato). `onEnviado` devolve a conversa atualizada para quem
// mantém estado (o ConversaPainel atualiza `aberta`; a ficha usa para o que precisar).
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import { IconStar, IconSend } from '@/components/ui/icons'
import type { ConversaDetail, OrientacaoResposta } from '@/components/ConversaPainel'

export default function CompositorOperador({
  empresaId, numero, avisoModo = null, avisoDono, onEnviado,
}: {
  empresaId: string
  numero: string
  /** Aviso de que a IA não vai responder (modo/pausa) — some quando não se aplica. */
  avisoModo?: { titulo: string; texto: string } | null
  /** Aviso de que a conversa é de outro atendente. Nunca impede, só avisa. */
  avisoDono?: { avisar: boolean; texto: string }
  onEnviado?: (data: ConversaDetail) => void
}) {
  const fb = useFeedback()
  const [composerAberto, setComposerAberto] = useState(false)
  const [mensagemManual, setMensagemManual] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [orientando, setOrientando] = useState(false)
  const [orientacao, setOrientacao] = useState<OrientacaoResposta | null>(null)

  // Troca de conversa limpa o rascunho e a orientação — senão o texto de um lead apareceria no outro.
  useEffect(() => {
    setMensagemManual('')
    setOrientacao(null)
    setComposerAberto(false)
  }, [numero])

  async function enviar() {
    if (!empresaId || !numero) return
    const texto = mensagemManual.trim()
    if (!texto) { fb.toast('Escreva a mensagem antes de enviar.', 'error'); return }
    setEnviando(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(numero)}/mensagem`, {
          method: 'POST',
          body: JSON.stringify({ texto, assumir: true }),
        }),
        { sucesso: 'Mensagem enviada e conversa assumida.' }
      )
      setMensagemManual('')
      setOrientacao(null)
      setComposerAberto(false)
      onEnviado?.(r.data)
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setEnviando(false) }
  }

  async function orientar() {
    if (!empresaId || !numero) return
    setOrientando(true)
    setComposerAberto(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<OrientacaoResposta>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(numero)}/orientador-resposta`, {
          method: 'POST',
          body: JSON.stringify({ rascunho: mensagemManual.trim() }),
        }),
        { sucesso: 'Resposta orientada.' }
      )
      setOrientacao(r.data)
      setMensagemManual(r.data.resposta || '')
    } catch { /* erro ja exibido pelo feedback */ }
    finally { setOrientando(false) }
  }

  return (
    <div className={`border-t bg-white px-4 transition-all duration-200 sm:px-6 ${composerAberto ? 'py-4' : 'py-2'}`}>
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
        {/* A conversa e' de outra pessoa: AVISO, nunca impedimento. */}
        {avisoDono?.avisar && (
          <p className="w-full rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-800">
            {avisoDono.texto}
          </p>
        )}
        <button
          type="button"
          onClick={orientar}
          disabled={orientando}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconStar className="h-3.5 w-3.5" />
          {orientando ? 'Orientando...' : 'Orientar resposta'}
        </button>
      </div>
      <div className={`grid transition-all duration-200 ${composerAberto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="min-h-0 overflow-hidden">
          {orientacao && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Por que essa resposta</div>
              <p className="leading-relaxed">{orientacao.explicacao}</p>
              {orientacao.alertas && orientacao.alertas.length > 0 && (
                <div className="mt-2 text-xs text-amber-800">{orientacao.alertas.join(' ')}</div>
              )}
            </div>
          )}
          <div className="relative">
            <textarea
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
              onClick={enviar}
              disabled={enviando || !mensagemManual.trim()}
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
  )
}
