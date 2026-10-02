'use client'
// Guard central de PLANO por página. Se a rota atual é um módulo que o plano da empresa não
// libera, mostra PaginaBloqueada no lugar do conteúdo. Caso contrário, renderiza normal.
//
// Só busca o plano (/me) para rotas BLOQUEÁVEIS (moduloDaRota != null) — as usáveis para todos
// renderizam na hora, sem custo. FAIL-OPEN: erro ao ler o plano não bloqueia (ver lib). O BACKEND
// continua a autoridade das ações; isto é a experiência de UI.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { moduloDaRota, bloqueado } from '@/lib/plano-modulos'
import type { PlanoVeredito } from '@/lib/plano'
import PaginaBloqueada from './PaginaBloqueada'

type EmpresaDaSessao = { id: string; plano?: PlanoVeredito | null }

export default function BloqueioPlano({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const modulo = moduloDaRota(pathname)
  // undefined = ainda carregando o plano; null = sem bloqueio conhecido (fail-open)
  const [plano, setPlano] = useState<PlanoVeredito | null | undefined>(undefined)

  useEffect(() => {
    if (!modulo) return // rota usável p/ todos: nem busca
    let vivo = true
    setPlano(undefined)
    apiFetch<{ empresas?: EmpresaDaSessao[] }>('/api/auth/me')
      .then((r) => {
        if (!vivo) return
        const emp = (r.data?.empresas || []).find((e) => e.id === getEmpresaId())
        setPlano(emp?.plano ?? null)
      })
      .catch((_e: unknown) => { if (vivo) setPlano(null) }) // fail-open
    return () => { vivo = false }
  }, [modulo, pathname])

  if (!modulo) return <>{children}</>
  if (plano === undefined) return <p className="text-sm text-ink-3">Carregando…</p>
  if (bloqueado(plano, modulo)) return <PaginaBloqueada modulo={modulo} />
  return <>{children}</>
}
