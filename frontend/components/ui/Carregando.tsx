'use client'
// Espera. Um lugar so, para a tela nao ficar com "Carregando…" solto em 12 formatos.
//
// `role="status"` + `aria-live="polite"` porque quem nao ve o giro precisa ser avisado de que
// a tela esta ocupada — sem interromper o que estiver lendo.
export type CarregandoProps = {
  /** Diga o QUE carrega quando souber ("Carregando leads…"): reduz a sensacao de travamento. */
  texto?: string
  /** `bloco` centraliza numa area vazia; `linha` fica embutido ao lado de um controle. */
  variante?: 'linha' | 'bloco'
  className?: string
}

export default function Carregando({
  texto = 'Carregando…', variante = 'linha', className = '',
}: CarregandoProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 text-sm text-ink-3 ${
        variante === 'bloco' ? 'justify-center py-10' : ''
      } ${className}`}
    >
      <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {texto}
    </div>
  )
}
