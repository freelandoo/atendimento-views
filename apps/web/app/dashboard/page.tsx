'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Resumo = {
  conversas: { ativas: string; fechadas: string; arquivadas: string; total: string }
  por_estagio: { estagio: string; total: string }[]
  followups: { enviados: string; respondidos: string }
  llm_30d: { chamadas: string; input_tokens: string; output_tokens: string; latencia_media_ms: string }
  temperatura: { quente: string; morno: string; frio: string; prontos_handoff: string }
}

const ESTAGIO_LABEL: Record<string, string> = {
  primeiro_contato: 'Primeiro contato',
  diagnostico: 'Diagnóstico',
  proposta: 'Proposta',
  objecao: 'Objeção',
  fechamento: 'Fechamento',
}

export default function DashboardPage() {
  const [dados, setDados] = useState<Resumo | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) { setErro('Nenhuma empresa selecionada.'); return }
    apiFetch<Resumo>(`/api/empresas/${id}/relatorios/resumo`)
      .then((r) => setDados(r.data))
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <p className="text-red-600 text-sm">{erro}</p>
  if (!dados) return <p className="text-slate-500 text-sm">Carregando…</p>

  const t = dados.temperatura || { quente: '0', morno: '0', frio: '0', prontos_handoff: '0' }
  const nQuente = Number(t.quente || 0)
  const nMorno = Number(t.morno || 0)
  const nFrio = Number(t.frio || 0)
  const totalTemp = nQuente + nMorno + nFrio
  const pct = (n: number) => (totalTemp > 0 ? Math.round((n / totalTemp) * 100) : 0)

  const tokens = Number(dados.llm_30d?.input_tokens || 0) + Number(dados.llm_30d?.output_tokens || 0)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Visão Geral</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Conversas ativas" value={dados.conversas?.ativas ?? '—'} />
        <Card title="Leads quentes" value={t.quente ?? '0'} accent="text-orange-600" />
        <Card title="Prontos p/ handoff" value={t.prontos_handoff ?? '0'} accent="text-emerald-600" />
        <Card title="Vendas fechadas" value={dados.conversas?.fechadas ?? '0'} />
      </div>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border p-5">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">Temperatura dos leads</h2>
          {totalTemp === 0 ? (
            <p className="text-slate-400 text-sm">Sem leads classificados ainda.</p>
          ) : (
            <div className="space-y-3">
              <TempBar label="🔥 Quente" n={nQuente} pct={pct(nQuente)} color="bg-orange-500" />
              <TempBar label="🌤️ Morno" n={nMorno} pct={pct(nMorno)} color="bg-amber-400" />
              <TempBar label="❄️ Frio" n={nFrio} pct={pct(nFrio)} color="bg-sky-400" />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-5">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-4">Funil comercial</h2>
          {dados.por_estagio.length === 0 ? (
            <p className="text-slate-400 text-sm">Sem conversas ativas.</p>
          ) : (
            <ul className="space-y-2">
              {dados.por_estagio.map((row) => (
                <li key={row.estagio} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{ESTAGIO_LABEL[row.estagio] || row.estagio}</span>
                  <span className="font-semibold">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Follow-ups enviados" value={dados.followups?.enviados ?? '0'} small />
        <Card title="Follow-ups respondidos" value={dados.followups?.respondidos ?? '0'} small />
        <Card title="Chamadas IA (30d)" value={dados.llm_30d?.chamadas ?? '0'} small />
        <Card title="Tokens IA (30d)" value={tokens.toLocaleString('pt-BR')} small />
      </section>
    </div>
  )
}

function Card({ title, value, accent, small }: { title: string; value: string | number; accent?: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{title}</p>
      <p className={`${small ? 'text-2xl' : 'text-3xl'} font-bold mt-1 ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function TempBar({ label, n, pct, color }: { label: string; n: number; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span>{n} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
