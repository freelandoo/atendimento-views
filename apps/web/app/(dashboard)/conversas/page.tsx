'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Conversa = {
  numero: string
  estagio: string
  status: string
  negocio?: string
  temperatura_lead?: number
  atualizado_em: string
}

export default function ConversasPage() {
  const [lista, setLista] = useState<Conversa[]>([])
  const [erro, setErro] = useState('')

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) return
    apiFetch<Conversa[]>(`/api/empresas/${id}/conversas?limit=50`)
      .then((r) => setLista(r.data))
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <p className="text-red-600">{erro}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conversas</h1>
      <table className="w-full text-sm border rounded-xl overflow-hidden bg-white shadow-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-4 py-2">Número</th>
            <th className="text-left px-4 py-2">Negócio</th>
            <th className="text-left px-4 py-2">Estágio</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-right px-4 py-2">Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.numero} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2 font-mono text-xs">{c.numero}</td>
              <td className="px-4 py-2">{c.negocio || '—'}</td>
              <td className="px-4 py-2">{c.estagio}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-gray-500">
                {new Date(c.atualizado_em).toLocaleDateString('pt-BR')}
              </td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Nenhuma conversa encontrada.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
