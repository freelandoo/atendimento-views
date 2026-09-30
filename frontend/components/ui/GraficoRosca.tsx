'use client'
// Rosca de participação por categoria (Recharts). Usada para "reuniões por canal". Paleta
// categórica legível no tema claro; "cor nunca é o único sinal" — a legenda ao lado traz nome,
// valor e %. Total no centro. Empty state fica com o pai (só renderiza quando há dados).
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

type Fatia = { nome: string; valor: number; cor: string }

function TooltipRosca({ active, payload, total }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as Fatia
  const pct = total > 0 ? Math.round((d.valor / total) * 100) : 0
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-card text-xs">
      <p className="flex items-center gap-1.5 text-ink-2">
        <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: d.cor }} />
        {d.nome}: <b className="text-ink">{d.valor}</b> <span className="text-ink-3">({pct}%)</span>
      </p>
    </div>
  )
}

export default function GraficoRosca({ dados, rotuloTotal = 'total' }: { dados: Fatia[]; rotuloTotal?: string }) {
  const total = dados.reduce((s, d) => s + d.valor, 0)
  if (total === 0) return null
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="w-40 h-40 relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none">
              {dados.map((d) => <Cell key={d.nome} fill={d.cor} />)}
            </Pie>
            <Tooltip content={<TooltipRosca total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-ink">{total}</span>
          <span className="text-[10px] text-ink-3">{rotuloTotal}</span>
        </div>
      </div>
      <ul className="text-xs space-y-1.5">
        {dados.map((d) => (
          <li key={d.nome} className="flex items-center gap-2 text-ink-2">
            <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: d.cor }} />
            <span>{d.nome}</span>
            <b className="text-ink">{d.valor}</b>
            <span className="text-ink-3">({Math.round((d.valor / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
