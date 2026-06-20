// Mapeia status de leads/prospects → cor neon. Mantém um fallback neutro.
const STATUS: Record<string, string> = {
  // funil de captação / prospecção
  coletado: 'text-mid border-white/15 bg-white/5',
  aguardando: 'text-mid border-white/15 bg-white/5',
  contato_encontrado: 'text-neon-amber border-neon-amber/40 bg-neon-amber/10',
  aprovado: 'text-neon-lime border-neon-lime/40 bg-neon-lime/10',
  enviado: 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10',
  respondeu: 'text-neon-amber border-neon-amber/40 bg-neon-amber/10',
  rejeitado: 'text-neon-red border-neon-red/40 bg-neon-red/10',
  nao_contatar: 'text-neon-red border-neon-red/40 bg-neon-red/10',
}

export default function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  const tone = STATUS[status] || 'text-mid border-white/15 bg-white/5'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>
      {status}
    </span>
  )
}
