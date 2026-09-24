'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'

// A escada de papéis vive em `lib/navegacao.js` (módulo puro, testado com `node --test`),
// porque é lá que ela decide o que aparece no menu. Aqui só reexportamos para não quebrar
// quem já importava `podePapel`/`Role` daqui — a regra continua existindo em UM lugar.
export type { Role } from '@/lib/navegacao'
export { NIVEL_ROLE, podePapel } from '@/lib/navegacao'

import type { Role } from '@/lib/navegacao'
import type { Capacidade, PapelEmpresa } from '@/lib/capacidades'

export type SessionUser = { id: string; email: string; nome: string; role: Role }

type EmpresaDaSessao = {
  id: string
  nome?: string
  papel_empresa?: PapelEmpresa
  capacidades?: Capacidade[]
}

/**
 * Hook de sessão: resolve o usuário logado via `/api/auth/me`.
 * Por padrão redireciona para /login se não houver token ou a sessão for inválida.
 *
 * ─── CRM EM EQUIPE: A SESSÃO PASSOU A CARREGAR AS CAPACIDADES ───────────────────────────
 * `/api/auth/me` devolve, **por empresa**, o papel do vínculo e a lista de capacidades já
 * resolvida pelo backend (papel + concessões aditivas). A tela nunca recalcula isso: quem decide é
 * `services/acesso-capacidades.js`, e aqui só se consome o veredito.
 *
 * `capacidades` é `null` enquanto carrega — e `temCapacidade(null, x)` é `false`. Esconder durante
 * o carregamento é o certo: mostrar um botão que vai responder 403 é pior que mostrá-lo um
 * instante depois.
 */
export function useSession(redirectOnFail = true) {
  const router = useRouter()
  const [usuario, setUsuario] = useState<SessionUser | null>(null)
  const [empresa, setEmpresa] = useState<EmpresaDaSessao | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
    if (!token) {
      if (redirectOnFail) router.replace('/login')
      setLoading(false)
      return
    }
    apiFetch<{ usuario: SessionUser; empresas?: EmpresaDaSessao[] }>('/api/auth/me')
      .then((r) => {
        if (cancel) return
        setUsuario(r.data.usuario)
        // A empresa em contexto é a que o app já guarda; se ela não estiver na lista (sessão
        // trocada, empresa removida), não se escolhe outra por conta própria — fica nula, e as
        // capacidades ficam vazias, que é o estado seguro.
        const atual = getEmpresaId()
        const lista = r.data.empresas || []
        setEmpresa(lista.find((e) => e.id === atual) || null)
      })
      .catch(() => { if (redirectOnFail && !cancel) router.replace('/login') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [router, redirectOnFail])

  return {
    usuario,
    role: usuario?.role,
    // Papel POR EMPRESA (owner|comercial) — o que autoriza desde a Etapa 1.
    papelEmpresa: empresa?.papel_empresa,
    // `null` enquanto carrega: distinto de `[]` (carregou e não tem nenhuma).
    capacidades: loading ? null : (empresa?.capacidades || []),
    empresa,
    loading,
  }
}
