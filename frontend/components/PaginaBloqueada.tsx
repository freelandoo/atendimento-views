'use client'
// Tela mostrada quando o plano da empresa não libera o módulo. Explica o que a tela faz, mostra o
// NOME e o VALOR do plano que libera + o que ele entrega, e leva pra Assinatura. Se o plano estiver
// EM CONSTRUÇÃO (ex.: Empresarial), mostra "em breve" sem CTA de compra. Tema claro, tokens.
import Link from 'next/link'
import { infoDoPlano, beneficiosDoPlano } from '@/lib/plano-modulos'
import type { ModuloBloqueavel } from '@/lib/plano-modulos'
import { formatarPreco } from '@/lib/plano'

export default function PaginaBloqueada({ modulo }: { modulo: ModuloBloqueavel }) {
  const info = infoDoPlano(modulo.liberaEm)
  const beneficios = beneficiosDoPlano(modulo.liberaEm)
  const nome = info?.nome || 'pago'
  const emBreve = Boolean(info?.em_construcao)

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-lg border border-line bg-surface p-8 shadow-card">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-ink">{modulo.titulo}</h1>
        <p className="mt-2 text-sm text-ink-2">{modulo.faz}</p>

        <div className="mt-6 rounded-lg border border-brand/20 bg-brand/5 p-5">
          <p className="text-sm font-semibold text-ink">
            {emBreve ? 'Chega no plano' : 'Disponível no plano'} <span className="text-brand">{nome}</span>
            {info ? <span className="font-normal text-ink-2"> · {formatarPreco(info.preco)}/mês</span> : null}
            {emBreve ? <span className="ml-2 rounded-full bg-estado-warn/15 px-2 py-0.5 text-xs font-medium text-estado-warn">em breve</span> : null}
          </p>
          <ul className="mt-3 space-y-2">
            {beneficios.map((b) => (
              <li key={b} className="flex gap-2 text-sm text-ink-2">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true">
                  <path fill="currentColor" d="M8.2 13.3 4.9 10l-1.2 1.2 4.5 4.5 9-9-1.2-1.2z" />
                </svg>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {emBreve ? (
          <p className="mt-6 text-sm text-ink-3">Esse plano está em construção — em breve você poderá assiná-lo aqui.</p>
        ) : (
          <div className="mt-6">
            <Link
              href="/dashboard/plano"
              className="inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              Ver planos e assinar →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
