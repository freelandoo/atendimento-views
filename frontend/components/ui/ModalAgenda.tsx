'use client'
import { useEffect, ReactNode } from 'react'

// Shell genérico do painel "Agenda" (modal central). Usado pelas duas frentes de
// Aquisição (Google Places e Instagram) para reunir filtros + frequência + Rodar.
// Apenas apresentação: o conteúdo e o rodapé (ações) vêm de cada página.
export default function ModalAgenda({
  aberto,
  titulo,
  subtitulo,
  onFechar,
  children,
  rodape,
}: {
  aberto: boolean
  titulo: string
  subtitulo?: string
  onFechar: () => void
  children: ReactNode
  rodape?: ReactNode
}) {
  // Fecha no ESC e trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [aberto, onFechar])

  if (!aberto) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white shadow-xl" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-sm text-slate-500">{subtitulo}</p>}
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{rodape}</div>}
      </div>
    </div>
  )
}
