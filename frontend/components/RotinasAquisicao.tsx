'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconTrash, IconPlay, IconSparkle } from '@/components/ui/icons'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import AssistenteOportunidades from '@/components/AssistenteOportunidades'
import AssistenteEntrada from '@/components/AssistenteEntrada'
import SeletorLocalidade from '@/components/SeletorLocalidade'
import type { Mercado } from '@/lib/assistente-entrada'
import RotinaCampos, {
  Campo,
  QUANTIDADE_MAX,
  INTERVALO_MIN,
  RASCUNHO_VAZIO,
  resumoDias,
  type Rascunho,
} from '@/components/RotinaCampos'
// O histórico das coletas saiu daqui: agora é consulta secundária, exibida em
// "Acompanhar resultados" (abaixo da lista de leads) pela página de Aquisição.
import type { Atividade } from '@/components/HistoricoColetas'

// Rotinas de Aquisição: cada rotina é um mercado (nicho + cidade + UF) com agenda
// própria. A tela fala a língua do operador — nada de snapshot, dataset ou webhook.
//
// A página de Aquisição tem dois MODOS (Busca / Rotinas) e este componente renderiza o
// card de um deles por vez, conforme a prop `modo`. Ele fica SEMPRE montado: é o que
// preserva o formulário da busca avulsa e o polling ao alternar de modo. Desmontar por
// modo reiniciaria o formulário — exatamente o que a separação não pode causar.
export type ModoAquisicao = 'busca' | 'rotinas'
export type FonteBuscaAquisicao = 'places' | 'meta_ads'

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
export type ColetaEmVoo = {
  nicho: string | null
  cidade: string | null
  origem: string | null
  /** false = a reserva foi gravada e o disparo pago ainda nao completou (expira em minutos). */
  disparada: boolean
  desde: string
  idade_min: number
  expira_em_min: number
}
export type RotinasResp = {
  rotinas: Rotina[]
  atividade: Atividade[]
  coleta_em_andamento: boolean
  coleta: ColetaEmVoo | null
  limites: { quantidade_min: number; quantidade_max: number; intervalo_min_horas: number }
}
type MetaAdsResultado = {
  ok: boolean
  registros?: number
  salvos?: { id: string; inserido?: boolean }[]
  descartados?: Record<string, number>
}

/**
 * O relogio da coleta em voo.
 *
 * Existe porque "uma coleta esta em andamento" + spinner e' indistinguivel de travamento. Uma
 * coleta do Maps pode levar 40 min legitimamente, e o worker so' desiste com 3h — sem os dois
 * numeros, o operador fica olhando um giro sem saber se espera ou se pede socorro. Os prazos vem
 * do BACKEND (as mesmas constantes que o worker aplica), nunca recalculados aqui.
 */
function ColetaEmAndamento({ coleta }: { coleta: ColetaEmVoo | null }) {
  if (!coleta) return null
  const mercado = [coleta.nicho, coleta.cidade].filter(Boolean).join(' em ')
  const ha = coleta.idade_min < 1 ? 'agora há pouco' : `há ${coleta.idade_min} min`
  return (
    <div className="flex items-start gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
      <Spinner />
      <div className="space-y-0.5">
        <p>
          <b>Coletando{mercado ? ` ${mercado}` : ''}</b> — começou {ha}.
          {' '}As outras buscas entram na fila e rodam em seguida.
        </p>
        <p className="text-xs text-cyan-800">
          {coleta.disparada
            ? `Coletas grandes levam dezenas de minutos. Se não terminar em ${coleta.expira_em_min} min, o sistema desiste sozinho e libera a busca.`
            : `Ainda confirmando o início da coleta. Se não confirmar em ${coleta.expira_em_min} min, a reserva é liberada automaticamente.`}
        </p>
      </div>
    </div>
  )
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
function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function RotinasAquisicao({
  empresaId,
  modo,
  fonteBusca = 'places',
  onColetaIniciada,
  onDados,
  onLeadsAlterados,
}: {
  empresaId: string
  // Qual card aparece. Só um por vez — os dois juntos era a densidade que a separação resolve.
  modo: ModoAquisicao
  // Fonte da busca avulsa quando esta tela está embutida em Aquisição.
  fonteBusca?: FonteBuscaAquisicao
  onColetaIniciada?: () => void
  // Cada decisão do assistente muda o status de um lead: a lista da página recarrega.
  onLeadsAlterados?: () => void
  // Publica as rotinas já carregadas para quem precisa delas na mesma tela (o histórico
  // de coletas), em vez de repetir a mesma requisição.
  onDados?: (dados: RotinasResp) => void
}) {
  const [dados, setDados] = useState<RotinasResp | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [agindo, setAgindo] = useState<string | null>(null)
  const [confirmarRemocao, setConfirmarRemocao] = useState<Rotina | null>(null)
  const [erro, setErro] = useState('')
  const [avulsa, setAvulsa] = useState({ nicho: '', cidade: '', uf: '', quantidade: QUANTIDADE_MAX })
  const [buscandoAvulsa, setBuscandoAvulsa] = useState(false)
  // Assistente de Oportunidades. Só abre no clique — a análise NUNCA começa sozinha
  // depois de uma busca. O clique cai primeiro no menu guiado (`entrada`), que decide
  // entre revisar o que já existe ou procurar mais; só "revisar" abre a sessão.
  const [entradaAberta, setEntradaAberta] = useState(false)
  const [assistenteAberto, setAssistenteAberto] = useState(false)
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

  useEffect(() => { carregar() }, [carregar])
  // A coleta é assíncrona (leva minutos): o painel se atualiza sozinho.
  useEffect(() => {
    const t = setInterval(carregar, 20000)
    return () => clearInterval(t)
  }, [carregar])

  const rotinas = dados?.rotinas || []
  const limites = dados?.limites || { quantidade_min: 1, quantidade_max: QUANTIDADE_MAX, intervalo_min_horas: INTERVALO_MIN }
  const metaAds = fonteBusca === 'meta_ads'

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
    setAgindo(r.id)
    try {
      const resp = await apiFetch<RotinasResp>(`${base}/${r.id}`, { method: 'DELETE' })
      setDados(resp.data)
      fb.toast('Rotina removida.', 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover a rotina.')
    } finally { setAgindo(null) }
  }

  // Disparo único da coleta. É o MESMO caminho para o botão "Buscar agora" e para a busca
  // guiada do assistente — nenhum motor de busca é duplicado. Propaga o erro para quem
  // chamou decidir como mostrá-lo.
  const dispararBusca = useCallback(async (destino: Mercado) => {
    await apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
      method: 'POST',
      body: JSON.stringify({
        nicho: destino.nicho.trim(),
        cidade: destino.cidade.trim(),
        uf: destino.uf.trim().toUpperCase() || null,
        quantidade: avulsa.quantidade,
      }),
    })
    carregar()
    onColetaIniciada?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, avulsa.quantidade, carregar])

  async function buscarAgora() {
    if (!avulsa.nicho.trim() || (!metaAds && !avulsa.cidade.trim())) {
      setErro(metaAds ? 'Informe o termo do anúncio para buscar na Meta.' : 'Informe nicho e cidade para a busca avulsa.')
      return
    }
    setErro('')
    setBuscandoAvulsa(true)
    try {
      if (metaAds) {
        const r = await apiFetch<MetaAdsResultado>(`/api/empresas/${empresaId}/prospeccao/meta-ads/buscar`, {
          method: 'POST',
          body: JSON.stringify({
            nicho: avulsa.nicho.trim(),
            cidade: avulsa.cidade.trim() || null,
            uf: avulsa.uf.trim().toUpperCase() || null,
            quantidade: avulsa.quantidade,
          }),
          timeoutMs: 180000,
        })
        const salvos = r.data?.salvos?.length ?? 0
        const registros = r.data?.registros ?? 0
        fb.toast(`Busca Meta concluída: ${salvos} lead${salvos === 1 ? '' : 's'} salvo${salvos === 1 ? '' : 's'} de ${registros} anúncio${registros === 1 ? '' : 's'} analisado${registros === 1 ? '' : 's'}.`, salvos > 0 ? 'success' : 'info')
        onLeadsAlterados?.()
      } else {
        await dispararBusca(avulsa)
        fb.toast('Busca iniciada. Os leads aparecem em alguns minutos — a lista atualiza sozinha.', 'info')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao iniciar a busca.')
    } finally { setBuscandoAvulsa(false) }
  }

  // Busca disparada de dentro do assistente: o contexto da Busca avulsa passa a ser o
  // mercado escolhido, para a tela continuar coerente com o que foi pedido.
  async function buscarPeloAssistente(destino: Mercado) {
    await dispararBusca(destino)
    setAvulsa((a) => ({ ...a, nicho: destino.nicho, cidade: destino.cidade, uf: destino.uf }))
    fb.toast('Busca iniciada. Os leads aparecem em alguns minutos — a lista atualiza sozinha.', 'info')
  }

  return (
    <div className="space-y-4">
      {modo === 'rotinas' && (
        <div className="painel-troca space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
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

          {dados?.coleta_em_andamento && <ColetaEmAndamento coleta={dados?.coleta ?? null} />}

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
                      <button onClick={() => setConfirmarRemocao(r)} disabled={agindo === r.id}
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
      )}

      {modo === 'busca' && (
        <div className="painel-troca space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">
              {metaAds ? 'Busca Meta' : 'Busca avulsa'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {metaAds
                ? 'Busque pelo termo do anúncio. Cidade e estado não são obrigatórios nesta fonte.'
                : 'Uma coleta única, agora, sem criar rotina.'}
            </p>
          </div>
          <div className={`grid gap-3 sm:grid-cols-2 ${metaAds ? 'lg:grid-cols-[minmax(0,1fr)_220px]' : 'lg:grid-cols-4'}`}>
            <Campo label={metaAds ? 'Termo do anúncio' : 'Nicho'}>
              <input value={avulsa.nicho} placeholder={metaAds ? 'ex: energia solar, estética, restaurante japonês' : 'ex: dentista'}
                onChange={(e) => setAvulsa({ ...avulsa, nicho: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm" />
            </Campo>
            {!metaAds && (
              <SeletorLocalidade
                cidade={avulsa.cidade}
                uf={avulsa.uf}
                onChange={(local) => setAvulsa({ ...avulsa, cidade: local.cidade, uf: local.uf })}
                className="sm:col-span-2 lg:col-span-2"
                rotuloUf="Estado"
                rotuloCidade="Cidade"
              />
            )}
            <Campo label={metaAds ? 'Máx. de anúncios analisados' : `Máx. de leads novos (1 a ${limites.quantidade_max})`}>
              <input type="number" min={limites.quantidade_min} max={limites.quantidade_max} value={avulsa.quantidade}
                title={metaAds
                  ? 'Limite de anúncios lidos na Biblioteca. Só viram lead os anunciantes sem site próprio no anúncio.'
                  : 'Vale para os dois botões: quantos leads esta busca importa e, no assistente, quantos você quer aprovar. A origem pode encontrar mais registros do que isso.'}
                onChange={(e) => setAvulsa({ ...avulsa, quantidade: Number(e.target.value) || limites.quantidade_max })}
                className="w-full rounded-lg border px-3 py-2 text-sm" />
            </Campo>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={buscarAgora} disabled={buscandoAvulsa || (fonteBusca !== 'meta_ads' && dados?.coleta_em_andamento)}
              title={dados?.coleta_em_andamento && fonteBusca !== 'meta_ads' ? 'Aguarde a coleta em andamento terminar.' : undefined}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {buscandoAvulsa ? <Spinner /> : <IconPlay />}
              {buscandoAvulsa
                ? (fonteBusca === 'meta_ads' ? 'Buscando…' : 'Iniciando…')
                : (fonteBusca === 'meta_ads' ? 'Buscar anúncios' : 'Buscar agora')}
            </button>
            {/* Gatilho MANUAL da análise: buscar não analisa, analisar não busca. Continua
                clicável mesmo vazio (também serve para revisar leads já encontrados), mas só
                ganha destaque visual — de forma suave — quando o operador começa a preencher
                nicho ou estado, para não competir de igual para igual com "Buscar agora". */}
            {fonteBusca !== 'meta_ads' && <button onClick={() => setEntradaAberta(true)} disabled={entradaAberta || assistenteAberto}
              title="Revisa os leads que ainda não foram decididos, um por vez, com uma explicação curta."
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-all duration-300 disabled:opacity-50 ${
                avulsa.nicho.trim() || avulsa.uf
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600'
                  : 'border bg-white text-slate-500 hover:bg-slate-50'
              }`}>
              <IconSparkle /> Analisar oportunidades
            </button>}
          </div>
          {/* A coleta em andamento é global (uma por empresa): quem está no modo Busca
              precisa saber por que o botão está desabilitado sem ir até as Rotinas. */}
          {dados?.coleta_em_andamento && <ColetaEmAndamento coleta={dados?.coleta ?? null} />}
          <p className="text-xs text-slate-500">
            {metaAds ? (
              <>
                <b>Buscar anúncios</b> traz anunciantes ativos para a carteira e enfileira o enriquecimento da página do Facebook em segundo plano.
              </>
            ) : (
              <>
                <b>Buscar agora</b> traz leads novos para a sua carteira. <b>Analisar oportunidades</b> abre o
                assistente: ele pergunta se você quer revisar o que já foi encontrado — um lead por vez, com o
                motivo — ou procurar em outro nicho ou cidade.
              </>
            )}
          </p>
        </div>
      )}

      {/* Um único bloco de erro, FORA dos cards: o mesmo estado é escrito pela rotina e
          pela busca avulsa, e precisa aparecer no modo em que o operador está. */}
      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {entradaAberta && (
        <AssistenteEntrada
          empresaId={empresaId}
          mercado={{ nicho: avulsa.nicho, cidade: avulsa.cidade, uf: avulsa.uf }}
          meta={avulsa.quantidade}
          coletaEmAndamento={!!dados?.coleta_em_andamento}
          onRevisar={() => { setEntradaAberta(false); setAssistenteAberto(true) }}
          onBuscar={buscarPeloAssistente}
          onFechar={() => setEntradaAberta(false)}
        />
      )}

      {assistenteAberto && (
        <AssistenteOportunidades
          empresaId={empresaId}
          mercado={{ nicho: avulsa.nicho, cidade: avulsa.cidade, uf: avulsa.uf }}
          meta={avulsa.quantidade}
          onFechar={() => setAssistenteAberto(false)}
          onLeadsAlterados={onLeadsAlterados}
        />
      )}

      {confirmarRemocao && (
        <ModalConfirmar
          titulo="Remover rotina"
          corpo={`Remover a rotina "${confirmarRemocao.nicho} · ${confirmarRemocao.localizacao || confirmarRemocao.cidade}"?`}
          aviso="Ela deixa de coletar. Os leads já encontrados continuam no Banco de Leads."
          rotuloConfirmar="Remover"
          tom="perigo"
          ocupado={agindo === confirmarRemocao.id}
          onConfirmar={() => { const r = confirmarRemocao; setConfirmarRemocao(null); remover(r) }}
          onCancelar={() => setConfirmarRemocao(null)}
        />
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
