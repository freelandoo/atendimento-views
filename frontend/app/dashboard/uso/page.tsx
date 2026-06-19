'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Totais = {
  chamadas: number
  sucesso: number
  erros: number
  input_tokens: number
  output_tokens: number
  cost_usd: string
}
type LinhaTipo = { tipo: string; chamadas: number; input_tokens: number; output_tokens: number; cost_usd: string }
type LinhaCliente = { client_numero: string; chamadas: number; input_tokens: number; output_tokens: number; cost_usd: string; ultima_em: string }
type LinhaContexto = { contexto_id: string; contexto_nome: string | null; chamadas: number; input_tokens: number; output_tokens: number; cost_usd: string; ultima_em: string }
type LinhaModelo = { provider: string; model: string; chamadas: number; input_tokens: number; output_tokens: number; cost_usd: string }
type LinhaRecente = {
  id: string; created_at: string; provider: string; model: string; task: string | null
  ref_type: string | null; client_numero: string | null
  success: boolean; input_tokens: number | null; output_tokens: number | null; cost_usd: string | null
}

type Uso = {
  filtro: { from: string; to: string }
  totais: Totais
  por_tipo: LinhaTipo[]
  por_cliente: LinhaCliente[]
  por_contexto: LinhaContexto[]
  por_modelo: LinhaModelo[]
  recentes: LinhaRecente[]
}

function fmtUSD(v: string | number | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 })
}
function fmtInt(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0)
  return (n || 0).toLocaleString('pt-BR')
}
function fmtData(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function UsoPage() {
  const [uso, setUso] = useState<Uso | null>(null)
  const [from, setFrom] = useState<string>(isoDate(new Date(Date.now() - 30 * 24 * 3600 * 1000)))
  const [to, setTo] = useState<string>(isoDate(new Date()))
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setLoading(true)
    setErro(null)
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString()
      const toIso = new Date(`${to}T23:59:59`).toISOString()
      const r = await apiFetch<Uso>(`/api/empresas/${empresaId}/llm/uso?from=${fromIso}&to=${toIso}`)
      setUso(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.')
    } finally {
      setLoading(false)
    }
  }, [empresaId, from, to])

  useEffect(() => {
    carregar()
  }, [carregar])

  const t = uso?.totais

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Uso & Custo</h1>

      <div className="bg-white border rounded-2xl p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={carregar} disabled={loading} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
        {erro && <span className="text-sm text-red-600 ml-2">{erro}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Chamadas" value={fmtInt(t?.chamadas)} sub={t ? `${t.sucesso} ok / ${t.erros} erro` : ''} />
        <Card label="Tokens entrada" value={fmtInt(t?.input_tokens)} />
        <Card label="Tokens saída" value={fmtInt(t?.output_tokens)} />
        <Card label="Custo total" value={fmtUSD(t?.cost_usd)} highlight />
      </div>

      <Tabela
        titulo="Por tipo de uso"
        colunas={['Tipo', 'Chamadas', 'Tokens entrada', 'Tokens saída', 'Custo']}
        linhas={(uso?.por_tipo || []).map((r) => [r.tipo, fmtInt(r.chamadas), fmtInt(r.input_tokens), fmtInt(r.output_tokens), fmtUSD(r.cost_usd)])}
      />

      <Tabela
        titulo="Por cliente (WhatsApp)"
        colunas={['Número', 'Chamadas', 'Tokens entrada', 'Tokens saída', 'Custo', 'Última atividade']}
        linhas={(uso?.por_cliente || []).map((r) => [
          r.client_numero, fmtInt(r.chamadas), fmtInt(r.input_tokens), fmtInt(r.output_tokens), fmtUSD(r.cost_usd), fmtData(r.ultima_em),
        ])}
        vazio="Nenhuma chamada vinculada a cliente no período."
      />

      <Tabela
        titulo="Por contexto"
        colunas={['Contexto', 'Chamadas', 'Tokens entrada', 'Tokens saída', 'Custo', 'Última geração']}
        linhas={(uso?.por_contexto || []).map((r) => [
          r.contexto_nome || r.contexto_id?.slice(0, 8) || '—',
          fmtInt(r.chamadas), fmtInt(r.input_tokens), fmtInt(r.output_tokens), fmtUSD(r.cost_usd), fmtData(r.ultima_em),
        ])}
        vazio="Nenhuma geração de contexto no período."
      />

      <Tabela
        titulo="Por modelo"
        colunas={['Provider/Modelo', 'Chamadas', 'Tokens entrada', 'Tokens saída', 'Custo']}
        linhas={(uso?.por_modelo || []).map((r) => [`${r.provider}/${r.model}`, fmtInt(r.chamadas), fmtInt(r.input_tokens), fmtInt(r.output_tokens), fmtUSD(r.cost_usd)])}
      />

      <Tabela
        titulo="Últimas 50 chamadas"
        colunas={['Quando', 'Tipo', 'Modelo', 'Cliente/Ref', 'Entrada', 'Saída', 'Custo', 'Status']}
        linhas={(uso?.recentes || []).map((r) => [
          fmtData(r.created_at),
          r.ref_type || r.task || '—',
          `${r.provider}/${r.model}`,
          r.client_numero || (r.ref_type === 'contexto' ? 'contexto' : '—'),
          fmtInt(r.input_tokens),
          fmtInt(r.output_tokens),
          fmtUSD(r.cost_usd),
          r.success ? 'ok' : 'erro',
        ])}
      />
    </div>
  )
}

function Card({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded-2xl p-4 shadow-sm ${highlight ? 'bg-brand text-white' : 'bg-white'}`}>
      <p className={`text-xs ${highlight ? 'text-white/80' : 'text-gray-500'}`}>{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className={`text-xs mt-1 ${highlight ? 'text-white/80' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

function Tabela({ titulo, colunas, linhas, vazio }: {
  titulo: string
  colunas: string[]
  linhas: (string | number)[][]
  vazio?: string
}) {
  return (
    <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b">
        <h2 className="font-semibold text-sm">{titulo}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              {colunas.map((c) => (
                <th key={c} className="px-4 py-2 text-left font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr><td colSpan={colunas.length} className="px-4 py-6 text-center text-gray-400">{vazio || 'Sem dados no período.'}</td></tr>
            ) : (
              linhas.map((linha, i) => (
                <tr key={i} className="border-t">
                  {linha.map((celula, j) => (
                    <td key={j} className="px-4 py-2 align-top">{celula as React.ReactNode}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
