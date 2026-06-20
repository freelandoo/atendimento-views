import { forwardRef } from 'react'

type Tone = 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' | 'neutral'

const BORDER: Record<Tone, string> = {
  cyan: 'hover:border-neon-cyan/50 hover:shadow-glow-cyan',
  magenta: 'hover:border-neon-magenta/50 hover:shadow-glow-magenta',
  lime: 'hover:border-neon-lime/50 hover:shadow-glow-lime',
  amber: 'hover:border-neon-amber/50',
  violet: 'hover:border-neon-violet/50',
  neutral: 'hover:border-white/15',
}

/**
 * Card de vidro com borda neon que acende no hover. Base de toda superfície.
 */
const NeonCard = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }>(
  function NeonCard({ tone = 'neutral', className = '', children, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={`glass rounded-2xl transition-[box-shadow,border-color,transform] duration-300 ${BORDER[tone]} ${className}`}
        {...rest}
      >
        {children}
      </div>
    )
  }
)

export default NeonCard
