'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import ContextoEditor from '@/components/ContextoEditor'

type Inst = {
  id: string
  evolution_instance: string
  nome?: string | null
  ativo: boolean
  contexto_id?: string | null
  contexto_nome?: string | null
}

export default function InstanciaContextoPage() {
  const params = useParams<{ id: string }>()
  const instanceId = String(params?.id || '')
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [inst, setInst] = useState<Inst | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!empresaId || !instanceId) return
    apiFetch<Inst>(`/api/empresas/${empresaId}/whatsapp/${instanceId}`)
      .then((r) => setInst(r.data))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Erro ao carregar instância.'))
  }, [empresaId, instanceId])

  const titulo = inst?.nome || inst?.evolution_instance || '…'

  return (
    <div className="space-y-5 max-w-6xl">
      <Link href="/dashboard/contextos" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        ← Voltar para Instâncias
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Contexto — {titulo}</h1>
        {inst && (
          <p className="text-xs text-gray-500 mt-0.5">
            Instância <span className="font-mono">{inst.evolution_instance}</span>
            {' · '}
            <span className={inst.ativo ? 'text-green-700' : 'text-amber-700'}>
              {inst.ativo ? 'número ativo' : 'número desativado'}
            </span>
          </p>
        )}
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {inst?.contexto_id ? (
        <div className="bg-white border rounded-2xl p-5 shadow-sm">
          <ContextoEditor empresaId={empresaId} contextoId={inst.contexto_id} />
        </div>
      ) : inst && !erro ? (
        <p className="text-sm text-gray-500">Preparando o contexto desta instância…</p>
      ) : null}
    </div>
  )
}
