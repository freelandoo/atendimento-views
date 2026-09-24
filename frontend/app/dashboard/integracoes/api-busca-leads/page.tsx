'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession, podePapel } from '@/lib/useSession'
import LeadSearchApiKeys from '@/components/LeadSearchApiKeys'

// Configurações › Integrações › API de busca de leads.
//
// Área de plataforma: só superadmin cria, revoga e rotaciona códigos externos.
// A tela de Aquisição consome o motor internamente sem depender destes códigos.

export default function LeadSearchApiPage() {
  const router = useRouter()
  const { role, loading } = useSession()
  const superadmin = podePapel(role, 'superadmin')

  useEffect(() => {
    if (!loading && !superadmin) router.replace('/dashboard/integracoes')
  }, [loading, superadmin, router])

  if (loading || !superadmin) {
    return <p className="text-sm text-ink-3">Carregando...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-xs text-ink-3">
          <Link href="/dashboard/integracoes" className="hover:underline">Integrações</Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-2">API de busca de leads</span>
        </nav>
        <h1 className="mt-1 text-2xl font-bold text-ink">API de busca de leads</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-3">
          Crie e administre códigos externos para busca de leads em volume. O segredo completo
          aparece uma única vez depois da criação ou rotação.
        </p>
      </div>

      <LeadSearchApiKeys />
    </div>
  )
}
