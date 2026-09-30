'use client'
// Série do painel comercial como gráfico de linhas (Recharts), no lugar das barras-CSS empilhadas.
// Cores = tokens do tema claro (tailwind.config.ts); "cor nunca é o único sinal" — a legenda e o
// tooltip mostram o RÓTULO e o VALOR em texto. Dois eixos Y: volume (msg/lig/resp) à esquerda,
// reuniões à direita (números pequenos que sumiriam num eixo só).
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { DiaSerie } from '@/lib/painel-comercial'

const COR = {
  mensagens: '#38bdf8', // sky-400
  conversou: '#f59e0b', // amber-500
  ligacoes: '#6366f1', //  indigo-500
  reunioes: '#10b981', //  emerald-500
}
const EIXO = '#64748b' // ink-3
const GRADE = '#e2e8f0' // line

const ddmm = (ymd: string) => ymd.slice(5).split('-').reverse().join('/') // 2026-09-23 → 23/09

type Ponto = { dia: string; mensagens: number; conversou: number; ligacoes: number; reunioes: number }

function TooltipConteudo({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-card text-xs">
      <p className="font-semibold text-ink mb-1">{ddmm(String(label))}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-ink-2">
          <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: <b className="text-ink">{p.value}</b>
        </p>
      ))}
    </div>
  )
}

export default function GraficoSerie({ serie }: { serie: DiaSerie[] }) {
  if (!serie?.length) return <p className="text-ink-3 text-sm">Sem atividade no período.</p>
  const dados: Ponto[] = serie.map((d) => ({
    dia: d.dia,
    mensagens: d.mensagens,
    conversou: d.conversou,
    ligacoes: d.ligacoes,
    reunioes: d.reunioes_humano + d.reunioes_bot,
  }))
  return (
    <div className="w-full h-72" role="img" aria-label="Gráfico de linhas: mensagens, respostas, ligações e reuniões ao longo do período.">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRADE} vertical={false} />
          <XAxis dataKey="dia" tickFormatter={ddmm} tick={{ fontSize: 11, fill: EIXO }} tickLine={false} axisLine={{ stroke: GRADE }} minTickGap={16} />
          <YAxis yAxisId="vol" tick={{ fontSize: 11, fill: EIXO }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <YAxis yAxisId="reun" orientation="right" tick={{ fontSize: 11, fill: COR.reunioes }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
          <Tooltip content={<TooltipConteudo />} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
          <Line yAxisId="vol" type="monotone" dataKey="mensagens" name="Mensagens" stroke={COR.mensagens} strokeWidth={2} dot={false} />
          <Line yAxisId="vol" type="monotone" dataKey="conversou" name="Respostas" stroke={COR.conversou} strokeWidth={2} dot={false} />
          <Line yAxisId="vol" type="monotone" dataKey="ligacoes" name="Ligações" stroke={COR.ligacoes} strokeWidth={2} dot={false} />
          <Line yAxisId="reun" type="monotone" dataKey="reunioes" name="Reuniões" stroke={COR.reunioes} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
