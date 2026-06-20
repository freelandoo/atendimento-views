type Variant = 'solid' | 'ghost' | 'danger' | 'success'

const STYLES: Record<Variant, string> = {
  solid:
    'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 hover:bg-neon-cyan/25 hover:shadow-glow-cyan',
  success:
    'bg-neon-lime/15 text-neon-lime border border-neon-lime/40 hover:bg-neon-lime/25 hover:shadow-glow-lime',
  danger:
    'bg-neon-red/10 text-neon-red border border-neon-red/40 hover:bg-neon-red/20',
  ghost:
    'bg-white/[0.03] text-mid border border-white/10 hover:bg-white/[0.07] hover:text-hi',
}

/** Botão HUD: vidro + borda neon + glow no hover. */
export default function NeonButton({
  variant = 'solid',
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${STYLES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
