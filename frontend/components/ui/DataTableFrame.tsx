'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type DataTableFrameProps = {
  children: ReactNode
  className?: string
  viewportClassName?: string
  scrollbarClassName?: string
  maxHeightClassName?: string
  ariaLabel?: string
}

export default function DataTableFrame({
  children,
  className = '',
  viewportClassName = '',
  scrollbarClassName = 'border-b bg-slate-50',
  maxHeightClassName = 'max-h-[calc(100dvh-12rem)]',
  ariaLabel = 'Rolagem horizontal da tabela',
}: DataTableFrameProps) {
  const topRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const [contentWidth, setContentWidth] = useState(0)
  const [hasHorizontalScroll, setHasHorizontalScroll] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const table = viewport.querySelector('table')
    const measure = () => {
      setContentWidth(viewport.scrollWidth)
      setHasHorizontalScroll(viewport.scrollWidth > viewport.clientWidth + 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    if (table) observer.observe(table)
    return () => observer.disconnect()
  }, [])

  function syncScroll(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (!target || syncingRef.current || target.scrollLeft === source.scrollLeft) return
    syncingRef.current = true
    target.scrollLeft = source.scrollLeft
    requestAnimationFrame(() => { syncingRef.current = false })
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={topRef}
        onScroll={(event) => syncScroll(event.currentTarget, viewportRef.current)}
        className={`${hasHorizontalScroll ? 'block' : 'hidden'} w-full overflow-x-scroll overflow-y-hidden [scrollbar-gutter:stable] ${scrollbarClassName}`}
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div className="h-px" style={{ width: contentWidth }} />
      </div>
      <div
        ref={viewportRef}
        onScroll={(event) => syncScroll(event.currentTarget, topRef.current)}
        className={`${maxHeightClassName} min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 ${viewportClassName}`}
      >
        {children}
      </div>
    </div>
  )
}
