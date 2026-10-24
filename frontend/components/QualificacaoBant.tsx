import { traduzirQualificacaoBant } from '@/lib/qualificacao-bant'

export type QualificacaoBantDados = {
  status?: string
  pronto_para_assuncao?: boolean
  nao_qualificado?: boolean
  necessidade?: { status?: string; evidencia?: string }
  timing?: { status?: string; evidencia?: string }
  autoridade?: { status?: string; evidencia?: string }
  budget?: { status?: string; evidencia?: string; precisa_esclarecer?: boolean }
} | null

const TOM = {
  confirmado: 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok',
  pendente: 'border-estado-warn/30 bg-estado-warn/10 text-estado-warn',
  negativo: 'border-estado-danger/30 bg-estado-danger/10 text-estado-danger',
}
type TomBant = keyof typeof TOM

export default function QualificacaoBant({ qualificacao, compacto = false }: {
  qualificacao?: QualificacaoBantDados
  compacto?: boolean
}) {
  const leitura = traduzirQualificacaoBant(qualificacao)
  const resumo: { texto: string; tom: TomBant } = leitura.prontoParaAssuncao
    ? { texto: 'Qualificado para assumir', tom: 'confirmado' }
    : leitura.naoQualificado
      ? { texto: 'Sem fit confirmado', tom: 'negativo' }
      : { texto: 'Em qualificação', tom: 'pendente' }

  return (
    <section aria-label="Sinais BANT" className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Sinais BANT</p>
          <p className="mt-1 text-sm font-semibold text-ink">Qualificação da conversa</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${TOM[resumo.tom]}`}>
          {resumo.texto}
        </span>
      </div>

      <div className={`mt-3 grid gap-2 ${compacto ? 'grid-cols-2' : 'sm:grid-cols-4'}`}>
        {leitura.dimensoes.map((item) => (
          <div key={item.chave} className={`min-w-0 rounded-md border px-3 py-2 ${TOM[item.estado as TomBant]}`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold" aria-hidden="true">{item.letra}</span>
              <span className="truncate text-xs font-semibold">{item.rotulo}</span>
            </div>
            <p className="mt-1 text-xs font-medium">{item.valor}</p>
            {!compacto && item.evidencia && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed opacity-90">{item.evidencia}</p>}
          </div>
        ))}
      </div>
      {!compacto && <p className="mt-3 text-xs text-ink-3">Verde: confirmado. Amarelo: pendente ou precisa esclarecer. Vermelho: impedimento explícito — ausência de sinal não descarta o lead.</p>}
    </section>
  )
}
