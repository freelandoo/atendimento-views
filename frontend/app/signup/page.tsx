'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import NeonProgress from '@/components/ui/NeonProgress'

const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-hi outline-none transition focus:border-neon-cyan focus:shadow-glow-cyan'

export default function SignupPage() {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  // Mesma régua do backend (8+, uma letra, um número). A tela só DÁ a dica; quem valida é a API.
  const senhaForte = senha.length >= 8 && /\p{L}/u.test(senha) && /\d/.test(senha)

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
        body: JSON.stringify({ nome, email, password: senha, cpf, telefone }),
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
        className="glass relative z-10 w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-glow-soft"
      >
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Command Deck</p>
          <h1 className="neon-text font-display text-3xl font-bold">Criar conta</h1>
          <p className="mt-1 text-sm text-lo">7 dias grátis. Você configura sua empresa em seguida.</p>
        </div>

        {erro && (
          <p className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">Nome</label>
          <input type="text" required minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">CPF</label>
          <input
            type="text" inputMode="numeric" required value={cpf}
            onChange={(e) => setCpf(e.target.value)} placeholder="Somente números"
            className={inputCls}
          />
          <p className="text-xs text-lo">Sua conta fica vinculada a este CPF.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">Telefone (com DDD)</label>
          <input
            type="tel" inputMode="numeric" required value={telefone}
            onChange={(e) => setTelefone(e.target.value)} placeholder="(11) 90000-0000"
            className={inputCls}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">E-mail</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-mid">Senha</label>
          <input type="password" required minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} className={inputCls} />
          <p className={`text-xs ${senha.length === 0 ? 'text-lo' : senhaForte ? 'text-neon-lime' : 'text-neon-amber'}`}>
            {senha.length === 0
              ? 'Mínimo 8 caracteres, com letra e número.'
              : senhaForte
                ? '✓ Senha segura.'
                : 'Precisa de 8+ caracteres, com pelo menos uma letra e um número.'}
          </p>
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
