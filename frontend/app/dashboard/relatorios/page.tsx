'use client'
import { useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type RelatorioIA = { texto: string; provider: string; model: string }

const TIPOS = ['geral', 'vendas', 'funil', 'followup', 'leads']

export default function RelatoriosPage() {
  const [tipo, setTipo] = useState('geral')
  const [resultado, setResultado] = useState<RelatorioIA | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  async function gerar() {
    const empresaId = getEmpresaId()
    if (!empresaId) return
    setLoading(true)
    setErro('')
    setResultado(null)
    try {
      const r = await apiFetch<RelatorioIA>(`/api/empresas/${empresaId}/relatorios/ia`, {
        method: 'POST',
        body: JSON.stringify({ tipo }),
      })
      setResultado(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar relatório.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Relatórios</h1>

      <div className="flex gap-3 items-center">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={gerar}
          disabled={loading}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? 'Gerando…' : 'Gerar via IA'}
        </button>
      </div>

      {erro && <p className="text-neon-red text-sm">{erro}</p>}

      {resultado && (
        <div className="bg-panel border rounded-2xl p-6 shadow-sm">
          <p className="text-xs text-lo mb-3">
            Gerado por {resultado.provider} / {resultado.model}
          </p>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{resultado.texto}</pre>
        </div>
      )}
    </div>
  )
}
