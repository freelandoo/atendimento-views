'use client'
// Guarda de sessão do dashboard. Impede que as telas operacionais (ex.: Central de
// Ligações) apareçam utilizáveis sem sessão válida e evita disparar chamadas protegidas
// em cascata. Reutiliza o MESMO apiFetch/token — não cria um segundo sistema de auth.
//   - sem token            → vai para /login.
//   - token inválido/expirado (401/403) → limpa o token e volta ao login com aviso único.
//   - erro de rede/servidor → libera a tela (as páginas mostram mensagem de rede clara),
//                             sem loop de redirecionamento.
//
// ─── OPERAÇÃO COMERCIAL (Etapa 1): O ACEITE DO TERMO ────────────────────────────────────
// O mesmo `/api/auth/me` que já era chamado aqui passou a trazer, por empresa, o veredito
// `programa_aceite` (resolvido por `services/programa-aceite.js`). Quando ele diz que o acesso
// está barrado, a pessoa vai para a tela do termo ANTES de qualquer tela da operação aparecer.
//
// ⚠️ ISTO NÃO É O BLOQUEIO, é conveniência: quem barra é `requireEmpresaAccess`, que responde
// 403 ACEITE_PENDENTE em toda rota com escopo de empresa. Sem este redirecionamento, a operação
// abriria e cada painel tomaria 403 — o bloqueio existiria, mas ilegível.
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { apiFetch, getEmpresaId, ApiError } from '@/lib/api'
import { precisaAceitar } from '@/lib/programa-aceite'
import type { ProgramaAceiteVeredito } from '@/lib/programa-aceite'

const ROTA_ACEITE = '/dashboard/aceite'

type EmpresaDaSessao = { id: string; programa_aceite?: ProgramaAceiteVeredito }

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<'checking' | 'ok'>('checking')

  useEffect(() => {
    let vivo = true
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) { router.replace('/login'); return }
    // Valida a sessão UMA vez antes de renderizar o conteúdo protegido.
    apiFetch<{ empresas?: EmpresaDaSessao[] }>('/api/auth/me')
      .then((r) => {
        if (!vivo) return
        // A própria tela do termo não redireciona para ela mesma — seria um laço.
        const atual = getEmpresaId()
        const empresa = (r.data?.empresas || []).find((e) => e.id === atual)
        if (pathname !== ROTA_ACEITE && precisaAceitar(empresa?.programa_aceite)) {
          router.replace(ROTA_ACEITE)
          return
        }
        setStatus('ok')
      })
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
    // `pathname` nas dependências de propósito: a verificação passa a rodar a cada navegação
    // dentro do painel. Sem isso, quem estivesse na tela do termo e clicasse num item do menu
    // entraria na operação sem nova checagem — a API barraria, mas com tela de erro em vez de
    // voltar para o aceite.
    return () => { vivo = false }
  }, [router, pathname])

  if (status === 'checking') {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-void text-sm text-slate-400">Verificando sessão…</div>
  }
  return <>{children}</>
}
