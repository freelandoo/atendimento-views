'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/lib/useSession'
import {
  navegacaoVisivel, resolverAtivo, alternarGrupo, normalizarGruposAbertos, lerGruposAbertos,
  type NavIcon, type NavItem, type NavNo, type Ativo,
} from '@/lib/navegacao'
import { apiFetch, getEmpresaId } from '@/lib/api'

// A ÁRVORE e as REGRAS (quem vê o quê, o que está ativo, qual grupo abre) vivem em
// `lib/navegacao.js`, testadas com `node --test`. Este arquivo é só o desenho — e ele
// desenha a MESMA árvore em dois lugares: a coluna do desktop e o drawer do mobile.

const CHAVE_RETRAIDO = 'dashboard_toolbar_retraido'
const CHAVE_GRUPOS = 'dashboard_nav_grupos'

export default function Sidebar() {
  const pathname = usePathname()
  const { role } = useSession()
  const [retraido, setRetraido] = useState(true)
  const [abertos, setAbertos] = useState<string[]>([])
  const [drawer, setDrawer] = useState(false)
  // Alerta de instância WhatsApp desconectada.
  const [instAlerta, setInstAlerta] = useState(false)

  const nav = useMemo(() => navegacaoVisivel(role), [role])
  const ativo = useMemo(() => resolverAtivo(pathname, role), [pathname, role])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setRetraido(window.localStorage.getItem(CHAVE_RETRAIDO) !== 'false')
    setAbertos(normalizarGruposAbertos(lerGruposAbertos(window.localStorage.getItem(CHAVE_GRUPOS))))
  }, [])

  // O grupo da página atual abre sozinho: chegar numa tela escondida dentro de um grupo
  // fechado e não ver onde você está seria pior que a lista plana de antes.
  useEffect(() => {
    setAbertos((prev) => {
      const proximo = normalizarGruposAbertos(prev, ativo.grupoId)
      return proximo.length === prev.length && proximo.every((g, i) => g === prev[i]) ? prev : proximo
    })
  }, [ativo.grupoId])

  useEffect(() => {
    const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
    if (!empresaId) return
    let vivo = true
    const checar = async () => {
      try {
        const r = await apiFetch<{ alguma_desconectada: boolean; alguma_indisponivel?: boolean }>(`/api/empresas/${empresaId}/whatsapp/conexao-resumo`)
        if (vivo) setInstAlerta(!!(r.data.alguma_indisponivel ?? r.data.alguma_desconectada))
      } catch { /* silencioso */ }
    }
    checar()
    const t = setInterval(checar, 30000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  // Navegar fecha o drawer — no mobile ele cobre a tela inteira.
  useEffect(() => { setDrawer(false) }, [pathname])

  // Identidade estável: o Drawer usa `onFechar` como dependência de efeito. Uma arrow
  // inline nasceria diferente a cada render e o efeito reexecutaria, roubando o foco
  // de volta para o botão de fechar no meio do Tab.
  const fecharDrawer = useCallback(() => setDrawer(false), [])

  function alternarToolbar() {
    setRetraido((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') window.localStorage.setItem(CHAVE_RETRAIDO, String(next))
      return next
    })
  }

  const alternar = useCallback((id: string) => {
    setAbertos((prev) => {
      const next = alternarGrupo(prev, id)
      if (typeof window !== 'undefined') window.localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(next))
      return next
    })
  }, [])

  // No modo retraído só cabe o ícone: clicar num grupo expande a barra E abre o grupo,
  // senão o item filho ficaria inalcançável pelo trilho estreito.
  const abrirGrupo = useCallback((id: string) => {
    if (retraido) {
      setRetraido(false)
      if (typeof window !== 'undefined') window.localStorage.setItem(CHAVE_RETRAIDO, 'false')
      setAbertos((prev) => {
        const next = normalizarGruposAbertos(prev, id)
        if (typeof window !== 'undefined') window.localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(next))
        return next
      })
      return
    }
    alternar(id)
  }, [retraido, alternar])

  return (
    <>
      <BarraMobile aberto={drawer} onAbrir={() => setDrawer(true)} alerta={instAlerta} />

      <aside
        className={`sticky top-0 z-30 hidden min-h-[100dvh] shrink-0 border-r border-[var(--border-soft)] bg-panel/80 backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:block ${
          retraido ? 'w-[76px]' : 'w-64'
        }`}
      >
        <div className="flex min-h-[100dvh] flex-col">
          <div className={`border-b border-[var(--border-soft)] px-3 py-3 ${retraido ? 'space-y-3' : 'space-y-4'}`}>
            <div className={`flex items-center ${retraido ? 'justify-center' : 'justify-between gap-3'}`}>
              {!retraido && <Marca />}
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
          </div>

          <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4" aria-label="Navegação principal">
            <Arvore
              nav={nav}
              ativo={ativo}
              retraido={retraido}
              abertos={abertos}
              onGrupo={abrirGrupo}
              instAlerta={instAlerta}
            />
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
      </aside>

      <Drawer aberto={drawer} onFechar={fecharDrawer}>
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4" aria-label="Navegação principal">
          <Arvore
            nav={nav}
            ativo={ativo}
            retraido={false}
            abertos={abertos}
            onGrupo={alternar}
            instAlerta={instAlerta}
          />
        </nav>
      </Drawer>
    </>
  )
}

function Marca() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 text-xs font-bold text-neon-cyan shadow-glow-cyan">
        AV
      </span>
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold tracking-tight text-hi">Atendimento-Views</p>
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-neon-cyan/70">Command Deck</p>
      </div>
    </div>
  )
}

/** Barra superior do mobile: é ela que abre o drawer. Some a partir de `md`. */
function BarraMobile({ aberto, onAbrir, alerta }: { aberto: boolean; onAbrir: () => void; alerta: boolean }) {
  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border-soft)] bg-panel/90 px-4 py-2.5 backdrop-blur-xl md:hidden">
      <button
        type="button"
        onClick={onAbrir}
        aria-label="Abrir navegação"
        aria-expanded={aberto}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-mid transition hover:border-neon-cyan/40 hover:text-neon-cyan active:scale-[0.98]"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {alerta && <Alerta titulo="Instância WhatsApp desconectada" />}
      </button>
      <Marca />
    </div>
  )
}

/**
 * Drawer do mobile: overlay, trava de rolagem, fecha no Escape e prende o foco enquanto
 * está aberto (Tab não escapa para a página atrás, que continua visível sob o overlay).
 */
function Drawer({ aberto, onFechar, children }: { aberto: boolean; onFechar: () => void; children: React.ReactNode }) {
  const painel = useRef<HTMLDivElement>(null)
  const fechar = useRef<HTMLButtonElement>(null)

  // Foco e trava de rolagem dependem SÓ de abrir/fechar — nunca de um re-render.
  useEffect(() => {
    if (!aberto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fechar.current?.focus()
    return () => { document.body.style.overflow = anterior }
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onFechar(); return }
      if (e.key !== 'Tab' || !painel.current) return
      const focaveis = painel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (!focaveis.length) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
      else if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberto, onFechar])

  if (!aberto) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navegação">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onFechar} aria-hidden="true" />
      <div
        ref={painel}
        className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-[var(--border-soft)] bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-3 py-3">
          <Marca />
          <button
            ref={fechar}
            type="button"
            onClick={onFechar}
            aria-label="Fechar navegação"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-mid transition hover:border-neon-cyan/40 hover:text-neon-cyan active:scale-[0.98]"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

type ArvoreProps = {
  nav: NavNo[]
  ativo: Ativo
  retraido: boolean
  abertos: string[]
  onGrupo: (id: string) => void
  instAlerta: boolean
}

function Arvore({ nav, ativo, retraido, abertos, onGrupo, instAlerta }: ArvoreProps) {
  return (
    <>
      {nav.map((no) => {
        if (no.tipo === 'item') {
          return <ItemLink key={no.href} item={no} ativo={ativo.href === no.href} retraido={retraido} instAlerta={instAlerta} />
        }
        const aberto = abertos.includes(no.id)
        const temAtivo = ativo.grupoId === no.id
        // O alerta de desconexão sobe para o cabeçalho quando o filho está escondido —
        // a reorganização não pode apagar um aviso operacional que existe hoje.
        const alertaNoGrupo = instAlerta && (retraido || !aberto) && no.itens.some((i) => i.href === '/dashboard/contextos')
        return (
          <div key={no.id}>
            <button
              type="button"
              onClick={() => onGrupo(no.id)}
              aria-expanded={retraido ? false : aberto}
              title={no.label}
              className={`group relative flex h-11 w-full items-center rounded-xl text-sm font-medium transition duration-200 active:scale-[0.98] ${
                retraido ? 'justify-center px-0' : 'gap-3 px-3'
              } ${
                temAtivo
                  ? 'border border-neon-cyan/25 bg-white/5 text-hi'
                  : 'border border-transparent text-mid hover:bg-white/5 hover:text-hi'
              }`}
            >
              {temAtivo && !aberto && <span className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-neon-cyan/60" style={{ width: 3 }} />}
              {alertaNoGrupo && <Alerta titulo="Instância WhatsApp desconectada — abra Configurações › Instâncias" />}
              <NavGlyph name={no.icon} className="h-5 w-5 shrink-0" />
              {!retraido && (
                <>
                  <span className="flex-1 truncate text-left">{no.label}</span>
                  <ChevronIcon className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${aberto ? '-rotate-90' : 'rotate-180'}`} />
                </>
              )}
              {retraido && <Dica>{no.label}</Dica>}
            </button>

            {!retraido && aberto && (
              <ul className="relative mt-1 space-y-1 pl-5 before:absolute before:bottom-2 before:left-[22px] before:top-1 before:w-px before:bg-white/10">
                {no.itens.map((item) => (
                  <li key={item.href}>
                    <ItemLink item={item} ativo={ativo.href === item.href} retraido={false} instAlerta={instAlerta} filho />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
}

function ItemLink({ item, ativo, retraido, instAlerta, filho = false }: {
  item: NavItem; ativo: boolean; retraido: boolean; instAlerta: boolean; filho?: boolean
}) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={ativo ? 'page' : undefined}
      className={`group relative flex items-center rounded-xl text-sm font-medium transition duration-200 active:scale-[0.98] ${
        filho ? 'h-10' : 'h-11'
      } ${retraido ? 'justify-center px-0' : 'gap-3 px-3'} ${
        ativo
          ? 'border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan shadow-glow-cyan'
          : 'border border-transparent text-mid hover:bg-white/5 hover:text-hi'
      }`}
    >
      {ativo && <span className="absolute left-0 top-1/2 h-6 -translate-y-1/2 rounded-r bg-neon-cyan" style={{ width: 3, boxShadow: '0 0 10px var(--neon-cyan)' }} />}
      {item.href === '/dashboard/contextos' && instAlerta && (
        <Alerta titulo="Instância WhatsApp desconectada — clique para reconectar" />
      )}
      <NavGlyph name={item.icon} className={filho ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0'} />
      {!retraido && <span className="truncate">{item.label}</span>}
      {retraido && <Dica>{item.label}</Dica>}
    </Link>
  )
}

function Alerta({ titulo }: { titulo: string }) {
  return (
    <span className="absolute right-2 top-1.5 flex h-2.5 w-2.5" title={titulo}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
    </span>
  )
}

/** Rótulo que aparece no hover quando a coluna está retraída. */
function Dica({ children }: { children: React.ReactNode }) {
  return (
    <span className="glass pointer-events-none absolute left-[58px] top-1/2 z-30 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-hi opacity-0 shadow-glow-soft transition group-hover:translate-x-0 group-hover:opacity-100">
      {children}
    </span>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M14.5 6.75L9.25 12l5.25 5.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
      {name === 'followup' && (
        <>
          <path {...common} d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" />
        </>
      )}
      {name === 'roteiro' && (
        <>
          <path {...common} d="M7 4h8l3 3v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path {...common} d="M14 4v4h4M9 12h6M9 15h6M9 9h2" />
        </>
      )}
      {name === 'central' && (
        <>
          <path {...common} d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z" />
          <circle {...common} cx="17.5" cy="6.5" r="2.5" />
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
      {name === 'playbook' && (
        <>
          <path {...common} d="M6 4h9l3 3v13H6z" />
          <path {...common} d="M14 4v4h4" />
          <path {...common} d="M9 12h6M9 15h6M9 18h4" />
        </>
      )}
      {name === 'operacao' && (
        <>
          <path {...common} d="M4 5h5v14H4zM10.5 5h4v9h-4zM16 5h4v11h-4z" />
        </>
      )}
      {name === 'settings' && (
        <>
          <circle {...common} cx="12" cy="12" r="3.2" />
          <path {...common} d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21" />
          <path {...common} d="M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
        </>
      )}
      {name === 'integracoes' && (
        <>
          <path {...common} d="M9 3v5M15 3v5" />
          <path {...common} d="M6.5 8h11v4a5.5 5.5 0 0 1-11 0V8z" />
          <path {...common} d="M12 17.5V21" />
        </>
      )}
    </svg>
  )
}
