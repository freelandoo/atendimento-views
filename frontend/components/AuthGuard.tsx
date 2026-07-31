'use client'
// Guarda de sessão do dashboard. Impede que as telas operacionais (ex.: Central de
// Ligações) apareçam utilizáveis sem sessão válida e evita disparar chamadas protegidas
// em cascata. Reutiliza o MESMO apiFetch/token — não cria um segundo sistema de auth.
//   - sem token            → vai para /login.
//   - token inválido/expirado (401/403) → limpa o token e volta ao login com aviso único.
//   - erro de rede/servidor → libera a tela (as páginas mostram mensagem de rede clara),
//                             sem loop de redirecionamento.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, ApiError } from '@/lib/api'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'ok'>('checking')

  useEffect(() => {
    let vivo = true
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) { router.replace('/login'); return }
    // Valida a sessão UMA vez antes de renderizar o conteúdo protegido.
    apiFetch('/api/auth/me')
      .then(() => { if (vivo) setStatus('ok') })
      .catch((e) => {
        const err = e as ApiError
        if (err?.status === 401 || err?.status === 403) {
          try { localStorage.removeItem('token') } catch { /* */ }
          try { sessionStorage.setItem('authMsg', 'Sua sessão expirou. Entre novamente para continuar.') } catch { /* */ }
          router.replace('/login')
        } else if (vivo) {
          setStatus('ok') // rede/servidor: não trava o app nem entra em loop de redirect
        }
      })
    return () => { vivo = false }
  }, [router])

  if (status === 'checking') {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-void text-sm text-slate-400">Verificando sessão…</div>
  }
  return <>{children}</>
}
