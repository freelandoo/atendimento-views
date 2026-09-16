'use client'
// Detalhes do lead — destino declarado dos campos que saíram das tabelas operacionais.
//
// Por que existe: Aquisição e Banco de Leads carregavam 14 colunas cada, e duas delas eram
// dado TÉCNICO numa tela de trabalho (o botão `{ }` de JSON cru). A regra desta mudança é que
// nada sai da tabela sem destino: avaliação, nota, horário e endereço passaram a viver aqui e
// no tooltip da bolinha, e o JSON deixou de ser uma coluna para virar um botão DENTRO dos
// detalhes — o `JsonLeadModal` continua existindo porque carrega o prompt unificado, que é
// ferramenta de trabalho real.
//
// Um único componente serve as duas telas de propósito: eram elas que já duplicavam colunas,
// pontuação e JSON. Os campos ausentes simplesmente não aparecem — perfil de Instagram não
// tem endereço nem nota, e uma linha "—" para cada um só encheria a tela.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import JsonLeadModal, { type JsonApresentacao, type CriterioApresentacao } from '@/components/ui/JsonLeadModal'
import BolinhaPontuacao from '@/components/ui/BolinhaPontuacao'
import NichoCidade from '@/components/ui/NichoCidade'
import { rotuloLink, tituloLinkNaoSite } from '@/lib/site-rotulos'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import {
  VARIANTES, O_QUE_MEDE, NOTA_COMPLETUDE, fatoresDeCadastro, leituraCadastro,
} from '@/lib/pontuacao-indicador'
import {
  CRITERIOS_ICP_TENKA,
  calcularIcp,
  respostasIniciaisIcp,
  resumoIcpDoLead,
  resumoIcpOperacional,
  seloIcp,
  sinaisAutomaticosDoLead,
} from '@/lib/lead-icp'

type JsonApresLead = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}
type CriterioIcp = { id: string; rotulo: string; pontos: number; marcado?: boolean; pontos_obtidos?: number }
type ResumoIcp = {
  score: number | null
  score_maximo: number
  faixa: string
  criterios: CriterioIcp[]
  sinais_auto: Record<string, { sugerido?: boolean; motivo?: string }>
  motivos: string[]
  avaliado_em: string | null
}
type IcpPayload = { respostas: Record<string, boolean>; observacao?: string }
type SinalIcp = { sugerido?: boolean; motivo?: string }

/** O mínimo que as duas telas têm em comum. Tudo é opcional: origens diferentes, campos diferentes. */
export type LeadDetalhavel = {
  id: string
  nome: string
  origem?: string
  telefone?: string | null
  email?: string | null
  nicho?: string | null
  cidade?: string | null
  endereco?: string | null
  rating?: number | null
  avaliacoes?: number | null
  seguidores?: number | null
  instagram_handle?: string | null
  bio?: string | null
  tem_site?: boolean | null
  site?: string | null
  link_original?: string | null
  link_bio?: string | null
  classificacao_url?: string | null
  /** Veredito de 3 estados do backend. É ele que a bolinha de cadastro passou a dizer. */
  situacao_site?: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  maps_url?: string | null
  score_cadastro?: number | null
  score_cadastro_max?: number | null
  score_cadastro_criterios?: CriterioApresentacao[] | null
  json_apresentacao?: JsonApresLead | null
  /** Rascunho já preparado (Manual/Semi/Automático escrevem no mesmo lugar — texto único). */
  mensagem_gerada?: string | null
  icp_score?: number | null
  icp_faixa?: string | null
  icp_avaliado_em?: string | null
  icp_resumo_json?: {
    score?: number
    score_maximo?: number
    faixa?: string
    criterios?: { id: string; rotulo: string; pontos: number; marcado?: boolean; pontos_obtidos?: number }[]
    sinais_auto?: Record<string, { sugerido?: boolean; motivo?: string }>
    motivos?: string[]
  } | null
}

/**
 * Critérios da completude. A Aquisição recebe `score_cadastro_criterios` direto na listagem; o
 * Banco de Leads recebe os mesmos critérios dentro de `json_apresentacao.pontuacao`. Mesma
 * função do backend nos dois casos — aqui só se escolhe por qual porta eles chegaram.
 */
export function criteriosDoLead(l: LeadDetalhavel): CriterioApresentacao[] {
  if (Array.isArray(l.score_cadastro_criterios) && l.score_cadastro_criterios.length) return l.score_cadastro_criterios
  const doJson = l.json_apresentacao?.pontuacao?.criterios
  return Array.isArray(doJson) ? doJson : []
}

/** Teto da escala: Places 100, Instagram 60. Nunca assumido — vem do backend. */
export function maximoDoLead(l: LeadDetalhavel): number {
  const m = l.score_cadastro_max ?? l.json_apresentacao?.pontuacao?.maximo
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 100
}

/**
 * Bolinha de COMPLETUDE pronta para as tabelas — o mesmo veredito nas duas telas.
 *
 * A coluna "Site" saiu da Aquisição e do Banco de Leads (decisão do operador em 2026-08-10):
 * a situação do site passou a ser lida DENTRO desta pontuação, onde ela já valia 20 dos 100
 * pontos. Por isso o contexto de site é passado ao tradutor de fatores — sem ele, o balão
 * diria só "Tem site próprio ✗", que não distingue "não tem" (a oportunidade) de "ninguém
 * verificou". O LINK continua clicável em "Detalhes": balão de hover é `pointer-events-none`,
 * e link dentro dele seria inalcançável.
 */
export function BolinhaCadastro({ l }: { l: LeadDetalhavel }) {
  const maximo = maximoDoLead(l)
  const criterios = criteriosDoLead(l)
  const leitura = leituraCadastro(l.score_cadastro, maximo, criterios)
  const instagram = l.origem === 'instagram' || l.origem === 'linkedin' || maximo === 60
  return (
    <BolinhaPontuacao
      valor={l.score_cadastro}
      maximo={maximo}
      faixa={leitura.faixa}
      titulo={leitura.titulo}
      oQueMede={instagram ? O_QUE_MEDE.cadastro_instagram : O_QUE_MEDE.cadastro_places}
      fatores={fatoresDeCadastro(criterios, {
        situacaoSite: l.situacao_site,
        rotuloLink: rotuloLink(l.classificacao_url),
      })}
      nota={NOTA_COMPLETUDE}
      variante={VARIANTES.COMPLETUDE}
      rotuloSemValor="Cadastro não avaliado"
    />
  )
}

export function BolinhaIcp({ l }: { l: LeadDetalhavel }) {
  const resumo = resumoIcpOperacional(l) as ResumoIcp & { origem?: string }
  const selo = seloIcp(resumo.faixa, resumo.score)
  const criterios = Array.isArray(resumo.criterios) ? resumo.criterios : []
  const marcados = criterios
    .filter((c) => c.marcado)
    .map((c) => `${c.rotulo} +${c.pontos}`)
    .join('; ')
  const prefixo = resumo.origem === 'previsao' ? 'Previa automatica ICP' : 'ICP salvo'
  const title = `${prefixo}: ${selo.rotulo}: ${selo.descricao}${selo.score != null ? ` (${selo.score}/13)` : ''}${marcados ? ` — ${marcados}` : ''}`
  return (
    <span
      tabIndex={0}
      title={title}
      aria-label={title}
      className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold transition hover:scale-105 ${selo.classeBolinha || selo.classe}`}
      >
        {selo.score == null ? '—' : selo.score}
      </span>
    </span>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <dt className="w-32 shrink-0 text-xs text-slate-500">{rotulo}</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-800">{children}</dd>
    </div>
  )
}

export default function LeadDetalhesModal({ lead, onFechar, instanciaDesconectada = false, empresaId, onLeadAtualizado }: {
  lead: LeadDetalhavel
  onFechar: () => void
  empresaId?: string
  onLeadAtualizado?: (lead: LeadDetalhavel) => void
  /** A instância de envio selecionada na tela está desconectada — só muda o AVISO ao lado do
      botão Copiar (a mensagem, quando existe, sempre pode ser copiada). */
  instanciaDesconectada?: boolean
}) {
  const [jsonAberto, setJsonAberto] = useState(false)
  const [respostasIcp, setRespostasIcp] = useState<Record<string, boolean>>({})
  const [observacaoIcp, setObservacaoIcp] = useState('')
  const [salvandoIcp, setSalvandoIcp] = useState(false)
  const fb = useFeedback()
  const emp = lead.json_apresentacao?.empresa
  const horario = emp?.horario_funcionamento
  const fotos = emp?.fotos
  const criterios = criteriosDoLead(lead)
  const maximo = maximoDoLead(lead)
  const handle = (lead.instagram_handle || '').replace(/^@/, '')
  const icp = resumoIcpDoLead(lead) as ResumoIcp
  const selo = seloIcp(icp.faixa, icp.score)
  const sinaisAuto = useMemo(
    () => ({ ...sinaisAutomaticosDoLead(lead), ...(icp.sinais_auto || {}) }) as Record<string, SinalIcp>,
    [lead, icp.sinais_auto]
  )
  const icpEditado = useMemo(() => calcularIcp(respostasIcp), [respostasIcp])
  const seloEditado = seloIcp(icpEditado.faixa, icpEditado.score)

  useEffect(() => {
    setRespostasIcp(respostasIniciaisIcp(lead) as Record<string, boolean>)
    setObservacaoIcp('')
  }, [lead.id, lead.icp_avaliado_em, lead.icp_score])

  async function salvarIcp() {
    if (!empresaId) {
      fb.toast('Abra este lead pelo Banco de Leads para salvar o ICP.', 'error')
      return
    }
    setSalvandoIcp(true)
    try {
      const payload: IcpPayload = { respostas: respostasIcp, observacao: observacaoIcp }
      const r = await apiFetch<LeadDetalhavel>(`/api/empresas/${empresaId}/banco-leads/leads/${lead.id}/icp`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      onLeadAtualizado?.(r.data)
      const s = seloIcp(r.data.icp_faixa || r.data.icp_resumo_json?.faixa, r.data.icp_score ?? r.data.icp_resumo_json?.score ?? null)
      fb.toast(`ICP salvo: ${s.rotulo}${s.score != null ? ` (${s.score}/13)` : ''}.`, 'success')
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Erro ao salvar ICP.', 'error')
    } finally {
      setSalvandoIcp(false)
    }
  }

  async function copiarMensagem() {
    if (!lead.mensagem_gerada) return
    try {
      await navigator.clipboard.writeText(lead.mensagem_gerada)
      fb.toast('Mensagem copiada.')
    } catch {
      fb.toast('Não foi possível copiar automaticamente. Selecione o texto manualmente.', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes de ${lead.nome}`}
          className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{lead.nome || '—'}</h3>
              <NichoCidade nicho={lead.nicho} cidade={lead.cidade} className="text-xs" vazio="Sem mercado informado" />
            </div>
            <button onClick={onFechar} aria-label="Fechar detalhes" className="text-lg leading-none text-slate-400 hover:text-slate-600">×</button>
          </div>

          {/* Pontuação: a MESMA bolinha da tabela, com os critérios abertos em lista — no
              tooltip eles são um resumo; aqui dá para conferir item a item. */}
          <div className="rounded-xl border bg-slate-50 px-3 py-3">
            <div className="flex items-center gap-3">
              <BolinhaCadastro l={lead} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{leituraCadastro(lead.score_cadastro, maximo, criterios).titulo}</div>
                <div className="text-xs text-slate-500">{NOTA_COMPLETUDE}</div>
              </div>
            </div>
            {criterios.length > 0 && (
              <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {criterios.map((c, i) => (
                  <li key={c.chave || i} className={`flex items-center gap-1.5 text-xs ${c.ok ? 'text-slate-700' : 'text-slate-400'}`}>
                    <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>
                    <span>{c.label}</span>
                    {!c.ok && <span className="text-[10px] text-slate-400">(+{c.pontos_possiveis ?? 0})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <BolinhaIcp l={{ ...lead, icp_score: icpEditado.score, icp_faixa: icpEditado.faixa, icp_resumo_json: { ...lead.icp_resumo_json, ...icpEditado } }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ICP Tenka v1.1</p>
                  <p className="mt-0.5 text-xs text-slate-500">Termômetro comercial: frio, morno ou quente.</p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${seloEditado.classe}`} title={seloEditado.descricao}>
                {seloEditado.rotulo}{seloEditado.score != null ? ` · ${seloEditado.score}/13` : ''}
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Automático</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-3">
                {Object.entries(sinaisAuto).map(([id, sinal]) => {
                  const criterio = CRITERIOS_ICP_TENKA.find((c) => c.id === id)
                  if (!criterio) return null
                  return (
                    <div
                      key={id}
                      title={`${criterio.explicacao || criterio.rotulo}${criterio.exemplo ? ` Exemplo: ${criterio.exemplo}` : ''}`}
                      className={`rounded-lg px-2 py-1 text-[11px] ${sinal?.sugerido ? 'bg-white text-slate-700' : 'bg-slate-100 text-slate-400'}`}
                    >
                      <span className="font-medium">{criterio.rotulo}</span>
                      <span className="ml-1">{sinal?.sugerido ? 'detectado' : 'não detectado'}</span>
                      {sinal?.motivo && <span className="mt-0.5 block text-[10px] opacity-75">{sinal.motivo}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Validação humana</p>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {icpEditado.criterios.map((c) => {
                  const auto = sinaisAuto[c.id]
                  const humano = c.tipo !== 'automatico'
                  const criterioDoc = CRITERIOS_ICP_TENKA.find((item) => item.id === c.id) || c
                  return (
                    <label
                      key={c.id}
                      title={`${criterioDoc.explicacao || c.rotulo}${criterioDoc.exemplo ? ` Exemplo: ${criterioDoc.exemplo}` : ''}`}
                      className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-xs ${respostasIcp[c.id] ? 'border-orange-200 bg-orange-50/60 text-slate-800' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!respostasIcp[c.id]}
                        onChange={(e) => setRespostasIcp((r) => ({ ...r, [c.id]: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{c.rotulo}</span>
                        <span className="ml-1 text-slate-400">+{c.pontos}</span>
                        <span className="ml-1 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {humano ? (auto?.sugerido ? 'auto + humano' : 'humano') : 'automático'}
                        </span>
                        {criterioDoc.explicacao && <span className="mt-0.5 block text-[11px] text-slate-500">{criterioDoc.explicacao}</span>}
                        {auto?.motivo && <span className="block text-[11px] text-slate-400">{auto.motivo}</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
              <textarea
                value={observacaoIcp}
                onChange={(e) => setObservacaoIcp(e.target.value)}
                placeholder="Observação opcional sobre o fit comercial"
                className="mt-2 min-h-[58px] w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Ao salvar Lead A, o lead fica marcado/qualificado automaticamente.
                </p>
                <button
                  type="button"
                  onClick={salvarIcp}
                  disabled={salvandoIcp}
                  className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {salvandoIcp ? 'Salvando...' : 'Salvar ICP'}
                </button>
              </div>
            </div>
          </div>

          {/* Mensagem já preparada (Manual/Semi/Automático escrevem no mesmo rascunho — texto
              único reaproveitado pelos três). O botão de copiar existe para o caso em que a
              instância de envio está desconectada: a mensagem já foi gerada e não precisa
              esperar a conexão voltar para ser aproveitada manualmente. */}
          {lead.mensagem_gerada && (
            <div className="rounded-xl border bg-amber-50/60 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">Mensagem gerada</p>
                <button
                  type="button"
                  onClick={copiarMensagem}
                  className="shrink-0 rounded-lg border bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Copiar
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs text-slate-700">{lead.mensagem_gerada}</p>
              {instanciaDesconectada && (
                <p className="text-[11px] text-amber-700">
                  Instância desconectada — copie e envie manualmente pelo WhatsApp enquanto ela não volta.
                </p>
              )}
            </div>
          )}

          {/* Dados complementares: é para cá que vieram Endereço, Nota, Avaliações e Horário
              quando saíram das colunas da tabela. */}
          <dl className="divide-y">
            {lead.telefone && <Linha rotulo="Telefone"><span className="font-mono text-xs">{lead.telefone}</span></Linha>}
            {lead.email && <Linha rotulo="E-mail"><span className="text-xs">{lead.email}</span></Linha>}
            {lead.endereco && <Linha rotulo="Endereço"><span className="text-xs">{lead.endereco}</span></Linha>}
            {(lead.rating != null || lead.avaliacoes != null) && (
              <Linha rotulo="Reputação">
                <span className="text-xs">
                  {lead.rating != null ? `Nota ${Number(lead.rating).toFixed(1)}` : 'Sem nota'}
                  {' · '}
                  {lead.avaliacoes != null ? `${lead.avaliacoes} avaliações` : 'sem avaliações'}
                </span>
              </Linha>
            )}
            {horario != null && (
              <Linha rotulo="Horário"><span className="text-xs">{horario ? 'Cadastrado no Google' : 'Não cadastrado'}</span></Linha>
            )}
            {fotos != null && <Linha rotulo="Fotos"><span className="text-xs">{fotos}</span></Linha>}
            {lead.seguidores != null && (
              <Linha rotulo="Seguidores"><span className="text-xs">{lead.seguidores.toLocaleString('pt-BR')}</span></Linha>
            )}
            {handle && (
              <Linha rotulo="@username">
                <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">@{handle}</a>
              </Linha>
            )}
            {/* O link não-site continua acessível, dito pelo que ele é — nunca como "site". */}
            <Linha rotulo="Presença digital">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {lead.tem_site && lead.site && (
                  <a href={lead.site} target="_blank" rel="noreferrer" className="text-brand hover:underline">site próprio ↗</a>
                )}
                {!lead.tem_site && lead.link_original && (
                  <a href={lead.link_original} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline"
                    title={tituloLinkNaoSite(lead.classificacao_url, lead.link_original)}>
                    {rotuloLink(lead.classificacao_url) || 'link'} ↗
                  </a>
                )}
                {lead.link_bio && (
                  <a href={lead.link_bio} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">link da bio ↗</a>
                )}
                {lead.maps_url && (
                  <a href={lead.maps_url} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">ficha no Maps ↗</a>
                )}
                {!lead.site && !lead.link_original && !lead.link_bio && !lead.maps_url && <span className="text-slate-400">Nenhum link</span>}
              </div>
            </Linha>
            {lead.bio && <Linha rotulo="Bio"><span className="text-xs text-slate-600">{lead.bio}</span></Linha>}
          </dl>

          {/* O JSON saiu da tabela e vive aqui: continua a um clique de quem precisa dele,
              sem ocupar uma coluna da tela de trabalho. */}
          {lead.json_apresentacao && (
            <div className="flex justify-end border-t pt-3">
              <button
                onClick={() => setJsonAberto(true)}
                className="rounded-lg border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                title="Dados unificados + prompt único pro bot gerar a saudação de análise"
              >
                Ver dados completos
              </button>
            </div>
          )}
        </div>
      </div>
      {jsonAberto && lead.json_apresentacao && (
        <JsonLeadModal titulo={lead.nome} json={lead.json_apresentacao} onFechar={() => setJsonAberto(false)} />
      )}
    </>
  )
}
