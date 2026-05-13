'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Resumo = {
  conversas: { ativas: string; fechadas: string; total: string }
  por_estagio: { estagio: string; total: string }[]
  followups: { enviados: string; respondidos: string }
}

export default function DashboardPage() {
  const [dados, setDados] = useState<Resumo | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) return
    apiFetch<Resumo>(`/api/empresas/${id}/relatorios/resumo`)
      .then((r) => setDados(r.data))
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <p className="text-red-600">{erro}</p>
  if (!dados) return <p className="text-gray-500 text-sm">Carregando…</p>

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Visão Geral</h1>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Conversas ativas" value={dados.conversas?.ativas ?? '—'} />
        <Card title="Vendas fechadas" value={dados.conversas?.fechadas ?? '—'} />
        <Card title="Follow-ups enviados" value={dados.followups?.enviados ?? '—'} />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Por estágio</h2>
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-4 py-2">Estágio</th>
              <th className="text-right px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.por_estagio.map((row) => (
              <tr key={row.estagio} className="border-t">
                <td className="px-4 py-2">{row.estagio}</td>
                <td className="px-4 py-2 text-right">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{title}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  )
}
