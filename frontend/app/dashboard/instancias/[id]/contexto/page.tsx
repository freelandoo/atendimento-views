'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import ContextoEditor from '@/components/ContextoEditor'

type Inst = {
  id: string
  evolution_instance: string
  nome?: string | null
  ativo: boolean
  contexto_id?: string | null
  contexto_nome?: string | null
  config_json?: { canal?: string } | null
}
type Ctx = { id: string; nome: string; runtime_ativo?: boolean }

export default function InstanciaContextoPage() {
  const params = useParams<{ id: string }>()
  const instanceId = String(params?.id || '')
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [inst, setInst] = useState<Inst | null>(null)
  const [erro, setErro] = useState('')
  const [contextos, setContextos] = useState<Ctx[]>([])
  const [origem, setOrigem] = useState('')
  const [modo, setModo] = useState<'compartilhar' | 'duplicar'>('compartilhar')
  const [aplicando, setAplicando] = useState(false)
  const fb = useFeedback()

  const carregarInst = useCallback(async () => {
    if (!empresaId || !instanceId) return
    try {
      const r = await apiFetch<Inst>(`/api/empresas/${empresaId}/whatsapp/${instanceId}`)
      setInst(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar instância.')
    }
  }, [empresaId, instanceId])

  useEffect(() => { carregarInst() }, [carregarInst])
  useEffect(() => {
    if (!empresaId) return
    apiFetch<Ctx[]>(`/api/empresas/${empresaId}/contextos`)
      .then((r) => setContextos(r.data || []))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Erro ao carregar contextos disponíveis.'))
  }, [empresaId])

  // Reutilizar contexto: compartilhar (mesmo contexto) OU duplicar (cópia editável).
  const outros = contextos.filter((c) => c.id !== inst?.contexto_id)
  async function aplicarReuso() {
    if (!origem || !empresaId) return
    setAplicando(true)
    try {
      if (modo === 'compartilhar') {
        await apiFetch(`/api/empresas/${empresaId}/whatsapp/${instanceId}`, {
          method: 'PATCH', body: JSON.stringify({ contexto_id: origem }),
        })
        fb.toast('Contexto compartilhado — esta instância usa o mesmo agora.', 'success')
      } else {
        await apiFetch(`/api/empresas/${empresaId}/whatsapp/${instanceId}/contexto/duplicar`, {
          method: 'POST', body: JSON.stringify({ origem_contexto_id: origem }),
        })
        fb.toast('Contexto duplicado — cópia editável vinculada a esta instância.', 'success')
      }
      setOrigem('')
      await carregarInst()
    } catch (e: unknown) {
      fb.toast(e instanceof Error ? e.message : 'Falha ao reutilizar contexto.', 'error')
    } finally {
      setAplicando(false)
    }
  }

  const titulo = inst?.nome || inst?.evolution_instance || '…'
  const freelandoo = inst?.config_json?.canal === 'freelandoo'

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
              {freelandoo
                ? (inst.ativo ? 'conta habilitada para responder' : 'conta desabilitada')
                : (inst.ativo ? 'número habilitado' : 'número desabilitado')}
            </span>
          </p>
        )}
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {inst && (
        <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Reutilizar contexto de outra instância</h2>
            <p className="text-xs text-gray-500 mt-0.5">Evita recriar do zero: aproveite um contexto que você já montou.</p>
          </div>
          {outros.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhum outro contexto disponível ainda — monte um em outra instância primeiro.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-xs">
                  <span className="mb-1 block text-gray-500">Contexto de origem</span>
                  <select value={origem} onChange={(e) => setOrigem(e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-sm">
                    <option value="">Selecione…</option>
                    {outros.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}{c.runtime_ativo ? ' · fallback da empresa' : ''} · {c.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-xs">
                  <span className="mb-1 block text-gray-500">Como reutilizar</span>
                  <div className="flex gap-4 py-1.5">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="modoReuso" checked={modo === 'compartilhar'} onChange={() => setModo('compartilhar')} /> Compartilhar
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="modoReuso" checked={modo === 'duplicar'} onChange={() => setModo('duplicar')} /> Duplicar
                    </label>
                  </div>
                </div>
                <button onClick={aplicarReuso} disabled={!origem || aplicando}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {aplicando ? 'Aplicando…' : 'Aplicar'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                {modo === 'compartilhar'
                  ? 'Compartilhar: passa a usar o MESMO contexto — editar reflete em todas as instâncias vinculadas.'
                  : 'Duplicar: cria uma CÓPIA editável — cada instância fica independente depois.'}
              </p>
            </>
          )}
        </div>
      )}

      {inst?.contexto_id ? (
        <div className="bg-white border rounded-2xl p-5 shadow-sm">
          <ContextoEditor key={inst.contexto_id} empresaId={empresaId} contextoId={inst.contexto_id} />
        </div>
      ) : inst && !erro ? (
        <p className="text-sm text-gray-500">Preparando o contexto desta instância…</p>
      ) : null}
    </div>
  )
}
