'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

export type Role = 'user' | 'admin' | 'superadmin'
export type SessionUser = { id: string; email: string; nome: string; role: Role }

export const NIVEL_ROLE: Record<Role, number> = { user: 1, admin: 2, superadmin: 3 }

// Hook de sessão: resolve o usuário logado via /api/auth/me.
// Por padrão redireciona para /login se não houver token ou a sessão for inválida.
export function useSession(redirectOnFail = true) {
  const router = useRouter()
  const [usuario, setUsuario] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
    if (!token) {
      if (redirectOnFail) router.replace('/login')
      setLoading(false)
      return
    }
    apiFetch<{ usuario: SessionUser }>('/api/auth/me')
      .then((r) => { if (!cancel) setUsuario(r.data.usuario) })
      .catch(() => { if (redirectOnFail && !cancel) router.replace('/login') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [router, redirectOnFail])

  return { usuario, role: usuario?.role, loading }
}

export function podePapel(role: Role | undefined, minimo: Role): boolean {
  return NIVEL_ROLE[role ?? 'user'] >= NIVEL_ROLE[minimo]
}
