'use client'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { useMotion } from '@/components/motion/MotionProvider'

type Tone = 'cyan' | 'magenta' | 'lime' | 'amber'
const FILL: Record<Tone, string> = {
  cyan: 'linear-gradient(90deg,#22e3ff,#9d7bff)',
  magenta: 'linear-gradient(90deg,#ff3df0,#9d7bff)',
  lime: 'linear-gradient(90deg,#7cff6b,#22e3ff)',
  amber: 'linear-gradient(90deg,#ffb020,#ff3df0)',
}
const GLOW: Record<Tone, string> = {
  cyan: 'rgba(34,227,255,.55)',
  magenta: 'rgba(255,61,240,.5)',
  lime: 'rgba(124,255,107,.5)',
  amber: 'rgba(255,176,32,.5)',
}

/**
 * Barra de carregamento neon. Determinada (com `value` 0–100) anima a largura;
 * indeterminada (sem `value`) roda a varredura contínua — substitui spinners.
 */
export default function NeonProgress({
  value,
  tone = 'cyan',
  className = '',
}: {
  value?: number
  tone?: Tone
  className?: string
}) {
  const { reduced } = useMotion()
  const fill = useRef<HTMLDivElement>(null)
  const indeterminate = value == null

  useEffect(() => {
    if (indeterminate || !fill.current) return
    const pct = Math.max(0, Math.min(100, value ?? 0))
    if (reduced) { gsap.set(fill.current, { width: `${pct}%` }); return }
    gsap.to(fill.current, { width: `${pct}%`, duration: 0.8, ease: 'power3.out' })
  }, [value, indeterminate, reduced])

  return (
    <div className={`relative h-2 overflow-hidden rounded-full bg-white/5 ${className}`}>
      <div
        ref={fill}
        className={`relative h-full rounded-full ${indeterminate ? 'w-2/5 neon-sweep' : 'w-0'}`}
        style={{
          background: FILL[tone],
          boxShadow: `0 0 14px ${GLOW[tone]}`,
          ...(indeterminate
            ? { animation: reduced ? 'none' : 'pulse-glow 1.6s ease-in-out infinite' }
            : {}),
        }}
      />
    </div>
  )
}
