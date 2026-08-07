'use client'

// Histórico de coletas (antiga "Atividade recente" das Rotinas de Aquisição).
// É consulta secundária: vive no modo **Rotinas** da página de Aquisição, abaixo do painel
// de rotinas — é histórico de execução, não revisão de lead. O conteúdo é o mesmo de
// antes — quando, mercado, origem, situação, encontrados, novos, duplicados e a falha
// quando houver.

export type Atividade = {
  id: string
  rotina_id: string | null
  nicho: string
  cidade: string
  origem: string
  status: string
  coletados: number
  novos: number
  duplicados: number
  quantidade_solicitada: number
  erro: string | null
  created_at: string
}

const STATUS_ATIVIDADE: Record<string, { label: string; cor: string }> = {
  pendente: { label: 'Iniciando', cor: 'bg-cyan-100 text-cyan-700' },
  processando: { label: 'Coletando', cor: 'bg-cyan-100 text-cyan-700' },
  concluido: { label: 'Concluída', cor: 'bg-emerald-100 text-emerald-700' },
  falhou: { label: 'Falhou', cor: 'bg-red-100 text-red-600' },
}

function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// De onde veio a coleta. O histórico tem linhas do motor FIXO antigo (aposentado pelas
// rotinas): elas não podem aparecer como "Avulsa", que significa busca feita à mão.
function origemLabel(a: Atividade): string {
  if (a.rotina_id) return 'Rotina'
  if (a.origem === 'ia') return 'Busca IA'
  if (a.origem === 'rotina') return 'Rotina'
  if (a.origem === 'automatico_fixo') return 'Automático (antigo)'
  return 'Avulsa'
}

export default function HistoricoColetas({ atividade }: { atividade: Atividade[] }) {
  if (atividade.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <p className="text-sm text-slate-500">Nenhuma coleta registrada ainda.</p>
        <p className="mt-1 text-xs text-slate-400">
          As coletas das rotinas e das buscas avulsas aparecem aqui assim que rodarem.
        </p>
      </div>
    )
  }
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-max text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1.5 pr-4">Quando</th>
            <th className="py-1.5 pr-4">Mercado</th>
            <th className="py-1.5 pr-4">Origem</th>
            <th className="py-1.5 pr-4">Situação</th>
            <th className="py-1.5 pr-4 text-right">Encontrados</th>
            <th className="py-1.5 pr-4 text-right">Novos</th>
            <th className="py-1.5 text-right">Duplicados</th>
          </tr>
        </thead>
        <tbody>
          {atividade.map((a) => {
            const s = STATUS_ATIVIDADE[a.status] || { label: a.status, cor: 'bg-slate-100 text-slate-600' }
            return (
              <tr key={a.id} className="border-t">
                <td className="py-1.5 pr-4 whitespace-nowrap text-xs text-slate-500">{quando(a.created_at)}</td>
                <td className="py-1.5 pr-4">{a.nicho} · {a.cidade}</td>
                <td className="py-1.5 pr-4 text-xs text-slate-500">{origemLabel(a)}</td>
                <td className="py-1.5 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.label}</span>
                  {a.erro && <span className="ml-1 text-xs text-red-500" title={a.erro}>⚠</span>}
                </td>
                <td className="py-1.5 pr-4 text-right">{a.status === 'concluido' ? a.coletados : '—'}</td>
                <td className="py-1.5 pr-4 text-right font-medium text-emerald-700">{a.status === 'concluido' ? a.novos : '—'}</td>
                <td className="py-1.5 text-right text-slate-500">{a.status === 'concluido' ? a.duplicados : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
