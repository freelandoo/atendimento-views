'use client'
// Tela mostrada quando o plano da empresa não libera o módulo. Explica o que a tela faz e qual
// plano a libera, com CTA para Assinatura. Tema claro (área de trabalho), tokens.
import Link from 'next/link'
import { planoQueLibera } from '@/lib/plano-modulos'
import type { ModuloBloqueavel } from '@/lib/plano-modulos'

export default function PaginaBloqueada({ modulo }: { modulo: ModuloBloqueavel }) {
  const plano = planoQueLibera(modulo)
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-lg border border-line bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-ink-3" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-ink">{modulo.titulo}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{modulo.faz}</p>
        <p className="mt-4 inline-block rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-sm font-medium text-brand">
          Disponível no plano {plano}
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard/plano"
            className="inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Ver planos e assinar →
          </Link>
        </div>
      </div>
    </div>
  )
}
