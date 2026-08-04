'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconTrash, IconPlay } from '@/components/ui/icons'
import RotinaCampos, {
  Campo,
  QUANTIDADE_MAX,
  INTERVALO_MIN,
  RASCUNHO_VAZIO,
  resumoDias,
  type Rascunho,
} from '@/components/RotinaCampos'

// Rotinas de Aquisição: cada rotina é um mercado (nicho + cidade + UF) com agenda
// própria. A tela fala a língua do operador — nada de snapshot, dataset ou webhook.

export type Rotina = {
  id: string
  nicho: string
  cidade: string
  uf: string | null
  localizacao: string | null
  dias_semana: number[]
  janela_inicio: string
  janela_fim: string
  intervalo_horas: number
  quantidade: number
  ativo: boolean
  estado: string
  estado_label: string
  mensagem: string | null
  proxima_execucao_em: string | null
  ultima_execucao_em: string | null
  ultima_conclusao_em: string | null
  total_execucoes: number
  ultimo_coletados: number | null
  ultimo_novos: number | null
  ultimo_duplicados: number | null
  falhas_consecutivas: number
  ultimo_erro: string | null
}
type Atividade = {
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
export type RotinasResp = {
  rotinas: Rotina[]
  atividade: Atividade[]
  coleta_em_andamento: boolean
  limites: { quantidade_min: number; quantidade_max: number; intervalo_min_horas: number }
}
// Cor por estado — o admin identifica o que precisa de ação sem ler texto.
const ESTADO_STYLE: Record<string, string> = {
  ativa: 'bg-emerald-100 text-emerald-700',
  coletando: 'bg-cyan-100 text-cyan-700',
  importando: 'bg-cyan-100 text-cyan-700',
  na_fila: 'bg-indigo-100 text-indigo-700',
  aguardando_horario: 'bg-slate-100 text-slate-600',
  aguardando_intervalo: 'bg-slate-100 text-slate-600',
  concluida: 'bg-emerald-100 text-emerald-700',
  pausada: 'bg-slate-200 text-slate-600',
  precisa_atencao: 'bg-amber-100 text-amber-800',
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

export default function RotinasAquisicao({
  empresaId,
  onColetaIniciada,
  onDados,
  recarregarChave = 0,
}: {
  empresaId: string
  onColetaIniciada?: () => void
  // Publica as rotinas já carregadas para quem precisa delas na mesma tela (o
  // Assistente de Oportunidades), em vez de repetir a mesma requisição.
  onDados?: (dados: RotinasResp) => void
  // Muda de valor quando algo externo alterou as rotinas (ex.: aprovação de sugestão).
  recarregarChave?: number
}) {
  const [dados, setDados] = useState<RotinasResp | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [agindo, setAgindo] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [avulsa, setAvulsa] = useState({ nicho: '', cidade: '', uf: '', quantidade: QUANTIDADE_MAX })
  const [buscandoAvulsa, setBuscandoAvulsa] = useState(false)
  const fb = useFeedback()

  const base = `/api/empresas/${empresaId}/prospeccao/rotinas`

  // Guardado em ref para que `carregar` permaneça estável mesmo com callback inline no
  // pai — sem isso o intervalo de 20s seria recriado a cada render.
  const onDadosRef = useRef(onDados)
  useEffect(() => { onDadosRef.current = onDados }, [onDados])

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<RotinasResp>(base)
      setDados(r.data)
      onDadosRef.current?.(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as rotinas.')
    }
  }, [empresaId, base])

  useEffect(() => { carregar() }, [carregar, recarregarChave])
  // A coleta é assíncrona (leva minutos): o painel se atualiza sozinho.
  useEffect(() => {
    const t = setInterval(carregar, 20000)
    return () => clearInterval(t)
  }, [carregar])

  const rotinas = dados?.rotinas || []
  const limites = dados?.limites || { quantidade_min: 1, quantidade_max: QUANTIDADE_MAX, intervalo_min_horas: INTERVALO_MIN }

  function editar(r: Rotina) {
    setErro('')
    setRascunho({
      id: r.id, nicho: r.nicho, cidade: r.cidade, uf: r.uf || '',
      dias_semana: r.dias_semana, janela_inicio: r.janela_inicio, janela_fim: r.janela_fim,
      intervalo_horas: r.intervalo_horas, quantidade: r.quantidade, ativo: r.ativo,
    })
  }

  async function salvar() {
    if (!rascunho) return
    if (!rascunho.nicho.trim() || !rascunho.cidade.trim()) { setErro('Informe nicho e cidade.'); return }
    if (!rascunho.dias_semana.length) { setErro('Selecione ao menos um dia da semana.'); return }
    setErro('')
    setSalvando(true)
    try {
      const corpo = JSON.stringify({ ...rascunho, uf: rascunho.uf.trim().toUpperCase() || null })
      const r = rascunho.id
        ? await apiFetch<RotinasResp>(`${base}/${rascunho.id}`, { method: 'PUT', body: corpo })
        : await apiFetch<RotinasResp>(base, { method: 'POST', body: corpo })
      setDados(r.data)
      setRascunho(null)
      fb.toast(rascunho.id ? 'Rotina atualizada.' : 'Rotina criada.', 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a rotina.')
    } finally {
      setSalvando(false)
    }
  }

  async function alternarAtivo(r: Rotina) {
    setAgindo(r.id)
    try {
      const resp = await apiFetch<RotinasResp>(`${base}/${r.id}/ativar`, {
        method: 'POST', body: JSON.stringify({ ativo: !r.ativo }),
      })
      setDados(resp.data)
      fb.toast(r.ativo ? 'Rotina pausada.' : 'Rotina retomada.', 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao alterar a rotina.')
    } finally { setAgindo(null) }
  }

  async function remover(r: Rotina) {
    const ok = window.confirm(
      `Remover a rotina "${r.nicho} · ${r.localizacao || r.cidade}"?\n\n`
      + 'Ela deixa de coletar. Os leads já encontrados continuam no Banco de Leads.'
    )
    if (!ok) return
    setAgindo(r.id)
    try {
      const resp = await apiFetch<RotinasResp>(`${base}/${r.id}`, { method: 'DELETE' })
      setDados(resp.data)
      fb.toast('Rotina removida.', 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover a rotina.')
    } finally { setAgindo(null) }
  }

  async function buscarAgora() {
    if (!avulsa.nicho.trim() || !avulsa.cidade.trim()) { setErro('Informe nicho e cidade para a busca avulsa.'); return }
    setErro('')
    setBuscandoAvulsa(true)
    try {
      await apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
        method: 'POST',
        body: JSON.stringify({
          nicho: avulsa.nicho.trim(),
          cidade: avulsa.cidade.trim(),
          uf: avulsa.uf.trim().toUpperCase() || null,
          quantidade: avulsa.quantidade,
        }),
      })
      fb.toast('Busca iniciada. Os leads aparecem em alguns minutos — a lista atualiza sozinha.', 'info')
      carregar()
      onColetaIniciada?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao iniciar a busca.')
    } finally { setBuscandoAvulsa(false) }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Rotinas de coleta</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Cada rotina busca um mercado (nicho + cidade) no seu próprio ritmo, importando até
              {' '}{limites.quantidade_max} leads por execução. Uma coleta por vez — as demais esperam a vez.
            </p>
          </div>
          {!rascunho && (
            <button onClick={() => { setErro(''); setRascunho({ ...RASCUNHO_VAZIO }) }}
              className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
              + Nova rotina
            </button>
          )}
        </div>

        {dados?.coleta_em_andamento && (
          <div className="flex items-center gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            <Spinner />
            <span>Uma coleta está em andamento. As outras rotinas entram na fila e rodam em seguida.</span>
          </div>
        )}

        {rascunho && (
          <div className="space-y-4 rounded-xl border border-brand/40 bg-brand/5 p-4">
            <p className="text-sm font-semibold">{rascunho.id ? 'Editar rotina' : 'Nova rotina'}</p>

            <RotinaCampos rascunho={rascunho} onChange={setRascunho} limites={limites} />

            <div className="flex flex-wrap gap-2">
              <button onClick={salvar} disabled={salvando}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {salvando && <Spinner />}{rascunho.id ? 'Salvar alterações' : 'Criar rotina'}
              </button>
              <button onClick={() => { setRascunho(null); setErro('') }} disabled={salvando}
                className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {rotinas.length === 0 && !rascunho ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="text-sm text-slate-500">Nenhuma rotina cadastrada.</p>
            <p className="mt-1 text-xs text-slate-400">Crie uma rotina para coletar leads de um mercado continuamente.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rotinas.map((r) => (
              <div key={r.id} className="rounded-xl border p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.nicho}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-600">{r.localizacao || r.cidade}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_STYLE[r.estado] || 'bg-slate-100 text-slate-600'}`}>
                        {r.estado_label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {resumoDias(r.dias_semana)} · {r.janela_inicio}–{r.janela_fim} · a cada {r.intervalo_horas}h ·
                      {' '}importa até {r.quantidade} leads
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
                    <button onClick={() => editar(r)} disabled={agindo === r.id}
                      className="text-brand hover:underline disabled:opacity-40">Editar</button>
                    <button onClick={() => alternarAtivo(r)} disabled={agindo === r.id}
                      className={`hover:underline disabled:opacity-40 ${r.ativo ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {r.ativo ? 'Pausar' : 'Retomar'}
                    </button>
                    <button onClick={() => remover(r)} disabled={agindo === r.id}
                      className="inline-flex items-center gap-1 text-red-600 hover:underline disabled:opacity-40">
                      <IconTrash /> Remover
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-4">
                  <Dado rotulo="Próxima execução" valor={r.ativo ? quando(r.proxima_execucao_em) : 'Pausada'} />
                  <Dado rotulo="Última execução" valor={quando(r.ultima_execucao_em)} />
                  <Dado rotulo="Última coleta"
                    valor={r.ultimo_coletados == null ? '—' : `${r.ultimo_coletados} encontrados`} />
                  <Dado rotulo="Novos / duplicados"
                    valor={r.ultimo_novos == null ? '—' : `${r.ultimo_novos} / ${r.ultimo_duplicados ?? 0}`} />
                </div>

                {r.mensagem && <p className="mt-2 text-xs text-slate-500">{r.mensagem}</p>}
                {r.estado === 'precisa_atencao' && (
                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <b>Precisa de atenção.</b> A rotina parou depois de {r.falhas_consecutivas} tentativas sem sucesso.
                    {r.ultimo_erro && <span className="mt-0.5 block opacity-80">Último erro: {r.ultimo_erro}</span>}
                    <span className="mt-0.5 block">Revise os dados e clique em <b>Retomar</b>.</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">Busca avulsa</h2>
          <p className="mt-0.5 text-xs text-slate-500">Uma coleta única, agora, sem criar rotina.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Nicho">
            <input value={avulsa.nicho} placeholder="ex: dentista"
              onChange={(e) => setAvulsa({ ...avulsa, nicho: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm" />
          </Campo>
          <Campo label="Cidade">
            <input value={avulsa.cidade} placeholder="ex: Campinas"
              onChange={(e) => setAvulsa({ ...avulsa, cidade: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm" />
          </Campo>
          <Campo label="Estado (UF)">
            <input value={avulsa.uf} maxLength={2} placeholder="SP"
              onChange={(e) => setAvulsa({ ...avulsa, uf: e.target.value.toUpperCase() })}
              className="w-full rounded-lg border px-3 py-2 text-sm uppercase" />
          </Campo>
          <Campo label={`Máx. de leads a importar (1 a ${limites.quantidade_max})`}>
            <input type="number" min={limites.quantidade_min} max={limites.quantidade_max} value={avulsa.quantidade}
              title="Limite de leads que entram no Banco de Leads nesta busca. A origem pode encontrar mais registros do que isso."
              onChange={(e) => setAvulsa({ ...avulsa, quantidade: Number(e.target.value) || limites.quantidade_max })}
              className="w-full rounded-lg border px-3 py-2 text-sm" />
          </Campo>
        </div>
        <button onClick={buscarAgora} disabled={buscandoAvulsa || dados?.coleta_em_andamento}
          title={dados?.coleta_em_andamento ? 'Aguarde a coleta em andamento terminar.' : undefined}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {buscandoAvulsa ? <Spinner /> : <IconPlay />}{buscandoAvulsa ? 'Iniciando…' : 'Buscar agora'}
        </button>
      </div>

      {(dados?.atividade.length || 0) > 0 && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Atividade recente</p>
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
                {dados!.atividade.map((a) => {
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
        </div>
      )}
    </div>
  )
}


function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className="mt-0.5 text-slate-700">{valor}</p>
    </div>
  )
}
