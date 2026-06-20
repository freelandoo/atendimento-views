'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

type MotionCtx = { reduced: boolean }
const Ctx = createContext<MotionCtx>({ reduced: false })

/** Acesso ao estado de movimento (ex.: desligar WebGL/contadores quando reduzido). */
export function useMotion() {
  return useContext(Ctx)
}

/**
 * Provider global de motion: registra o GSAP/ScrollTrigger uma vez, expõe a
 * preferência de "reduzir movimento" e desenha a barra de varredura neon a cada
 * troca de rota (App Router).
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return (
    <Ctx.Provider value={{ reduced }}>
      <RouteProgress reduced={reduced} />
      {children}
    </Ctx.Provider>
  )
}

/** Barra fina no topo que dá um "flash" de varredura a cada navegação. */
function RouteProgress({ reduced }: { reduced: boolean }) {
  const pathname = usePathname()
  const bar = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    const el = bar.current
    if (!el || reduced) return
    gsap.killTweensOf(el)
    gsap.set(el, { scaleX: 0, opacity: 1, transformOrigin: 'left' })
    gsap
      .timeline()
      .to(el, { scaleX: 0.7, duration: 0.35, ease: 'power2.out' })
      .to(el, { scaleX: 1, duration: 0.25, ease: 'power1.inOut' })
      .to(el, { opacity: 0, duration: 0.3, ease: 'power1.in' }, '+=0.05')
  }, [pathname, reduced])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        ref={bar}
        className="h-full w-full opacity-0"
        style={{
          background: 'linear-gradient(90deg, var(--neon-cyan), var(--neon-magenta))',
          boxShadow: '0 0 12px rgba(34,227,255,.8)',
        }}
      />
    </div>
  )
}
