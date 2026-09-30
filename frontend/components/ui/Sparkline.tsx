// Sparkline minúscula (SVG inline, sem dependência). Reforço visual de tendência no KPI — o número
// e o Δ do tile continuam sendo a informação, então a sparkline é DECORATIVA (aria-hidden).
// Recharts seria peso demais para 5 mini-gráficos numa linha; SVG puro basta.
export default function Sparkline({ valores, cor = '#64748b', largura = 100, altura = 26 }: {
  valores: number[]; cor?: string; largura?: number; altura?: number
}) {
  if (!valores || valores.length < 2) return null
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const span = max - min || 1
  const passo = largura / (valores.length - 1)
  const pts = valores
    .map((v, i) => `${(i * passo).toFixed(1)},${(altura - ((v - min) / span) * altura).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} aria-hidden="true" className="mt-1.5 block">
      <polyline points={pts} fill="none" stroke={cor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}
