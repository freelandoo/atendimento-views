'use client'
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconCheck, IconTrash, IconSparkle, IconClose } from '@/components/ui/icons'
import { CRITERIOS_ICP_TENKA, calcularIcp, seloIcp } from '@/lib/lead-icp'

// Assistente de Oportunidades — sessão de análise, UMA oportunidade por vez.
//
// O operador roda a Busca avulsa (que continua trazendo os leads como sempre) e, quando
// quiser, abre esta sessão. O assistente mostra um lead de cada vez com uma explicação
// curta; aprovar coloca o lead na carteira de trabalho, descartar o tira da fila. Cada
// decisão ensina o assistente a ordenar melhor as próximas — sem nenhum ajuste manual.
//
// A tela fala a língua do operador: nada de modelo, prompt, pontuação interna ou
// fornecedor de dados.

type Oportunidade = {
  prospect_id: string
  nome: string
  telefone: string | null
  endereco: string | null
  nicho: string
  cidade: string
  // Canônicos do backend: `site` só quando é site PRÓPRIO (services/site-classificacao.js).
  site: string | null
  tem_site: boolean
  link_original: string | null
  classificacao_url: string | null
  situacao_site: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  maps_url: string | null
  rating: number | null
  avaliacoes: number | null
  score_cadastro: number | null
  motivo: string
  motivos: string[]
  icp?: {
    score: number
    score_maximo: number
    faixa: 'A' | 'B' | 'C' | 'sem_icp'
    respostas: Record<string, boolean>
    criterios: { id: string; rotulo: string; pontos: number; marcado?: boolean; pontos_obtidos?: number }[]
    sinais_auto?: Record<string, { sugerido: boolean; motivo?: string }>
    motivos?: string[]
  } | null
}
type Sessao = {
  id: string
  nicho: string | null
  cidade: string | null
  uf: string | null
  escopo_ampliado: boolean
  meta: number
  aprovados: number
  descartados: number
  status: 'ativa' | 'concluida' | 'encerrada'
}
type SessaoHistorico = {
  id: string
  nicho: string | null
  cidade: string | null
  meta: number
  aprovados: number
  descartados: number
  status: string
  criado_em: string
}
export type CuradoriaResp = {
  sessao: Sessao | null
  oportunidade: Oportunidade | null
  estado: 'analisando' | 'concluida' | 'sem_candidatos' | null
  mensagem: string | null
  restantes: number
  ampliar_disponivel?: boolean
  historico?: SessaoHistorico[]
  decisao?: {
    prospect_id: string
    decisao: 'aprovado' | 'descartado'
    contou_meta: boolean
    repetida: boolean
    ja_decidido: boolean
    nome: string | null
  }
}

function quando(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function AssistenteOportunidades({
  empresaId,
  mercado,
  meta,
  onFechar,
  onLeadsAlterados,
}: {
  empresaId: string
  // Mercado que o operador acabou de buscar. Vazio = toda a carteira.
  mercado: { nicho: string; cidade: string; uf: string }
  // Meta de leads NOVOS aprovados — o mesmo número da Busca avulsa.
  meta: number
  onFechar: () => void
  // A lista de leads da página muda a cada decisão; o pai recarrega.
  onLeadsAlterados?: () => void
}) {
  const [dados, setDados] = useState<CuradoriaResp | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [decidindo, setDecidindo] = useState(false)
  const [erro, setErro] = useState('')
  const [respostasIcp, setRespostasIcp] = useState<Record<string, boolean>>({})
  const [observacaoIcp, setObservacaoIcp] = useState('')
  const [checklistIcpAberto, setChecklistIcpAberto] = useState(false)
  const fb = useFeedback()

  const base = `/api/empresas/${empresaId}/prospeccao/curadoria`

  // Abre (ou retoma) a sessão assim que o painel monta. Uma sessão por vez é garantida
  // no banco: reabrir devolve a que já estava em andamento, sem perder o progresso.
  const iniciar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    try {
      const r = await apiFetch<CuradoriaResp>(`${base}/sessao`, {
        method: 'POST',
        body: JSON.stringify({
          nicho: mercado.nicho.trim() || null,
          cidade: mercado.cidade.trim() || null,
          uf: mercado.uf.trim().toUpperCase() || null,
          meta,
        }),
      })
      setDados(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir o assistente.')
    } finally {
      setCarregando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, base])

  useEffect(() => { iniciar() }, [iniciar])

  useEffect(() => {
    const respostas = dados?.oportunidade?.icp?.respostas
    const base: Record<string, boolean> = {}
    for (const c of CRITERIOS_ICP_TENKA) base[c.id] = respostas?.[c.id] === true
    setRespostasIcp(base)
    setObservacaoIcp('')
    setChecklistIcpAberto(false)
  }, [dados?.oportunidade?.prospect_id])

  // Fechar com Esc: a sessão continua salva e pode ser retomada depois.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar])

  async function decidir(decisao: 'aprovado' | 'descartado') {
    const alvo = dados?.oportunidade
    if (!alvo || decidindo) return
    setDecidindo(true)
    setErro('')
    try {
      const r = await apiFetch<CuradoriaResp>(`${base}/decidir`, {
        method: 'POST',
        body: JSON.stringify({
          prospect_id: alvo.prospect_id,
          decisao,
          icp: { respostas: respostasIcp, observacao: observacaoIcp },
        }),
      })
      setDados(r.data)
      setChecklistIcpAberto(false)
      onLeadsAlterados?.()
      const d = r.data.decisao
      if (d?.ja_decidido) fb.toast('Este lead já tinha sido decidido — nada foi duplicado.', 'info')
      else if (decisao === 'aprovado') {
        const selo = seloIcp(icpAtual.faixa, icpAtual.score)
        fb.toast(`${alvo.nome} entrou na carteira como ${selo.rotulo}${selo.score != null ? ` (${selo.score}/13)` : ''}.`, 'success')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar a decisão.')
    } finally {
      setDecidindo(false)
    }
  }

  async function acao(caminho: 'ampliar' | 'encerrar') {
    setDecidindo(true)
    setErro('')
    try {
      const r = await apiFetch<CuradoriaResp>(`${base}/${caminho}`, { method: 'POST' })
      setDados(r.data)
      if (caminho === 'encerrar') onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao continuar a sessão.')
    } finally {
      setDecidindo(false)
    }
  }

  const sessao = dados?.sessao || null
  const oportunidade = dados?.oportunidade || null
  const aprovados = sessao?.aprovados ?? 0
  const alvo = sessao?.meta ?? meta
  const progresso = Math.min(100, Math.round((aprovados / Math.max(1, alvo)) * 100))
  const concluida = dados?.estado === 'concluida'
  const semCandidatos = dados?.estado === 'sem_candidatos'
  const icpAtual = useMemo(() => calcularIcp(respostasIcp), [respostasIcp])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Assistente de Oportunidades"
    >
      <div
        className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <IconSparkle className="h-4 w-4 text-orange-500" />
              Assistente de Oportunidades
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {sessao?.escopo_ampliado
                ? 'Analisando toda a sua carteira'
                : sessao?.nicho
                  ? `${sessao.nicho}${sessao.cidade ? ` · ${sessao.cidade}` : ''}`
                  : 'Analisando toda a sua carteira'}
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar assistente"
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <IconClose />
          </button>
        </div>

        {/* Progresso de aprovados em relação à meta — a única contagem que importa. */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">{aprovados} de {alvo} leads aprovados</span>
            {!!dados?.restantes && !concluida && (
              <span className="text-slate-400">{dados.restantes} para avaliar</span>
            )}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progresso}%` }} />
          </div>
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {carregando && (
          <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-sm text-slate-500">
            <Spinner /> Separando as melhores oportunidades…
          </div>
        )}

        {!carregando && oportunidade && (
          <div className="space-y-3 rounded-xl border p-4">
            <div>
              <p className="font-semibold">
                {oportunidade.maps_url ? (
                  <a href={oportunidade.maps_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    {oportunidade.nome} <span className="text-xs text-slate-400">↗</span>
                  </a>
                ) : oportunidade.nome}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {oportunidade.nicho} · {oportunidade.cidade}
                {oportunidade.telefone ? ` · ${oportunidade.telefone}` : ''}
              </p>
            </div>

            {/* A explicação da recomendação: é ela que o operador lê antes de decidir. */}
            <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">
              {oportunidade.motivo}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ICP Tenka v1.1</p>
                  <p className="mt-0.5 text-xs text-slate-500">Qualidade comercial. A bolinha de cadastro mede outra coisa.</p>
                </div>
                <SeloIcp faixa={icpAtual.faixa} score={icpAtual.score} />
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2">
                <p className="text-xs font-medium text-slate-700">Antes de marcar, revise o checklist ICP.</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  O sistema sugere alguns sinais, mas a pontuacao final e a sua validacao humana.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {icpAtual.criterios.filter((c) => c.marcado).slice(0, 4).map((c) => (
                    <span key={c.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                      {c.rotulo} +{c.pontos}
                    </span>
                  ))}
                  {icpAtual.criterios.every((c) => !c.marcado) && (
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      Nenhum criterio marcado
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setChecklistIcpAberto(true)}
                  className="mt-3 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Abrir checklist ICP
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {/* Rótulo explícito: um Instagram no cadastro é "Sem site próprio", não "Tem site". */}
              <Selo ok={!oportunidade.tem_site}
                texto={oportunidade.situacao_site === 'nao_identificado'
                  ? 'Verificar link'
                  : oportunidade.tem_site ? 'Tem site próprio' : 'Sem site próprio'} />
              <Selo ok={(oportunidade.avaliacoes ?? 0) >= 50}
                texto={`${oportunidade.avaliacoes ?? 0} avaliações`} />
              <Selo ok={(oportunidade.rating ?? 0) >= 4}
                texto={oportunidade.rating != null ? `Nota ${Number(oportunidade.rating).toFixed(1)}` : 'Sem nota'} />
              <Selo ok={(oportunidade.score_cadastro ?? 100) <= 40}
                texto={`Cadastro ${oportunidade.score_cadastro ?? 0}/100`} />
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-3">
              <button onClick={() => setChecklistIcpAberto(true)} disabled={decidindo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                <IconCheck /> Marcar lead
              </button>
              <button onClick={() => decidir('descartado')} disabled={decidindo}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <IconTrash /> Descartar
              </button>
            </div>

            {checklistIcpAberto && (
              <ModalChecklistIcp
                oportunidade={oportunidade}
                icpAtual={icpAtual}
                respostasIcp={respostasIcp}
                setRespostasIcp={setRespostasIcp}
                observacaoIcp={observacaoIcp}
                setObservacaoIcp={setObservacaoIcp}
                decidindo={decidindo}
                onCancelar={() => setChecklistIcpAberto(false)}
                onConfirmar={() => decidir('aprovado')}
              />
            )}
          </div>
        )}

        {!carregando && !oportunidade && (concluida || semCandidatos) && (
          <div className="space-y-3 rounded-xl border border-dashed px-4 py-6 text-center">
            <p className="text-sm text-slate-600">
              {dados?.mensagem || 'Nada mais para analisar por aqui.'}
            </p>
            <p className="text-xs text-slate-400">
              {aprovados} aprovado(s) · {sessao?.descartados ?? 0} descartado(s) nesta sessão.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {semCandidatos && dados?.ampliar_disponivel && (
                <button onClick={() => acao('ampliar')} disabled={decidindo}
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {decidindo && <Spinner />} Ampliar a busca
                </button>
              )}
              <button onClick={() => acao('encerrar')} disabled={decidindo}
                className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {concluida ? 'Voltar para a busca' : 'Encerrar sessão'}
              </button>
            </div>
          </div>
        )}

        {(dados?.historico?.length || 0) > 0 && (
          <div className="border-t pt-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Sessões anteriores</p>
            <ul className="mt-1.5 space-y-1">
              {dados!.historico!.slice(0, 3).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">
                    {h.nicho ? `${h.nicho}${h.cidade ? ` · ${h.cidade}` : ''}` : 'Carteira inteira'}
                  </span>
                  <span className="shrink-0">
                    {h.aprovados} aprovados · {quando(h.criado_em)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// Selo neutro: verde quando o sinal é bom PARA A VENDA (ex.: não ter site é bom sinal
// de oportunidade, não defeito do lead).
function Selo({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span className={`rounded-lg px-2 py-1 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
      {texto}
    </span>
  )
}

function SeloIcp({ faixa, score }: { faixa: string; score: number | null }) {
  const selo = seloIcp(faixa, score)
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${selo.classe}`}
      title={`${selo.rotulo}: ${selo.descricao}`}
    >
      {selo.rotulo}{selo.score != null ? ` · ${selo.score}/13` : ''}
    </span>
  )
}

function ModalChecklistIcp({
  oportunidade,
  icpAtual,
  respostasIcp,
  setRespostasIcp,
  observacaoIcp,
  setObservacaoIcp,
  decidindo,
  onCancelar,
  onConfirmar,
}: {
  oportunidade: Oportunidade
  icpAtual: ReturnType<typeof calcularIcp>
  respostasIcp: Record<string, boolean>
  setRespostasIcp: Dispatch<SetStateAction<Record<string, boolean>>>
  observacaoIcp: string
  setObservacaoIcp: (valor: string) => void
  decidindo: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Checklist ICP do lead"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Marcar lead</p>
            <h4 className="mt-0.5 truncate text-base font-semibold text-slate-900">{oportunidade.nome}</h4>
            <p className="mt-1 text-xs text-slate-500">
              Valide o ICP antes de colocar o lead na carteira. Esta pontuacao define Lead A/B/C e influencia prioridade.
            </p>
          </div>
          <SeloIcp faixa={icpAtual.faixa} score={icpAtual.score} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {icpAtual.criterios.map((c) => {
            const auto = oportunidade.icp?.sinais_auto?.[c.id]
            return (
              <label
                key={c.id}
                className={`flex min-h-[72px] items-start gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                  respostasIcp[c.id] ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!respostasIcp[c.id]}
                  onChange={(e) => setRespostasIcp((r) => ({ ...r, [c.id]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-800">{c.rotulo}</span>
                  <span className="ml-1 text-slate-400">+{c.pontos}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {auto?.sugerido ? 'Sinal automatico encontrado.' : 'Marque quando voce validar esse criterio.'}
                  </span>
                  {auto?.motivo && <span className="mt-0.5 block text-[11px] text-slate-400">{auto.motivo}</span>}
                </span>
              </label>
            )
          })}
        </div>

        <textarea
          value={observacaoIcp}
          onChange={(e) => setObservacaoIcp(e.target.value)}
          placeholder="Observacao opcional: por que esse lead e bom, medio ou fraco?"
          className="mt-3 min-h-[72px] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        />

        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Cadastro preenchido ajuda a encontrar contato. ICP mede chance comercial.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelar}
              disabled={decidindo}
              className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              disabled={decidindo}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {decidindo ? <Spinner /> : <IconCheck />} Confirmar e marcar lead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
