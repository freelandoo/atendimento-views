'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const { data } = await apiFetch<{ token: string; empresa_id?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha }),
      })
      if (data?.token) {
        localStorage.setItem('token', data.token)
        if (data.empresa_id) localStorage.setItem('empresa_id', data.empresa_id)
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Credenciais inválidas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-md p-8 w-full max-w-sm space-y-5"
      >
        <h1 className="text-2xl font-bold text-brand">PJ Codeworks</h1>
        <p className="text-sm text-gray-500">Acesse o painel multiempresa</p>

        {erro && <p className="text-red-600 text-sm">{erro}</p>}

        <div className="space-y-1">
          <label className="text-sm font-medium">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Senha</label>
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50 transition-colors"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
