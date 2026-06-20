'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import NeonCard from '@/components/ui/NeonCard'
import NeonProgress from '@/components/ui/NeonProgress'
import KpiCounter from '@/components/ui/KpiCounter'

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

  if (erro) return <p className="text-neon-red text-sm">{erro}</p>
  if (!dados) return <LoadingDeck />

  const t = dados.temperatura || { quente: '0', morno: '0', frio: '0', prontos_handoff: '0' }
  const nQuente = Number(t.quente || 0)
  const nMorno = Number(t.morno || 0)
  const nFrio = Number(t.frio || 0)
  const totalTemp = nQuente + nMorno + nFrio
  const pct = (n: number) => (totalTemp > 0 ? Math.round((n / totalTemp) * 100) : 0)
  const maxEstagio = Math.max(1, ...dados.por_estagio.map((r) => Number(r.total || 0)))
  const tokens = Number(dados.llm_30d?.input_tokens || 0) + Number(dados.llm_30d?.output_tokens || 0)

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Command Deck</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-hi">Visão Geral</h1>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi title="Conversas ativas" value={Number(dados.conversas?.ativas ?? 0)} tone="cyan" />
        <Kpi title="Leads quentes" value={nQuente} tone="amber" />
        <Kpi title="Prontos p/ handoff" value={Number(t.prontos_handoff ?? 0)} tone="lime" />
        <Kpi title="Vendas fechadas" value={Number(dados.conversas?.fechadas ?? 0)} tone="magenta" />
      </div>

      <section className="grid gap-6 md:grid-cols-2">
        <NeonCard tone="cyan" className="p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-lo">Temperatura dos leads</h2>
          {totalTemp === 0 ? (
            <p className="text-sm text-lo">Sem leads classificados ainda.</p>
          ) : (
            <div className="space-y-4">
              <TempBar label="🔥 Quente" n={nQuente} pct={pct(nQuente)} tone="magenta" />
              <TempBar label="🌤️ Morno" n={nMorno} pct={pct(nMorno)} tone="amber" />
              <TempBar label="❄️ Frio" n={nFrio} pct={pct(nFrio)} tone="cyan" />
            </div>
          )}
        </NeonCard>

        <NeonCard tone="violet" className="p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-lo">Funil comercial</h2>
          {dados.por_estagio.length === 0 ? (
            <p className="text-sm text-lo">Sem conversas ativas.</p>
          ) : (
            <ul className="space-y-3">
              {dados.por_estagio.map((row) => {
                const n = Number(row.total || 0)
                return (
                  <li key={row.estagio}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-mid">{ESTAGIO_LABEL[row.estagio] || row.estagio}</span>
                      <span className="font-mono font-semibold text-hi">{row.total}</span>
                    </div>
                    <NeonProgress value={Math.round((n / maxEstagio) * 100)} tone="cyan" />
                  </li>
                )
              })}
            </ul>
          )}
        </NeonCard>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi title="Follow-ups enviados" value={Number(dados.followups?.enviados ?? 0)} small />
        <Kpi title="Follow-ups respondidos" value={Number(dados.followups?.respondidos ?? 0)} small />
        <Kpi title="Chamadas IA (30d)" value={Number(dados.llm_30d?.chamadas ?? 0)} small />
        <Kpi title="Tokens IA (30d)" value={tokens} small />
      </section>
    </div>
  )
}

const ACCENT: Record<string, string> = {
  cyan: 'text-neon-cyan', amber: 'text-neon-amber', lime: 'text-neon-lime',
  magenta: 'text-neon-magenta', violet: 'text-neon-violet',
}

function Kpi({ title, value, tone = 'cyan', small }: { title: string; value: number; tone?: string; small?: boolean }) {
  return (
    <NeonCard tone={tone as 'cyan'} className="p-5">
      <p className="text-xs uppercase tracking-wide text-lo">{title}</p>
      <p className={`mt-1 font-display font-bold ${small ? 'text-2xl' : 'text-3xl'} ${ACCENT[tone] || 'text-hi'}`}>
        <KpiCounter value={value} />
      </p>
    </NeonCard>
  )
}

function TempBar({ label, n, pct, tone }: { label: string; n: number; pct: number; tone: 'cyan' | 'magenta' | 'amber' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-mid">
        <span>{label}</span>
        <span className="font-mono">{n} ({pct}%)</span>
      </div>
      <NeonProgress value={pct} tone={tone} />
    </div>
  )
}

function LoadingDeck() {
  return (
    <div className="space-y-8">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-white/5" />
      <NeonProgress className="max-w-md" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass h-24 animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  )
}
