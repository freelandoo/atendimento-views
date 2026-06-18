'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Prospect = {
  id: string
  nome: string
  telefone: string | null
  nicho: string
  cidade: string
  rating: number | null
  avaliacoes: number | null
  tem_site: boolean
  status: string
  score: number | null
}
type Metricas = {
  total: string; aguardando: string; aprovados: string; rejeitados: string
  enviados: string; responderam: string; taxa_resposta: number
}

const STATUS_STYLE: Record<string, string> = {
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-red-100 text-red-600',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
}

export default function ProspeccaoPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [nicho, setNicho] = useState('')
  const [cidade, setCidade] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function carregar() {
    if (!empresaId) return
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?limit=100`)
      .then((r) => setProspects(r.data || [])).catch((e) => setErro(e.message))
    apiFetch<Metricas>(`/api/empresas/${empresaId}/prospeccao/metricas`)
      .then((r) => setMetricas(r.data)).catch(() => {})
  }
  useEffect(() => { carregar() }, [empresaId])

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId || !nicho || !cidade) return
    setBuscando(true); setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
        method: 'POST',
        body: JSON.stringify({ nicho, cidade, quantidade: 20 }),
      })
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro na busca.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prospecção</h1>
        <p className="text-sm text-slate-500 mt-1">Busque leads no Google e gerencie a carteira de prospecção desta empresa.</p>
      </div>

      <form onSubmit={buscar} className="bg-white rounded-2xl shadow-sm border p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">Nicho</label>
          <input value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="ex: dentista" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">Cidade</label>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="ex: Santana, SP" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={buscando || !nicho || !cidade} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
          {buscando ? 'Buscando…' : '🔎 Buscar no Google'}
        </button>
      </form>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {metricas && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Mini title="Total" value={metricas.total} />
          <Mini title="Aguardando" value={metricas.aguardando} />
          <Mini title="Aprovados" value={metricas.aprovados} />
          <Mini title="Enviados" value={metricas.enviados} />
          <Mini title="Responderam" value={metricas.responderam} />
          <Mini title="Taxa resp." value={`${metricas.taxa_resposta}%`} />
        </div>
      )}

      <table className="w-full text-sm border rounded-xl overflow-hidden bg-white shadow-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-4 py-2">Nome</th>
            <th className="text-left px-4 py-2">Telefone</th>
            <th className="text-left px-4 py-2">Nicho / Cidade</th>
            <th className="text-right px-4 py-2">Score</th>
            <th className="text-left px-4 py-2">Site</th>
            <th className="text-left px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => (
            <tr key={p.id} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2 font-medium">{p.nome}</td>
              <td className="px-4 py-2 font-mono text-xs">{p.telefone || '—'}</td>
              <td className="px-4 py-2 text-slate-600">{p.nicho} · {p.cidade}</td>
              <td className="px-4 py-2 text-right font-semibold">{p.score ?? '—'}</td>
              <td className="px-4 py-2">{p.tem_site ? '✅' : '❌'}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
              </td>
            </tr>
          ))}
          {prospects.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Nenhum prospect ainda. Faça uma busca acima.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Mini({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  )
}
