'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

// A escada de papéis vive em `lib/navegacao.js` (módulo puro, testado com `node --test`),
// porque é lá que ela decide o que aparece no menu. Aqui só reexportamos para não quebrar
// quem já importava `podePapel`/`Role` daqui — a regra continua existindo em UM lugar.
export type { Role } from '@/lib/navegacao'
export { NIVEL_ROLE, podePapel } from '@/lib/navegacao'

import type { Role } from '@/lib/navegacao'

export type SessionUser = { id: string; email: string; nome: string; role: Role }

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
