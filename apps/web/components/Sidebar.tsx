'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'

type NavIcon = 'overview' | 'chat' | 'leads' | 'prospect' | 'context' | 'company' | 'model' | 'usage' | 'report'

const NAV = [
  { href: '/dashboard', label: 'Visão Geral', icon: 'overview' },
  { href: '/dashboard/conversas', label: 'Conversas', icon: 'chat' },
  { href: '/dashboard/leads-quentes', label: 'Leads Quentes', icon: 'leads' },
  { href: '/dashboard/prospeccao', label: 'Prospecção', icon: 'prospect' },
  { href: '/dashboard/contextos', label: 'Empresas', icon: 'company' },
  { href: '/dashboard/llm', label: 'Modelo LLM', icon: 'model' },
  { href: '/dashboard/uso', label: 'Uso & Custo', icon: 'usage' },
  { href: '/dashboard/relatorios', label: 'Relatórios', icon: 'report' },
] satisfies { href: string; label: string; icon: NavIcon }[]

type Empresa = { id: string; nome: string; slug: string; plano?: string }

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaIdAtual, setEmpresaIdAtual] = useState<string>('')
  const [retraido, setRetraido] = useState(true)
  const [aberto, setAberto] = useState(false)
  const [criandoOpen, setCriandoOpen] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoSlug, setNovoSlug] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    setEmpresaIdAtual(getEmpresaId())
    apiFetch<Empresa[]>('/api/empresas').then((r) => setEmpresas(r.data || [])).catch(() => {})
  }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setRetraido(window.localStorage.getItem('dashboard_toolbar_retraido') !== 'false')
  }, [])

  const atual = empresas.find((e) => e.id === empresaIdAtual)

  function alternarToolbar() {
    setRetraido((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('dashboard_toolbar_retraido', String(next))
      }
      if (next) setAberto(false)
      return next
    })
  }

  function trocar(empresaId: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('empresa_id', empresaId)
      setEmpresaIdAtual(empresaId)
      setAberto(false)
      router.refresh()
      window.location.reload()
    }
  }

  async function criarEmpresa(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true)
    setErro(null)
    try {
      const r = await apiFetch<Empresa>('/api/empresas', {
        method: 'POST',
        body: JSON.stringify({ nome: novoNome, slug: novoSlug || undefined }),
      })
      setEmpresas((prev) => [...prev, r.data])
      setCriandoOpen(false)
      setNovoNome('')
      setNovoSlug('')
      trocar(r.data.id)
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar empresa.')
    } finally {
      setCriando(false)
    }
  }

  return (
    <aside
      className={`sticky top-0 min-h-[100dvh] shrink-0 border-r border-slate-200/80 bg-white/95 shadow-[8px_0_30px_-26px_rgba(15,23,42,0.35)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        retraido ? 'w-[76px]' : 'w-64'
      }`}
    >
      <div className="flex min-h-[100dvh] flex-col">
        <div className={`border-b border-slate-200/80 px-3 py-3 ${retraido ? 'space-y-3' : 'space-y-4'}`}>
          <div className={`flex items-center ${retraido ? 'justify-center' : 'justify-between gap-3'}`}>
            {!retraido && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-slate-950">{atual?.nome || 'PJ Codeworks'}</p>
                <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Workspace</p>
              </div>
            )}
            <button
              type="button"
              onClick={alternarToolbar}
              aria-label={retraido ? 'Expandir toolbar' : 'Retrair toolbar'}
              title={retraido ? 'Expandir toolbar' : 'Retrair toolbar'}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
            >
              <ChevronIcon className={`h-4 w-4 transition-transform duration-300 ${retraido ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (retraido) {
                setRetraido(false)
                if (typeof window !== 'undefined') window.localStorage.setItem('dashboard_toolbar_retraido', 'false')
              } else {
                setAberto((p) => !p)
              }
            }}
            aria-label="Selecionar empresa"
            title={atual?.nome || 'PJ Codeworks'}
            className={`flex w-full items-center rounded-xl border border-slate-200 bg-slate-50/70 text-left transition hover:bg-slate-100 active:scale-[0.98] ${
              retraido ? 'h-11 justify-center px-0' : 'justify-between gap-3 px-3 py-2'
            }`}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-xs font-bold text-white">
              {(atual?.nome || 'PJ').slice(0, 2).toUpperCase()}
            </span>
            {!retraido && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{atual?.nome || 'PJ Codeworks'}</span>
                  <span className="block truncate text-xs text-slate-400">{atual?.slug || 'painel'}</span>
                </span>
                <ChevronDownIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
        </div>

        {aberto && (
          <div className="absolute left-3 top-[118px] z-20 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.45)]">
            {empresas.map((e) => (
              <button
                key={e.id}
                onClick={() => trocar(e.id)}
                className={`w-full text-left px-3 py-2.5 text-sm transition hover:bg-slate-50 ${
                  e.id === empresaIdAtual ? 'font-semibold text-brand' : 'text-slate-700'
                }`}
              >
                {e.nome}
                <span className="block text-xs text-slate-400">{e.slug}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                onClick={() => { setAberto(false); setCriandoOpen(true) }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-brand transition hover:bg-slate-50"
              >
                + Nova empresa
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 space-y-2 px-3 py-4" aria-label="Navegação principal">
          {NAV.map(({ href, label, icon }) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-label={label}
                className={`group relative flex h-11 items-center rounded-xl text-sm font-medium transition duration-200 active:scale-[0.98] ${
                  retraido ? 'justify-center px-0' : 'gap-3 px-3'
                } ${
                  active
                    ? 'bg-brand text-white shadow-[0_10px_22px_-16px_rgba(37,99,235,0.9)]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <NavGlyph name={icon} className="h-5 w-5 shrink-0" />
                {!retraido && <span className="truncate">{label}</span>}
                {retraido && (
                  <span className="pointer-events-none absolute left-[58px] top-1/2 z-30 -translate-y-1/2 translate-x-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl transition group-hover:translate-x-0 group-hover:opacity-100">
                    {label}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-slate-200/80 px-3 py-3">
          <div className={`rounded-xl bg-slate-50 text-slate-500 ${retraido ? 'grid h-11 place-items-center' : 'px-3 py-2'}`}>
            {retraido ? (
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Online" title="Online" />
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Online</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {criandoOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setCriandoOpen(false)}>
          <form
            onSubmit={criarEmpresa}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-[0_28px_80px_-30px_rgba(15,23,42,0.55)]"
          >
            <h3 className="text-lg font-semibold">Nova empresa</h3>
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">Nome</label>
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} required minLength={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-slate-500">Slug opcional</label>
              <input value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} placeholder="ex: minha-empresa" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-brand" />
            </div>
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCriandoOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:bg-slate-50 active:scale-[0.98]">Cancelar</button>
              <button type="submit" disabled={criando || !novoNome} className="rounded-lg bg-brand px-3 py-2 text-sm text-white transition hover:bg-brand-dark active:scale-[0.98] disabled:opacity-50">
                {criando ? 'Criando...' : 'Criar e entrar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M14.5 6.75L9.25 12l5.25 5.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6.75 9.75L12 15l5.25-5.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NavGlyph({ name, className }: { name: NavIcon; className?: string }) {
  const common = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {name === 'overview' && (
        <>
          <path {...common} d="M4 13.5V20h6v-5h4v5h6v-6.5" />
          <path {...common} d="M3 11.5L12 4l9 7.5" />
        </>
      )}
      {name === 'chat' && (
        <>
          <path {...common} d="M5 6.5h14v9H9l-4 3v-12z" />
          <path {...common} d="M8 10h8M8 13h5" />
        </>
      )}
      {name === 'leads' && (
        <>
          <path {...common} d="M12 3c1 3-1 4-1 6a3 3 0 0 0 6 0c0-1-.3-2-.8-2.7C17.8 8.5 19 10.6 19 13a7 7 0 1 1-14 0c0-3 1.8-5.5 4-7 0 2 1 3 2 3.5C12 11 13 9 12 3z" />
        </>
      )}
      {name === 'prospect' && (
        <>
          <circle {...common} cx="11" cy="11" r="6" />
          <path {...common} d="M20 20l-3.5-3.5" />
        </>
      )}
      {name === 'context' && (
        <>
          <path {...common} d="M7 4h10a2 2 0 0 1 2 2v14l-4-2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          <path {...common} d="M9 8h6M9 12h4" />
        </>
      )}
      {name === 'company' && (
        <>
          <path {...common} d="M5 20V6.5L12 4l7 2.5V20" />
          <path {...common} d="M9 20v-5h6v5M9 9h.01M12 9h.01M15 9h.01M9 12h.01M12 12h.01M15 12h.01" />
        </>
      )}
      {name === 'model' && (
        <>
          <path {...common} d="M12 4v3M12 17v3M4 12h3M17 12h3" />
          <path {...common} d="M8 8h8v8H8z" />
          <path {...common} d="M10 10h4v4h-4z" />
        </>
      )}
      {name === 'usage' && (
        <>
          <path {...common} d="M5 19V5M5 19h14" />
          <path {...common} d="M9 15v-4M13 15V8M17 15v-7" />
        </>
      )}
      {name === 'report' && (
        <>
          <path {...common} d="M7 4h7l4 4v12H7z" />
          <path {...common} d="M14 4v4h4M9 13h6M9 16h4" />
        </>
      )}
    </svg>
  )
}
