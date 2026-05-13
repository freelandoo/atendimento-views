'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'

const NAV = [
  { href: '/dashboard', label: 'Visão Geral' },
  { href: '/dashboard/conversas', label: 'Conversas' },
  { href: '/dashboard/contextos', label: 'Contextos' },
  { href: '/dashboard/empresa', label: 'Empresa' },
  { href: '/dashboard/llm', label: 'Modelo LLM' },
  { href: '/dashboard/uso', label: 'Uso & Custo' },
  { href: '/dashboard/relatorios', label: 'Relatórios' },
]

type Empresa = { id: string; nome: string; slug: string; plano?: string }

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaIdAtual, setEmpresaIdAtual] = useState<string>('')
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

  const atual = empresas.find((e) => e.id === empresaIdAtual)

  function trocar(empresaId: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('empresa_id', empresaId)
      setEmpresaIdAtual(empresaId)
      setAberto(false)
      router.refresh()
      // força reload pra recarregar dados específicos da empresa
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
    <aside className="w-56 min-h-screen bg-white border-r flex flex-col relative">
      <div className="px-4 py-4 border-b">
        <button
          type="button"
          onClick={() => setAberto((p) => !p)}
          className="w-full text-left flex items-center justify-between gap-2 hover:bg-gray-50 rounded-lg px-2 py-2"
        >
          <span className="font-bold text-brand text-base truncate">{atual?.nome || 'PJ Codeworks'}</span>
          <span className={`text-gray-400 text-xs transition-transform ${aberto ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {aberto && (
          <div className="absolute z-10 mt-1 w-52 left-2 bg-white border rounded-lg shadow-lg py-1">
            {empresas.map((e) => (
              <button
                key={e.id}
                onClick={() => trocar(e.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${e.id === empresaIdAtual ? 'font-semibold text-brand' : 'text-gray-700'}`}
              >
                {e.nome}
                <span className="block text-xs text-gray-400">{e.slug}</span>
              </button>
            ))}
            <div className="border-t mt-1 pt-1">
              <button
                onClick={() => { setAberto(false); setCriandoOpen(true) }}
                className="w-full text-left px-3 py-2 text-sm text-brand hover:bg-gray-100"
              >
                + Nova empresa
              </button>
            </div>
          </div>
        )}
      </div>
      <nav className="flex-1 py-4 space-y-1 px-3">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === href ? 'bg-brand text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {criandoOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setCriandoOpen(false)}>
          <form
            onSubmit={criarEmpresa}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="font-semibold text-lg">Nova empresa</h3>
            <div className="space-y-1">
              <label className="block text-xs text-gray-500">Nome</label>
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} required minLength={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-gray-500">Slug (opcional — derivado do nome)</label>
              <input value={novoSlug} onChange={(e) => setNovoSlug(e.target.value)} placeholder="ex: minha-empresa" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCriandoOpen(false)} className="text-sm px-3 py-2 border rounded-lg">Cancelar</button>
              <button type="submit" disabled={criando || !novoNome} className="text-sm px-3 py-2 bg-brand text-white rounded-lg disabled:opacity-50">
                {criando ? 'Criando…' : 'Criar e entrar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
