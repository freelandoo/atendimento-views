'use client'
// Guard central de PLANO por página. Se a rota atual é um módulo que o plano da empresa não
// libera, mostra PaginaBloqueada no lugar do conteúdo. Sem "Carregando": lê o plano do store que o
// AuthGuard já preencheu (ele busca /me antes de renderizar o dashboard). Se o store ainda não
// souber (raro), FAIL-OPEN renderiza o conteúdo — o BACKEND continua a autoridade (403).
import { usePathname } from 'next/navigation'
import { getEmpresaId } from '@/lib/api'
import { getPlanoAtual } from '@/lib/plano'
import { moduloDaRota, bloqueado } from '@/lib/plano-modulos'
import PaginaBloqueada from './PaginaBloqueada'

export default function BloqueioPlano({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const modulo = moduloDaRota(pathname)
  if (!modulo) return <>{children}</> // rota usável para todos

  const { conhecido, plano } = getPlanoAtual(getEmpresaId())
  if (conhecido && bloqueado(plano, modulo)) return <PaginaBloqueada modulo={modulo} />
  return <>{children}</>
}
