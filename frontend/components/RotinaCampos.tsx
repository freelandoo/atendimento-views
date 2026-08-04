'use client'
import type { ReactNode } from 'react'

// Campos de uma rotina de coleta (mercado + agenda), compartilhados por quem cria a
// rotina à mão (RotinasAquisicao) e por quem aprova uma sugestão do assistente
// (AssistenteOportunidades). Um formulário só, para as duas telas nunca divergirem
// nos limites, nos rótulos ou no que cada campo significa.

export type Rascunho = {
  id?: string
  nicho: string
  cidade: string
  uf: string
  dias_semana: number[]
  janela_inicio: string
  janela_fim: string
  intervalo_horas: number
  quantidade: number
  ativo: boolean
}

export type Limites = { quantidade_min: number; quantidade_max: number; intervalo_min_horas: number }

export const QUANTIDADE_MAX = 200
export const INTERVALO_MIN = 6
export const LIMITES_PADRAO: Limites = {
  quantidade_min: 1, quantidade_max: QUANTIDADE_MAX, intervalo_min_horas: INTERVALO_MIN,
}

export const DIAS = [
  { valor: 0, curto: 'D', nome: 'domingo' },
  { valor: 1, curto: 'S', nome: 'segunda' },
  { valor: 2, curto: 'T', nome: 'terça' },
  { valor: 3, curto: 'Q', nome: 'quarta' },
  { valor: 4, curto: 'Q', nome: 'quinta' },
  { valor: 5, curto: 'S', nome: 'sexta' },
  { valor: 6, curto: 'S', nome: 'sábado' },
]

export const RASCUNHO_VAZIO: Rascunho = {
  nicho: '', cidade: '', uf: '', dias_semana: [1, 2, 3, 4, 5],
  janela_inicio: '08:00', janela_fim: '18:00',
  intervalo_horas: INTERVALO_MIN, quantidade: QUANTIDADE_MAX, ativo: true,
}

// "Seg a Sex", "Todos os dias", "Seg, Qua, Sex" — resumo legível dos dias ativos.
export function resumoDias(dias: number[]): string {
  const ordenados = [...new Set(dias)].sort((a, b) => a - b)
  if (ordenados.length === 7) return 'Todos os dias'
  if (ordenados.join(',') === '1,2,3,4,5') return 'Seg a Sex'
  const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return ordenados.map((d) => nomes[d]).join(', ') || 'Nenhum dia'
}

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] uppercase text-slate-500">{label}</label>
      {children}
    </div>
  )
}

export default function RotinaCampos({
  rascunho,
  onChange,
  limites = LIMITES_PADRAO,
  mostrarAtivo = true,
}: {
  rascunho: Rascunho
  onChange: (r: Rascunho) => void
  limites?: Limites
  // O fluxo de aprovação esconde este campo: rotina aprovada nasce sempre pausada.
  mostrarAtivo?: boolean
}) {
  function alternarDia(dia: number) {
    const tem = rascunho.dias_semana.includes(dia)
    onChange({
      ...rascunho,
      dias_semana: tem
        ? rascunho.dias_semana.filter((d) => d !== dia)
        : [...rascunho.dias_semana, dia].sort((a, b) => a - b),
    })
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Nicho">
          <input value={rascunho.nicho} placeholder="ex: dentista"
            onChange={(e) => onChange({ ...rascunho, nicho: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
        <Campo label="Cidade">
          <input value={rascunho.cidade} placeholder="ex: Campinas"
            onChange={(e) => onChange({ ...rascunho, cidade: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
        <Campo label="Estado (UF)">
          <input value={rascunho.uf} maxLength={2} placeholder="SP"
            onChange={(e) => onChange({ ...rascunho, uf: e.target.value.toUpperCase() })}
            className="w-full rounded-lg border px-3 py-2 text-sm uppercase" />
        </Campo>
        {/* A quantidade corta a IMPORTAÇÃO, não a coleta na origem: a fonte pode devolver
            mais registros antes desse corte. O rótulo não promete volume nem custo. */}
        <Campo label={`Máx. de leads a importar (1 a ${limites.quantidade_max})`}>
          <input type="number" min={limites.quantidade_min} max={limites.quantidade_max} value={rascunho.quantidade}
            title="Limite de leads que entram no Banco de Leads a cada execução. A busca na origem pode encontrar mais registros do que isso."
            onChange={(e) => onChange({ ...rascunho, quantidade: Number(e.target.value) || limites.quantidade_max })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] uppercase text-slate-500">Dias ativos</label>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map((d) => {
            const ativo = rascunho.dias_semana.includes(d.valor)
            return (
              <button key={d.valor} type="button" onClick={() => alternarDia(d.valor)}
                title={d.nome} aria-pressed={ativo}
                className={`h-9 w-9 rounded-lg border text-sm font-medium transition ${
                  ativo ? 'border-brand bg-brand text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}>
                {d.curto}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Início da janela">
          <input type="time" value={rascunho.janela_inicio}
            onChange={(e) => onChange({ ...rascunho, janela_inicio: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
        <Campo label="Fim da janela">
          <input type="time" value={rascunho.janela_fim}
            onChange={(e) => onChange({ ...rascunho, janela_fim: e.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
        <Campo label={`Buscar a cada (mín. ${limites.intervalo_min_horas}h)`}>
          <input type="number" min={limites.intervalo_min_horas} max={168} value={rascunho.intervalo_horas}
            onChange={(e) => onChange({
              ...rascunho,
              intervalo_horas: Math.max(limites.intervalo_min_horas, Number(e.target.value) || limites.intervalo_min_horas),
            })}
            className="w-full rounded-lg border px-3 py-2 text-sm" />
        </Campo>
      </div>

      {mostrarAtivo && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={rascunho.ativo}
            onChange={(e) => onChange({ ...rascunho, ativo: e.target.checked })} />
          <span><b>Rotina ativa</b>
            <span className="block text-xs text-slate-500">Desmarcado, a rotina fica pausada e não coleta nada.</span>
          </span>
        </label>
      )}
    </>
  )
}
