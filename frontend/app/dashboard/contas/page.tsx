'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useSession, podePapel, type Role } from '@/lib/useSession'

type Conta = {
  id: string
  email: string
  nome: string | null
  role: Role
  ativo: boolean
  ultimo_login_em: string | null
  criado_em: string
}

export default function ContasPage() {
  const router = useRouter()
  const { role, loading: loadingSessao } = useSession()
  const [contas, setContas] = useState<Conta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [novoRole, setNovoRole] = useState<'user' | 'admin'>('user')
  const [criando, setCriando] = useState(false)

  useEffect(() => {
    if (loadingSessao) return
    if (!podePapel(role, 'superadmin')) router.replace('/dashboard')
  }, [role, loadingSessao, router])

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const r = await apiFetch<Conta[]>('/api/admin/usuarios')
      setContas(r.data || [])
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar contas.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (!loadingSessao && podePapel(role, 'superadmin')) carregar()
  }, [role, loadingSessao])

  async function criarConta(e: FormEvent) {
    e.preventDefault()
    setCriando(true)
    setErro('')
    try {
      await apiFetch('/api/admin/usuarios', {
        method: 'POST',
        body: JSON.stringify({ nome, email, password: senha, role: novoRole }),
      })
      setNome(''); setEmail(''); setSenha(''); setNovoRole('user')
      await carregar()
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar conta.')
    } finally {
      setCriando(false)
    }
  }

  async function alterarRole(id: string, novo: Role) {
    try {
      await apiFetch(`/api/admin/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify({ role: novo }) })
      await carregar()
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao alterar papel.')
    }
  }

  async function alterarAtivo(id: string, ativo: boolean) {
    try {
      await apiFetch(`/api/admin/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo }) })
      await carregar()
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao alterar status.')
    }
  }

  if (loadingSessao || !podePapel(role, 'superadmin')) {
    return <p className="text-sm text-lo">Carregando…</p>
  }

  const inputCls = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="neon-text font-display text-2xl font-bold">Contas</h1>
        <p className="text-sm text-lo">Crie e gerencie usuários e seus papéis.</p>
      </div>

      {erro && <p className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>}

      <form onSubmit={criarConta} className="glass grid gap-3 rounded-2xl p-5 sm:grid-cols-5">
        <input value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Nome" className={inputCls} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="E-mail" className={inputCls} />
        <input value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={8} type="password" placeholder="Senha (≥8)" className={inputCls} />
        <select value={novoRole} onChange={(e) => setNovoRole(e.target.value as 'user' | 'admin')} className={inputCls}>
          <option value="user">Usuário</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" disabled={criando}
          className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-3 py-2 text-sm font-semibold text-neon-cyan transition hover:bg-neon-cyan/25 hover:shadow-glow-cyan disabled:opacity-50">
          {criando ? 'Criando…' : 'Criar conta'}
        </button>
      </form>

      <div className="glass overflow-x-auto rounded-2xl">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-lo">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Último login</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {carregando ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-lo">Carregando…</td></tr>
            ) : contas.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-lo">Nenhuma conta.</td></tr>
            ) : (
              contas.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium text-hi">{c.nome || '—'}</td>
                  <td className="px-4 py-3 text-mid">{c.email}</td>
                  <td className="px-4 py-3">
                    <select value={c.role} onChange={(e) => alterarRole(c.id, e.target.value as Role)} className={inputCls + ' py-1'}>
                      <option value="user">Usuário</option>
                      <option value="admin">Admin</option>
                      <option value="superadmin">Superadmin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => alterarAtivo(c.id, !c.ativo)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        c.ativo ? 'border border-neon-lime/40 bg-neon-lime/10 text-neon-lime' : 'border border-white/10 bg-white/5 text-lo'
                      }`}>
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-lo">{c.ultimo_login_em ? new Date(c.ultimo_login_em).toLocaleString('pt-BR') : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
