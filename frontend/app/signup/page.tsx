'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import NeonProgress from '@/components/ui/NeonProgress'

export default function SignupPage() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const { data } = await apiFetch<{
        token: string
        usuario?: { id: string; email: string; nome: string; role: string }
        empresas?: Array<{ id: string; nome: string; slug: string }>
      }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ nome, email, password: senha }),
      })
      if (data?.token) {
        localStorage.setItem('token', data.token)
        const empresaId = data.empresas?.[0]?.id
        if (empresaId) localStorage.setItem('empresa_id', empresaId)
        router.push('/dashboard/contextos')
      }
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar conta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-grid relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -left-32 top-1/4 h-80 w-80 rounded-full bg-neon-cyan/20 blur-[110px]" />
      <div className="pointer-events-none absolute -right-24 bottom-1/4 h-80 w-80 rounded-full bg-neon-magenta/15 blur-[110px]" />

      <form
        onSubmit={handleSubmit}
        className="glass relative z-10 w-full max-w-sm space-y-5 rounded-2xl p-8 shadow-glow-soft"
      >
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Command Deck</p>
          <h1 className="neon-text font-display text-3xl font-bold">Criar conta</h1>
          <p className="mt-1 text-sm text-lo">Comece grátis. Você configura sua empresa em seguida.</p>
        </div>

        {erro && (
          <p className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">Nome</label>
          <input
            type="text" required minLength={2} value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-hi outline-none transition focus:border-neon-cyan focus:shadow-glow-cyan"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">E-mail</label>
          <input
            type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-hi outline-none transition focus:border-neon-cyan focus:shadow-glow-cyan"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">Senha</label>
          <input
            type="password" required minLength={8} value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-hi outline-none transition focus:border-neon-cyan focus:shadow-glow-cyan"
          />
          <p className="text-xs text-lo">Mínimo de 8 caracteres.</p>
        </div>

        {loading && <NeonProgress />}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 py-2.5 text-sm font-semibold text-neon-cyan transition-all hover:bg-neon-cyan/25 hover:shadow-glow-cyan active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? 'Criando…' : 'Criar conta →'}
        </button>

        <p className="text-center text-sm text-lo">
          Já tem conta?{' '}
          <Link href="/login" className="font-medium text-neon-cyan hover:underline">Entrar</Link>
        </p>
      </form>
    </div>
  )
}
