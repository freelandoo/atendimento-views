'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Prioridade = 'critica' | 'alta' | 'media' | 'baixa'

type Notificacao = {
  id: string
  tipo: string
  grupo: string
  prioridade: Prioridade
  titulo: string
  descricao: string | null
  total: number
  quando: string | null
  destino_url: string
  acao_label: string
}

type Centro = {
  itens: Notificacao[]
  resumo: {
    total: number
    criticas: number
    grupos: Record<string, number>
    rotulo: string
  }
}

const PRIORIDADE_CLASSE: Record<Prioridade, string> = {
  critica: 'border-red-200 bg-red-50 text-red-700',
  alta: 'border-amber-200 bg-amber-50 text-amber-800',
  media: 'border-blue-200 bg-blue-50 text-blue-700',
  baixa: 'border-line bg-surface-2 text-ink-2',
}

const PONTO_CLASSE: Record<Prioridade, string> = {
  critica: 'bg-estado-danger',
  alta: 'bg-estado-warn',
  media: 'bg-estado-info',
  baixa: 'bg-ink-3',
}

function horaCurta(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export default function CentralNotificacoes() {
  const pathname = usePathname()
  const raizRef = useRef<HTMLDivElement | null>(null)
  const [aberto, setAberto] = useState(false)
  const [dados, setDados] = useState<Centro | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const empresaId = useMemo(() => (typeof window !== 'undefined' ? getEmpresaId() : ''), [])
  const total = dados?.resumo?.total || 0
  const criticas = dados?.resumo?.criticas || 0
  const itens = dados?.itens || []

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    try {
      const r = await apiFetch<Centro>(`/api/empresas/${empresaId}/notificacoes`, { timeoutMs: 30000 })
      setDados(r.data)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Nao foi possivel carregar as notificacoes.')
    } finally {
      setCarregando(false)
    }
  }, [empresaId])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 45000)
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => {
    setAberto(false)
  }, [pathname])

  useEffect(() => {
    if (!aberto) return
    const onDown = (ev: MouseEvent) => {
      if (!raizRef.current?.contains(ev.target as Node)) setAberto(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [aberto])

  return (
    <div ref={raizRef} className="fixed right-4 top-16 z-[90] md:right-6 md:top-5">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={total ? `Abrir notificacoes: ${dados?.resumo?.rotulo}` : 'Abrir notificacoes'}
        aria-expanded={aberto}
        className={`relative grid h-11 w-11 place-items-center rounded-full border bg-surface text-ink shadow-lg transition hover:-translate-y-0.5 hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
          total ? 'animate-float-y border-brand/40' : 'border-line'
        }`}
      >
        <BellIcon className="h-5 w-5" />
        {total > 0 && (
          <span className={`absolute -right-1 -top-1 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold text-white ${criticas ? 'bg-estado-danger' : 'bg-brand'}`}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div className="feedback-pop absolute right-0 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Notificações</h2>
              <p className="text-xs text-ink-3">{dados?.resumo?.rotulo || 'Carregando lembretes'}</p>
            </div>
            <button
              type="button"
              onClick={carregar}
              disabled={carregando}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-2 transition hover:border-brand hover:text-brand disabled:opacity-50"
            >
              Atualizar
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {erro && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {erro}
              </div>
            )}

            {!erro && itens.length === 0 && (
              <div className="px-4 py-8 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-line bg-surface-2 text-ink-3">
                  <BellIcon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-medium text-ink">Nada urgente agora</p>
                <p className="mt-1 text-xs text-ink-3">Follow-ups, reuniões e ligações importantes aparecem aqui.</p>
              </div>
            )}

            {!erro && itens.map((item) => (
              <Link
                key={item.id}
                href={item.destino_url}
                className="group block rounded-lg border border-transparent px-3 py-3 transition hover:border-line hover:bg-surface-2"
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${PONTO_CLASSE[item.prioridade]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${PRIORIDADE_CLASSE[item.prioridade]}`}>
                        {item.grupo}
                      </span>
                      {horaCurta(item.quando) && <span className="text-[11px] text-ink-3">{horaCurta(item.quando)}</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-ink">{item.titulo}</p>
                    {item.descricao && <p className="mt-0.5 text-xs leading-5 text-ink-2">{item.descricao}</p>}
                    <span className="mt-2 inline-flex text-xs font-semibold text-brand group-hover:text-brand-dark">
                      {item.acao_label}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M15 18.5a3 3 0 0 1-6 0M18 10.5a6 6 0 1 0-12 0c0 3.6-1.25 5.35-2.15 6.2A.8.8 0 0 0 4.4 18h15.2a.8.8 0 0 0 .55-1.3C19.25 15.85 18 14.1 18 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
