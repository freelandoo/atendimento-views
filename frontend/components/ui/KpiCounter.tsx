'use client'
import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { useMotion } from '@/components/motion/MotionProvider'

/** Número de KPI que conta de 0 até `value` ao montar (respeita reduced-motion). */
export default function KpiCounter({
  value,
  decimals = 0,
  suffix = '',
  className = '',
}: {
  value: number
  decimals?: number
  suffix?: string
  className?: string
}) {
  const { reduced } = useMotion()
  const el = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = el.current
    if (!node) return
    const safe = Number.isFinite(value) ? value : 0
    const fmt = (n: number) =>
      n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix
    if (reduced) { node.textContent = fmt(safe); return }
    const obj = { n: 0 }
    const tween = gsap.to(obj, {
      n: safe,
      duration: 1.1,
      ease: 'power2.out',
      onUpdate: () => { node.textContent = fmt(obj.n) },
    })
    return () => { tween.kill() }
  }, [value, decimals, suffix, reduced])

  return <span ref={el} className={className}>0{suffix}</span>
}
