// Separa nicho e cidade em dois nós visuais, no lugar da concatenação num texto único
// (`${nicho} · ${cidade}` / `${nicho} / ${cidade}`) que existia espalhada e com separador
// inconsistente entre telas. Nicho fica em destaque (informação primária da linha); cidade
// fica em texto secundário — mesma hierarquia já usada para cidade abaixo do nome em outras
// listagens do produto. O `·` entre os dois é só decoração (`aria-hidden`), nunca parte do
// texto lido por leitor de tela.
export default function NichoCidade({
  nicho, cidade, className = '', vazio = '—',
}: {
  nicho?: string | null
  cidade?: string | null
  className?: string
  vazio?: string
}) {
  const n = (nicho || '').trim()
  const c = (cidade || '').trim()
  if (!n && !c) return <span className={`text-slate-500 ${className}`}>{vazio}</span>
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      {n && <span className="text-slate-700">{n}</span>}
      {n && c && <span className="text-slate-300" aria-hidden="true">·</span>}
      {c && <span className="text-slate-400">{c}</span>}
    </span>
  )
}
