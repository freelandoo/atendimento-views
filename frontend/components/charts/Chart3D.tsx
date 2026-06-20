'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import NeonProgress from '@/components/ui/NeonProgress'
import { useMotion } from '@/components/motion/MotionProvider'

export type Bar = { label: string; value: number; tone?: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }

// A cena WebGL só é baixada no client e quando o card entra na viewport.
const Bars3DScene = dynamic(() => import('./Bars3DScene'), {
  ssr: false,
  loading: () => <SceneFallback />,
})

/**
 * Wrapper de gráfico 3D: lazy + ssr:false + só renderiza quando visível.
 * Cai para barras 2D (acessível e leve) quando há reduced-motion ou sem WebGL.
 */
export default function Chart3D({
  data,
  height = 280,
  className = '',
}: {
  data: Bar[]
  height?: number
  className?: string
}) {
  const { reduced } = useMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [webgl, setWebgl] = useState(true)

  useEffect(() => {
    try {
      const c = document.createElement('canvas')
      setWebgl(!!(c.getContext('webgl2') || c.getContext('webgl')))
    } catch { setWebgl(false) }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: '120px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  if (reduced || !webgl) {
    return <Bars2D data={data} className={className} />
  }

  return (
    <div ref={ref} className={`overflow-hidden rounded-xl ${className}`} style={{ height }}>
      {visible ? <Bars3DScene data={data} /> : <SceneFallback />}
    </div>
  )
}

function SceneFallback() {
  return (
    <div className="grid h-full w-full place-items-center bg-[#070b16]">
      <div className="w-40">
        <NeonProgress />
        <p className="mt-2 text-center text-xs text-lo">Renderizando 3D…</p>
      </div>
    </div>
  )
}

const TONE_BG: Record<string, string> = {
  cyan: 'linear-gradient(180deg,#22e3ff,#0e7c93)',
  magenta: 'linear-gradient(180deg,#ff3df0,#7a1c73)',
  lime: 'linear-gradient(180deg,#7cff6b,#2f8f28)',
  amber: 'linear-gradient(180deg,#ffb020,#8a5e0c)',
  violet: 'linear-gradient(180deg,#9d7bff,#4a3a8a)',
}
const ORDER = ['cyan', 'magenta', 'lime', 'amber', 'violet']

/** Fallback 2D pseudo-3D: barras com perspectiva leve, acessível e sem WebGL. */
function Bars2D({ data, className = '' }: { data: Bar[]; className?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className={`flex h-[280px] items-end justify-around gap-3 rounded-xl bg-[#070b16] p-5 ${className}`}>
      {data.map((d, i) => {
        const tone = d.tone || ORDER[i % ORDER.length]
        const h = Math.round((d.value / max) * 100)
        return (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className="font-mono text-xs text-hi">{d.value}</span>
            <div
              className="w-full max-w-[48px] rounded-t-md"
              style={{ height: `${h}%`, background: TONE_BG[tone], boxShadow: `0 0 18px ${tone === 'magenta' ? 'rgba(255,61,240,.4)' : 'rgba(34,227,255,.4)'}` }}
            />
            <span className="line-clamp-1 text-center text-[10px] text-lo">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}
