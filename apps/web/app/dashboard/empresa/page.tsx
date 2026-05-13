'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Empresa = { id: string; nome: string; slug: string; plano: string; ativo: boolean }
type WhatsAppInstance = { id: string; evolution_instance: string; nome?: string; ativo: boolean }

export default function EmpresaPage() {
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [instancias, setInstancias] = useState<WhatsAppInstance[]>([])
  const [novaInstance, setNovaInstance] = useState('')
  const [nomeInstance, setNomeInstance] = useState('')
  const [msg, setMsg] = useState('')

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  useEffect(() => {
    if (!empresaId) return
    Promise.all([
      apiFetch<Empresa>(`/api/empresas/${empresaId}`),
      apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`),
    ]).then(([e, w]) => {
      setEmpresa(e.data)
      setInstancias(w.data)
    }).catch(() => {})
  }, [empresaId])

  async function adicionarInstancia(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ evolution_instance: novaInstance, nome: nomeInstance }),
    })
    setInstancias((prev) => [...prev, r.data])
    setNovaInstance('')
    setNomeInstance('')
    setMsg('Instância adicionada com sucesso.')
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Configurações da Empresa</h1>

      {empresa && (
        <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
          <p className="text-sm text-gray-500">Nome</p>
          <p className="font-semibold text-lg">{empresa.nome}</p>
          <p className="text-sm text-gray-500 mt-2">Plano: <span className="text-gray-800">{empresa.plano}</span></p>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold">Instâncias WhatsApp</h2>
        <form onSubmit={adicionarInstancia} className="flex gap-3">
          <input
            value={nomeInstance}
            onChange={(e) => setNomeInstance(e.target.value)}
            placeholder="Nome amigável"
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <input
            value={novaInstance}
            onChange={(e) => setNovaInstance(e.target.value)}
            placeholder="evolution_instance (ex: MinhaEmpresa)"
            required
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <button className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark">
            Adicionar
          </button>
        </form>
        {msg && <p className="text-sm text-brand">{msg}</p>}
        <div className="space-y-2">
          {instancias.map((i) => (
            <div key={i.id} className="bg-white border rounded-xl px-4 py-3 flex justify-between items-center">
              <div>
                <p className="font-medium text-sm">{i.nome || i.evolution_instance}</p>
                <p className="text-xs text-gray-500 font-mono">{i.evolution_instance}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${i.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {i.ativo ? 'ativo' : 'inativo'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
