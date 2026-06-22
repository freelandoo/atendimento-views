'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useSession, podePapel, type Role } from '@/lib/useSession'

type NavIcon = 'overview' | 'chat' | 'leads' | 'prospect' | 'agenda' | 'context' | 'company' | 'model' | 'usage' | 'report' | 'accounts' | 'profile' | 'prompts'

const NAV = [
  { href: '/dashboard', label: 'Visão Geral', icon: 'overview' },
  { href: '/dashboard/conversas', label: 'Conversas', icon: 'chat' },
  { href: '/dashboard/aquisicao', label: 'Aquisição', icon: 'prospect', minRole: 'admin' },
  { href: '/dashboard/banco-leads', label: 'Banco de Leads', icon: 'leads', minRole: 'admin' },
  { href: '/dashboard/agenda', label: 'Agenda', icon: 'agenda' },
  { href: '/dashboard/contextos', label: 'Empresas', icon: 'company' },
  { href: '/dashboard/llm', label: 'Modelo LLM', icon: 'model', minRole: 'admin' },
  { href: '/dashboard/prompts', label: 'Prompts & Saudações', icon: 'prompts', minRole: 'admin' },
  { href: '/dashboard/uso', label: 'Uso & Custo', icon: 'usage', minRole: 'admin' },
  { href: '/dashboard/relatorios', label: 'Relatórios', icon: 'report', minRole: 'admin' },
  { href: '/dashboard/contas', label: 'Contas', icon: 'accounts', minRole: 'superadmin' },
  { href: '/dashboard/perfil', label: 'Perfil', icon: 'profile' },
] satisfies { href: string; label: string; icon: NavIcon; minRole?: Role }[]

type Empresa = { id: string; nome: string; slug: string; plano?: string }

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { role } = useSession()
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
      className={`sticky top-0 z-30 min-h-[100dvh] shrink-0 border-r border-[var(--border-soft)] bg-panel/80 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        retraido ? 'w-[76px]' : 'w-64'
      }`}
    >
      <div className="flex min-h-[100dvh] flex-col">
        <div className={`border-b border-[var(--border-soft)] px-3 py-3 ${retraido ? 'space-y-3' : 'space-y-4'}`}>
          <div className={`flex items-center ${retraido ? 'justify-center' : 'justify-between gap-3'}`}>
            {!retraido && (
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold tracking-tight text-hi">{atual?.nome || 'Atendimento-Views'}</p>
                <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-neon-cyan/70">Command Deck</p>
              </div>
            )}
            <button
              type="button"
              onClick={alternarToolbar}
              aria-label={retraido ? 'Expandir toolbar' : 'Retrair toolbar'}
              title={retraido ? 'Expandir toolbar' : 'Retrair toolbar'}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-mid transition hover:border-neon-cyan/40 hover:text-neon-cyan active:scale-[0.98]"
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
            title={atual?.nome || 'Atendimento-Views'}
            className={`flex w-full items-center rounded-xl border border-white/10 bg-white/5 text-left transition hover:border-neon-cyan/30 hover:bg-white/[0.08] active:scale-[0.98] ${
              retraido ? 'h-11 justify-center px-0' : 'justify-between gap-3 px-3 py-2'
            }`}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 text-xs font-bold text-neon-cyan shadow-glow-cyan">
              {(atual?.nome || 'PJ').slice(0, 2).toUpperCase()}
            </span>
            {!retraido && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-hi">{atual?.nome || 'Atendimento-Views'}</span>
                  <span className="block truncate text-xs text-lo">{atual?.slug || 'painel'}</span>
                </span>
                <ChevronDownIcon className={`h-4 w-4 shrink-0 text-lo transition-transform ${aberto ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
        </div>

        {aberto && (
          <div className="glass absolute left-3 top-[118px] z-20 w-56 overflow-hidden rounded-2xl py-1 shadow-glow-soft">
            {empresas.map((e) => (
              <button
                key={e.id}
                onClick={() => trocar(e.id)}
                className={`w-full text-left px-3 py-2.5 text-sm transition hover:bg-white/5 ${
                  e.id === empresaIdAtual ? 'font-semibold text-neon-cyan' : 'text-mid'
                }`}
              >
                {e.nome}
                <span className="block text-xs text-lo">{e.slug}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-white/10 pt-1">
              <button
                onClick={() => { setAberto(false); setCriandoOpen(true) }}
                className="w-full text-left px-3 py-2.5 text-sm font-medium text-neon-cyan transition hover:bg-white/5"
              >
                + Nova empresa
              </button>
            </div>
          </div>
        )}

        <nav className="flex-1 space-y-1.5 px-3 py-4" aria-label="Navegação principal">
          {NAV.filter((item) => !item.minRole || podePapel(role, item.minRole)).map(({ href, label, icon }) => {
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
                    ? 'border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan shadow-glow-cyan'
                    : 'border border-transparent text-mid hover:bg-white/5 hover:text-hi'
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-neon-cyan" style={{ width: 3, boxShadow: '0 0 10px var(--neon-cyan)' }} />}
                <NavGlyph name={icon} className="h-5 w-5 shrink-0" />
                {!retraido && <span className="truncate">{label}</span>}
                {retraido && (
                  <span className="glass pointer-events-none absolute left-[58px] top-1/2 z-30 -translate-y-1/2 translate-x-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-hi opacity-0 shadow-glow-soft transition group-hover:translate-x-0 group-hover:opacity-100">
                    {label}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-[var(--border-soft)] px-3 py-3">
          <div className={`rounded-xl border border-white/10 bg-white/5 text-mid ${retraido ? 'grid h-11 place-items-center' : 'px-3 py-2'}`}>
            {retraido ? (
              <span className="h-2 w-2 rounded-full bg-neon-lime shadow-glow-lime animate-pulse-glow" aria-label="Online" title="Online" />
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-neon-lime shadow-glow-lime animate-pulse-glow" />
                <span>Online</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {criandoOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm" onClick={() => setCriandoOpen(false)}>
          <form
            onSubmit={criarEmpresa}
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-sm space-y-4 rounded-2xl p-6 shadow-glow-soft"
          >
            <h3 className="font-display text-lg font-semibold text-hi">Nova empresa</h3>
            <div className="space-y-1">
              <label className="block text-xs text-lo">Nome</label>
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} required minLength={2} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-lo">Slug opcional</label>
              <input value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} placeholder="ex: minha-empresa" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan" />
            </div>
            {erro && <p className="text-sm text-neon-red">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCriandoOpen(false)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-mid transition hover:bg-white/10 active:scale-[0.98]">Cancelar</button>
              <button type="submit" disabled={criando || !novoNome} className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-3 py-2 text-sm font-medium text-neon-cyan transition hover:bg-neon-cyan/25 hover:shadow-glow-cyan active:scale-[0.98] disabled:opacity-50">
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
      {name === 'agenda' && (
        <>
          <path {...common} d="M5 6h14v14H5z" />
          <path {...common} d="M5 10h14M8 3v4M16 3v4" />
          <path {...common} d="M9 14h2M13 14h2" />
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
      {name === 'accounts' && (
        <>
          <path {...common} d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path {...common} d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" />
          <path {...common} d="M16 5.5a3 3 0 0 1 0 5.5M18 14.5a4 4 0 0 1 3 3.5v1" />
        </>
      )}
      {name === 'profile' && (
        <>
          <circle {...common} cx="12" cy="8" r="3.5" />
          <path {...common} d="M5 20v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" />
        </>
      )}
      {name === 'prompts' && (
        <>
          <path {...common} d="M5 6.5h14v9H9l-4 3v-12z" />
          <path {...common} d="M8 10h8M8 13h4" />
          <path {...common} d="M15.5 13.5l1.2 1.2 2.3-2.6" />
        </>
      )}
    </svg>
  )
}
