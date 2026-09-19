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
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import JsonLeadModal, { type JsonApresentacao, type CriterioApresentacao } from '@/components/ui/JsonLeadModal'
import BolinhaPontuacao from '@/components/ui/BolinhaPontuacao'
import NichoCidade from '@/components/ui/NichoCidade'
import { classesFolha, classesFundoFolha } from '@/lib/ui-primitivos'
import { rotuloLink, tituloLinkNaoSite } from '@/lib/site-rotulos'
// Perfil de Instagram: a tela só desenha o veredito. A prova de vínculo vive no backend.
import {
  acoesDisponiveis, avisoAtividade, avisoIcpSemPerfil, estadoAtividade, estadoInstagram,
  evidencia, rotuloEstado, rotuloOrigem, urlPerfil,
} from '@/lib/instagram-perfil'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import {
  VARIANTES, O_QUE_MEDE, NOTA_COMPLETUDE, fatoresDeCadastro, leituraCadastro,
} from '@/lib/pontuacao-indicador'
import {
  CRITERIOS_ICP_TENKA,
  calcularIcp,
  qualificacaoDoLead,
  respostasIniciaisIcp,
  resumoIcpDoLead,
  resumoIcpOperacional,
  seloIcp,
  seloValidacaoLead,
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
  qualificacao?: QualificacaoResumo | null
  motivos: string[]
  avaliado_em: string | null
}
type IcpPayload = { respostas: Record<string, boolean>; observacao?: string }
type SinalIcp = { sugerido?: boolean; motivo?: string }
type QualificacaoItem = { tipo?: string; chave?: string; rotulo: string; pontos?: number }
type QualificacaoResumo = {
  score_100: number
  faixa?: string
  prioridade?: string
  validacao: string
  confianca?: string
  bloqueios?: QualificacaoItem[]
  penalidades?: QualificacaoItem[]
  revisoes?: QualificacaoItem[]
  sinais?: QualificacaoItem[]
  motivos?: string[]
}
// `pendente` e `salvando` são estados DIFERENTES de propósito: o indicador substituiu o botão
// "Salvar ICP", então ele é a única coisa que responde "e agora, já foi?". Dizer "Salvando…"
// durante a espera do debounce, quando ainda não há requisição alguma, faria o indicador
// afirmar o que não aconteceu — e é justamente a afirmação em que o operador passou a confiar.
type EstadoAutosaveIcp = 'idle' | 'pendente' | 'salvando' | 'salvo' | 'erro' | 'bloqueado'

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
  /** Perfil achado por busca e NÃO provado. Nunca deve ser exibido como o Instagram do lead. */
  instagram_candidato?: string | null
  instagram_origem?: string | null
  instagram_confianca?: string | null
  instagram_evidencia?: { sinais?: { chave: string; rotulo: string; ok: boolean; detalhe: string | null }[] } | null
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
    observacao?: string | null
    criterios?: { id: string; rotulo: string; pontos: number; marcado?: boolean; pontos_obtidos?: number }[]
    sinais_auto?: Record<string, { sugerido?: boolean; motivo?: string }>
    qualificacao?: QualificacaoResumo | null
    motivos?: string[]
  } | null
  qualificacao_resumo?: QualificacaoResumo | null
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
 * Espera antes de gravar, em ms.
 *
 * Não é só conforto de digitação: `PATCH /leads/:id/icp` grava uma linha no histórico
 * append-only (`lead_icp_avaliacoes`) e outra em `app.auditoria_eventos` a CADA chamada. Sem
 * agrupar, marcar os critérios um a um encheria a auditoria de rascunho — e auditoria neste
 * repositório existe para registrar decisão, não digitação. A janela é larga o bastante para
 * juntar uma sequência normal de cliques e curta o bastante para a ficha continuar parecendo
 * viva; o indicador diz "Alterações pendentes" durante ela, então nada fica sem resposta.
 */
const ESPERA_AUTOSAVE_ICP = 1200

function montarPayloadIcp(respostas: Record<string, boolean>, observacao: string): IcpPayload {
  return {
    respostas,
    observacao: observacao.trim(),
  }
}

function assinaturaPayloadIcp(payload: IcpPayload): string {
  const respostas: Record<string, boolean> = {}
  for (const c of CRITERIOS_ICP_TENKA) respostas[c.id] = payload.respostas?.[c.id] === true
  return JSON.stringify({ respostas, observacao: String(payload.observacao || '').trim() })
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
  const qualificacao = qualificacaoDoLead(l) as QualificacaoResumo
  const seloValidacao = seloValidacaoLead(qualificacao.validacao)
  const maximoCadastro = maximoDoLead(l)
  const leituraCad = leituraCadastro(l.score_cadastro, maximoCadastro, criteriosDoLead(l))
  const criterios = Array.isArray(resumo.criterios) ? resumo.criterios : []
  const marcados = criterios
    .filter((c) => c.marcado)
    .map((c) => `${c.rotulo} +${c.pontos}`)
    .join('; ')
  const prefixo = resumo.origem === 'previsao' ? 'Previa automatica ICP' : 'ICP salvo'
  const cadastro = typeof l.score_cadastro === 'number'
    ? `Cadastro/coleta: ${l.score_cadastro}/${maximoCadastro} - ${leituraCad.titulo}.`
    : 'Cadastro/coleta ainda sem pontuacao.'
  const validacao = `Regua operacional: ${qualificacao.score_100}/100 - ${seloValidacao.rotulo}.`
  const alertas = [...(qualificacao.bloqueios || []), ...(qualificacao.penalidades || []), ...(qualificacao.revisoes || [])]
    .slice(0, 3).map((p) => p.rotulo).join('; ')
  const title = `${prefixo}: ${selo.rotulo}: ${selo.descricao}${selo.score != null ? ` (${selo.score}/13)` : ''}. ${validacao} ${cadastro}${marcados ? ` Criterios ICP: ${marcados}.` : ''}${alertas ? ` Alertas: ${alertas}.` : ''}`
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

/**
 * Perfil de Instagram do lead — e o que ainda não se sabe sobre ele.
 *
 * O componente NÃO decide nada: quem julga se um perfil é do lead é o backend
 * (`services/instagram-perfil.js`), e quem traduz o veredito é `lib/instagram-perfil.js`. Aqui
 * só se desenha o estado e se oferecem as ações que o módulo puro autorizou.
 *
 * A distinção que a tela existe para preservar: perfil CONFIRMADO é o Instagram do lead; perfil
 * CANDIDATO é um palpite de busca esperando uma pessoa decidir — por isso ele aparece com os
 * sinais que bateram e os que não bateram, e nunca como se fosse o perfil dele.
 */
function BlocoInstagram({ lead, empresaId, onLeadAtualizado, pedidoRegistro = 0 }: {
  lead: LeadDetalhavel
  empresaId?: string
  onLeadAtualizado?: (lead: LeadDetalhavel) => void
  /** Incrementado pelo critério do ICP: abre o campo manual e traz o bloco para a vista. */
  pedidoRegistro?: number
}) {
  const [ocupado, setOcupado] = useState<'' | 'procurando' | 'salvando'>('')
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState(false)
  const [digitado, setDigitado] = useState('')
  const alvoRef = useRef<HTMLDivElement | null>(null)
  const fb = useFeedback()

  // O pedido vem de outro ponto da ficha (o checklist do ICP). Ignora o valor inicial 0: sem
  // isso o campo abriria sozinho toda vez que a ficha fosse montada.
  useEffect(() => {
    if (!pedidoRegistro) return
    setDigitado('')
    setEditando(true)
    alvoRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [pedidoRegistro])

  const estado = estadoInstagram(lead)
  const acoes = acoesDisponiveis(lead)
  const ev = evidencia(lead)
  const origem = rotuloOrigem(lead)
  const aviso = avisoAtividade(lead)
  const atividade = estadoAtividade(lead)

  // Sem `empresaId` o modal está aberto por uma tela que não sabe a empresa (Aquisição): o
  // estado continua VISÍVEL e só as ações somem. Esconder o bloco inteiro faria a informação
  // desaparecer sem explicação.
  const podeAgir = !!empresaId

  async function chamar(caminho: string, init?: RequestInit, rotulo?: string) {
    if (!empresaId) return
    setErro('')
    setOcupado(caminho.endsWith('/procurar') ? 'procurando' : 'salvando')
    try {
      const r = await apiFetch<LeadDetalhavel>(
        `/api/empresas/${empresaId}/banco-leads/leads/${lead.id}/instagram${caminho}`,
        init
      )
      const atualizado = (r as { data?: LeadDetalhavel })?.data ?? r
      onLeadAtualizado?.({ ...lead, ...atualizado })
      setEditando(false)
      if (rotulo) fb.toast(rotulo, 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setOcupado('')
    }
  }

  const botao = 'rounded border px-2 py-1 text-xs disabled:opacity-50'

  return (
    <Linha rotulo="Instagram">
      <div className="space-y-1.5" ref={alvoRef}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={
            estado.tom === 'ok' ? 'font-medium text-emerald-700'
              : estado.tom === 'atencao' ? 'font-medium text-amber-700'
                : 'text-slate-500'
          }>
            {rotuloEstado(lead)}
          </span>
          {(estado.handle || estado.candidato) && (
            <a href={urlPerfil(estado.handle || estado.candidato)} target="_blank" rel="noreferrer"
              className="text-brand hover:underline">
              @{estado.handle || estado.candidato} ↗
            </a>
          )}
          {origem && <span className="text-slate-400">· {origem}</span>}
        </div>

        {/* O palpite precisa ser auditável por quem vai decidir: o que bateu e o que não bateu. */}
        {estado.chave === 'candidato' && ev.total > 0 && (
          <ul className="space-y-0.5 text-[11px] text-slate-600">
            {ev.bateram.map((s) => (
              <li key={s.chave}>✓ {s.rotulo}{s.detalhe ? ` (${s.detalhe})` : ''}</li>
            ))}
            {ev.naoBateram.map((s) => (
              <li key={s.chave} className="text-slate-400">✗ {s.rotulo}{s.detalhe ? ` — ${s.detalhe}` : ''}</li>
            ))}
          </ul>
        )}

        {/* ATIVIDADE — complementar, e sempre rotulada em texto. A cor é reforço: o mesmo
            "Postou nos últimos 30 dias" fica neutro quando o perfil é apenas CANDIDATO, porque
            ali a medida é verdade sobre um perfil que talvez nem seja deste negócio. */}
        {atividade.chave && atividade.chave !== 'nao_verificado' && (
          <p className={`text-[11px] ${atividade.tom === 'ok' ? 'text-emerald-700'
            : atividade.tom === 'atencao' ? 'text-amber-700' : 'text-slate-500'}`}>
            {atividade.rotulo}
            {atividade.ultimo_post_em && (
              <span className="text-slate-400">
                {' '}· último post em {new Date(atividade.ultimo_post_em).toLocaleDateString('pt-BR')}
              </span>
            )}
            {atividade.ressalva && <span className="text-amber-700"> · {atividade.ressalva}</span>}
          </p>
        )}

        {aviso && <p className="text-[11px] text-slate-400">{aviso}</p>}

        {editando ? (
          <div className="flex flex-wrap items-center gap-1">
            <input
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder="@usuario ou link do perfil"
              className="w-56 rounded border px-2 py-1 text-xs"
              autoFocus
            />
            <button className={`${botao} border-brand text-brand`} disabled={!!ocupado}
              onClick={() => chamar('', {
                method: 'PATCH',
                body: JSON.stringify({ handle: digitado, confirmar: true }),
              }, 'Instagram atualizado.')}>
              Salvar
            </button>
            <button className={botao} onClick={() => { setEditando(false); setErro('') }}>Cancelar</button>
          </div>
        ) : podeAgir && (
          <div className="flex flex-wrap gap-1">
            {acoes.podeProcurar && (
              <button className={`${botao} border-brand text-brand`} disabled={!!ocupado}
                onClick={() => chamar('/procurar', { method: 'POST' })}>
                {ocupado === 'procurando' ? 'Procurando…' : 'Procurar Instagram'}
              </button>
            )}
            {acoes.podeConfirmar && (
              <button className={`${botao} border-emerald-600 text-emerald-700`} disabled={!!ocupado}
                onClick={() => chamar('', {
                  method: 'PATCH', body: JSON.stringify({ confirmar: true }),
                }, 'Perfil confirmado.')}>
                É este
              </button>
            )}
            {acoes.podeRecusar && (
              <button className={`${botao} border-slate-300 text-slate-600`} disabled={!!ocupado}
                onClick={() => chamar('', {
                  method: 'PATCH', body: JSON.stringify({ confirmar: false }),
                }, 'Perfil recusado.')}>
                Não é este
              </button>
            )}
            <button className={botao} disabled={!!ocupado}
              onClick={() => { setDigitado(estado.handle || estado.candidato || ''); setEditando(true) }}>
              {acoes.podeTrocar ? 'Corrigir' : 'Informar à mão'}
            </button>
          </div>
        )}

        {erro && <p className="text-[11px] text-rose-600">{erro}</p>}
      </div>
    </Linha>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children}</dd>
    </div>
  )
}

function SecaoModal({ titulo, subtitulo, acao, children }: {
  titulo: string
  subtitulo?: string
  acao?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">{titulo}</h4>
          {subtitulo && <p className="mt-0.5 text-xs text-slate-500">{subtitulo}</p>}
        </div>
        {acao}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function CartaoResumo({ rotulo, valor, detalhe, children, classe = '' }: {
  rotulo: string
  valor: string
  detalhe?: string
  children?: React.ReactNode
  classe?: string
}) {
  return (
    <div className={`min-h-[116px] rounded-lg border border-slate-200 bg-white px-4 py-3 ${classe}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight text-slate-900">{valor}</p>
          {detalhe && <p className="mt-1 text-xs leading-relaxed text-slate-500">{detalhe}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

function ListaQualificacao({ titulo, itens, tom = 'neutro' }: {
  titulo: string
  itens: QualificacaoItem[]
  tom?: 'neutro' | 'alerta' | 'positivo'
}) {
  if (!itens.length) return null
  const classe = tom === 'alerta'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : tom === 'positivo'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <div className="mt-2 grid gap-1.5">
        {itens.map((item) => (
          <div key={item.chave || item.rotulo} className={`rounded-lg border px-2.5 py-2 text-xs ${classe}`}>
            <span className="font-medium">{item.rotulo}</span>
            {typeof item.pontos === 'number' && item.pontos !== 0 && (
              <span className={item.pontos < 0 ? 'ml-1 text-rose-700' : 'ml-1 text-emerald-700'}>
                {item.pontos > 0 ? '+' : ''}{item.pontos}
              </span>
            )}
          </div>
        ))}
      </div>
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
  const [autosaveIcp, setAutosaveIcp] = useState<EstadoAutosaveIcp>('idle')
  const [erroAutosaveIcp, setErroAutosaveIcp] = useState('')
  const icpAlteradoRef = useRef(false)
  const ultimaAssinaturaSalvaRef = useRef('')
  const autosaveSeqRef = useRef(0)
  // O estado que precisa atravessar a porta da triagem quando o modal fechar — e, de quebra, o
  // que ainda não tinha sido gravado. Ele NÃO é limpo depois de um autosave bem-sucedido: o
  // autosave grava rascunho, e é o fechamento que submete o veredito FINAL (`finalizar`). Sem
  // isso, fechar dentro da janela do debounce perderia a última edição — com o botão isso era
  // impossível, porque nada saía do modal sem um clique. A URL vai junto do payload para o envio
  // de saída não depender de `lead.id` ainda ser o mesmo no instante da desmontagem.
  const finalizarIcpRef = useRef<{ url: string; payload: IcpPayload } | null>(null)
  // O pai sobrevive ao modal: avisá-lo depois do envio de saída é o que mantém a tabela coerente
  // com o que acabou de ser gravado.
  const onLeadAtualizadoRef = useRef(onLeadAtualizado)
  onLeadAtualizadoRef.current = onLeadAtualizado
  const fb = useFeedback()
  const emp = lead.json_apresentacao?.empresa
  const horario = emp?.horario_funcionamento
  const fotos = emp?.fotos
  const criterios = criteriosDoLead(lead)
  const maximo = maximoDoLead(lead)
  const leituraCad = leituraCadastro(lead.score_cadastro, maximo, criterios)
  // Contador, não booleano: o operador pode clicar "Registrar Instagram" várias vezes, e cada
  // clique tem de reabrir o campo — um booleano já `true` não dispararia o efeito de novo.
  const [pedidoRegistroIg, setPedidoRegistroIg] = useState(0)
  const avisoIcp = avisoIcpSemPerfil(lead)
  const icp = resumoIcpDoLead(lead) as ResumoIcp
  const sinaisAuto = useMemo(
    () => ({ ...sinaisAutomaticosDoLead(lead), ...(icp.sinais_auto || {}) }) as Record<string, SinalIcp>,
    [lead, icp.sinais_auto]
  )
  const icpEditado = useMemo(() => calcularIcp(respostasIcp), [respostasIcp])
  const seloEditado = seloIcp(icpEditado.faixa, icpEditado.score)
  const qualificacao = useMemo(
    () => qualificacaoDoLead({ ...lead, icp_score: icpEditado.score, icp_faixa: icpEditado.faixa,
      icp_resumo_json: { ...lead.icp_resumo_json, ...icpEditado } }) as QualificacaoResumo,
    [lead, icpEditado]
  )
  const seloValidacao = seloValidacaoLead(qualificacao.validacao)
  const alertasQualificacao = [
    ...(qualificacao.bloqueios || []),
    ...(qualificacao.penalidades || []),
    ...(qualificacao.revisoes || []),
  ]
  const sinaisQualificacao = qualificacao.sinais || []
  const autosaveTexto = autosaveIcp === 'pendente'
    ? 'Alterações pendentes'
    : autosaveIcp === 'salvando'
      ? 'Salvando ICP'
      : autosaveIcp === 'salvo'
        ? 'ICP salvo'
        : autosaveIcp === 'erro' || autosaveIcp === 'bloqueado'
          ? 'ICP não salvo'
          : 'Autosave ativo'
  const autosaveClasse = autosaveIcp === 'erro' || autosaveIcp === 'bloqueado'
    ? 'bg-red-50 text-red-700'
    : autosaveIcp === 'salvando' || autosaveIcp === 'pendente'
      ? 'bg-amber-50 text-amber-700'
      : autosaveIcp === 'salvo'
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-slate-50 text-slate-500'
  const contatos = [
    lead.telefone ? 'telefone' : '',
    lead.email ? 'e-mail' : '',
  ].filter(Boolean)

  useEffect(() => {
    const respostas = respostasIniciaisIcp(lead) as Record<string, boolean>
    const observacao = String(lead.icp_resumo_json?.observacao || '')
    setRespostasIcp(respostas)
    setObservacaoIcp(observacao)
    ultimaAssinaturaSalvaRef.current = assinaturaPayloadIcp(montarPayloadIcp(respostas, observacao))
    icpAlteradoRef.current = false
    finalizarIcpRef.current = null
    setAutosaveIcp('idle')
    setErroAutosaveIcp('')
    // Depende SÓ do lead aberto. `icp_avaliado_em`/`icp_score` mudam a cada salvamento — e o
    // pai devolve o lead atualizado para dentro deste mesmo modal (`aplicarLeadAtualizado`) —,
    // então tê-los aqui fazia o autosave provocar o próprio reset: o "ICP salvo" era apagado no
    // ciclo seguinte ao que aparecia, e o que estivesse sendo digitado durante a ida e volta da
    // requisição voltava ao valor do servidor. O controle de corrida por sequência não pega
    // isso, porque a sobrescrita não vem da resposta atrasada: vem do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  function alterarRespostaIcp(id: string, marcado: boolean) {
    icpAlteradoRef.current = true
    setRespostasIcp((r) => ({ ...r, [id]: marcado }))
  }

  function alterarObservacaoIcp(valor: string) {
    icpAlteradoRef.current = true
    setObservacaoIcp(valor)
  }

  useEffect(() => {
    if (!icpAlteradoRef.current) return

    const payload = montarPayloadIcp(respostasIcp, observacaoIcp)
    const assinatura = assinaturaPayloadIcp(payload)
    if (assinatura === ultimaAssinaturaSalvaRef.current) {
      setAutosaveIcp('idle')
      setErroAutosaveIcp('')
      return
    }
    if (!empresaId) {
      setAutosaveIcp('bloqueado')
      setErroAutosaveIcp('Abra este lead pelo Banco de Leads para salvar o ICP.')
      return
    }

    const url = `/api/empresas/${empresaId}/banco-leads/leads/${lead.id}/icp`
    finalizarIcpRef.current = { url, payload }
    setAutosaveIcp('pendente')
    setErroAutosaveIcp('')
    const timer = window.setTimeout(() => {
      const seq = autosaveSeqRef.current + 1
      autosaveSeqRef.current = seq
      salvarIcpAutomatico(url, payload, assinatura, seq)
    }, ESPERA_AUTOSAVE_ICP)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respostasIcp, observacaoIcp, empresaId, lead.id])

  // Fechar o modal É a decisão. Este é o ÚNICO envio com `finalizar`, e por isso o único que pode
  // atravessar a porta da triagem — sobre o estado final, nunca sobre um intermediário. Ele
  // carrega o payload atual, então também cobre a edição que ainda estava esperando o debounce.
  // Não toca em estado nenhum (este componente já não existe) e avisa o pai, que continua montado.
  //
  // Limite declarado: fechar a ABA do navegador no meio da avaliação não roda esta limpeza. O
  // rascunho fica gravado (checklist e faixa aparecem ao reabrir) e a qualificação acontece no
  // próximo fechamento normal do modal. É melhor que o inverso — aprovar por estado intermediário
  // um lead que o operador terminaria classificando como B.
  useEffect(() => {
    return () => {
      const alvo = finalizarIcpRef.current
      if (!alvo) return
      finalizarIcpRef.current = null
      apiFetch<LeadDetalhavel>(alvo.url, {
        method: 'PATCH',
        body: JSON.stringify({ ...alvo.payload, finalizar: true }),
      })
        .then((r) => onLeadAtualizadoRef.current?.(r.data))
        .catch(() => {})
    }
  }, [])

  async function salvarIcpAutomatico(url: string, payload: IcpPayload, assinatura: string, seq: number) {
    setAutosaveIcp('salvando')
    try {
      const r = await apiFetch<LeadDetalhavel>(url, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      if (seq !== autosaveSeqRef.current) return
      ultimaAssinaturaSalvaRef.current = assinatura
      icpAlteradoRef.current = false
      // `finalizarIcpRef` NÃO é limpo aqui de propósito: o que acabou de ser gravado é rascunho,
      // e o veredito final continua devendo ser submetido quando o modal fechar.
      onLeadAtualizado?.(r.data)
      setAutosaveIcp('salvo')
      setErroAutosaveIcp('')
    } catch (e) {
      if (seq !== autosaveSeqRef.current) return
      setAutosaveIcp('erro')
      setErroAutosaveIcp(e instanceof Error ? e.message : 'Erro ao salvar ICP automaticamente.')
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
      {/* Geometria do PRIMITIVO: folha inferior no celular, modal centrado a partir de `sm`.
          A ficha tem grade de 2-3 colunas — espremida numa coluna de 358px ela vira uma pilha
          sem fim, e o `92vh` fazia a barra do navegador do telefone cortar o rodapé. */}
      <div className={classesFundoFolha()} onClick={onFechar}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes de ${lead.nome}`}
          className={classesFolha({ tamanho: 'xl', extra: 'bg-surface-2' })}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ficha do lead</p>
                <h3 className="mt-1 truncate text-xl font-semibold leading-tight text-slate-950">{lead.nome || '—'}</h3>
                <NichoCidade nicho={lead.nicho} cidade={lead.cidade} className="mt-1 text-sm" vazio="Sem mercado informado" />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full border px-2.5 py-1 font-semibold ${seloEditado.classe}`} title={seloEditado.descricao}>
                    {seloEditado.rotulo}{seloEditado.score != null ? ` · ${seloEditado.score}/13` : ''}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 font-semibold ${seloValidacao.classe}`} title={seloValidacao.descricao}>
                    {seloValidacao.rotulo} · {qualificacao.score_100}/100
                  </span>
                  {contatos.length > 0 && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">
                      {contatos.join(' + ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {lead.json_apresentacao && (
                  <button
                    onClick={() => setJsonAberto(true)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-brand hover:bg-brand/5 hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Dados unificados + prompt único pro bot gerar a saudação de análise"
                  >
                    Ver dados completos
                  </button>
                )}
                <button
                  onClick={onFechar}
                  aria-label="Fechar detalhes"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-xl leading-none text-slate-400 hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* O corpo rola; a altura vem do flex do painel, não de um `calc` com a altura do
              cabeçalho chutada — o cabeçalho quebra em mais linhas no celular e o `-108px`
              passava a mentir justamente ali. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <div className="grid gap-3 lg:grid-cols-3">
              <CartaoResumo
                rotulo="Decisão ICP"
                valor={seloEditado.rotulo}
                detalhe={`Checklist humano em ${seloEditado.score ?? 0}/13 pontos.`}
              >
                <BolinhaIcp l={{ ...lead, icp_score: icpEditado.score, icp_faixa: icpEditado.faixa, icp_resumo_json: { ...lead.icp_resumo_json, ...icpEditado } }} />
              </CartaoResumo>
              <CartaoResumo
                rotulo="Validação operacional"
                valor={`${qualificacao.score_100}/100`}
                detalhe={alertasQualificacao.length > 0
                  ? alertasQualificacao.slice(0, 2).map((a) => a.rotulo).join(' · ')
                  : `Validação ${qualificacao.confianca === 'alta' ? 'com confiança alta' : 'com atenção'}.`}
              />
              <CartaoResumo
                rotulo="Cadastro e coleta"
                valor={typeof lead.score_cadastro === 'number' ? `${lead.score_cadastro}/${maximo}` : 'sem score'}
                detalhe={`${leituraCad.titulo}. ${NOTA_COMPLETUDE}`}
              />
            </div>

            {/* Mensagem já preparada (Manual/Semi/Automático escrevem no mesmo rascunho — texto
                único reaproveitado pelos três). O botão de copiar existe para o caso em que a
                instância de envio está desconectada: a mensagem já foi gerada e não precisa
                esperar a conexão voltar para ser aproveitada manualmente. */}
            {lead.mensagem_gerada && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Mensagem gerada</p>
                  <button
                    type="button"
                    onClick={copiarMensagem}
                    className="shrink-0 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    Copiar
                  </button>
                </div>
                <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
                  {lead.mensagem_gerada}
                </p>
                {instanciaDesconectada && (
                  <p className="mt-2 text-xs text-amber-800">
                    Instância desconectada — copie e envie manualmente pelo WhatsApp enquanto ela não volta.
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <SecaoModal
                titulo="Checklist ICP"
                subtitulo="Marque o que foi validado por evidência humana; sinais automáticos ficam separados."
                acao={(
                  <span
                    role={autosaveIcp === 'erro' || autosaveIcp === 'bloqueado' ? 'alert' : 'status'}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${autosaveClasse}`}
                    title={erroAutosaveIcp || undefined}
                  >
                    {autosaveTexto}
                  </span>
                )}
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {icpEditado.criterios.map((c) => {
                    const auto = sinaisAuto[c.id]
                    const humano = c.tipo !== 'automatico'
                    const criterioDoc = CRITERIOS_ICP_TENKA.find((item) => item.id === c.id) || c
                    return (
                      <label
                        key={c.id}
                        title={`${criterioDoc.explicacao || c.rotulo}${criterioDoc.exemplo ? ` Exemplo: ${criterioDoc.exemplo}` : ''}`}
                        className={`flex min-h-[104px] items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                          respostasIcp[c.id]
                            ? 'border-orange-300 bg-orange-50 text-slate-900 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!!respostasIcp[c.id]}
                          onChange={(e) => alterarRespostaIcp(c.id, e.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="font-semibold">{c.rotulo}</span>
                          <span className="ml-1 text-xs text-slate-400">+{c.pontos}</span>
                          <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {humano ? (auto?.sugerido ? 'auto + humano' : 'humano') : 'automático'}
                          </span>
                          {criterioDoc.explicacao && <span className="mt-1 block text-xs leading-relaxed text-slate-500">{criterioDoc.explicacao}</span>}
                          {auto?.motivo && <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{auto.motivo}</span>}
                          {/* Marcar "Instagram ativo" sem perfil registrado NÃO é bloqueado: o ICP é
                              julgamento humano e o operador pode ter visto o perfil por fora. Mas o
                              sistema só verifica o que está registrado — então a tela pede o
                              registro em vez de deixar o critério marcado sobre nada. */}
                          {c.id === 'instagram_ativo' && !!respostasIcp[c.id] && avisoIcp && (
                            <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-700">
                              {avisoIcp}
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); setPedidoRegistroIg((n) => n + 1) }}
                                className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-medium text-amber-800 hover:bg-amber-50"
                              >
                                Registrar Instagram
                              </button>
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <textarea
                  value={observacaoIcp}
                  onChange={(e) => alterarObservacaoIcp(e.target.value)}
                  placeholder="Observação opcional sobre o fit comercial"
                  className="mt-3 min-h-[72px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
                <p className="mt-2 text-xs text-slate-500">
                  As alterações são salvas sozinhas. Se o resultado final for Lead A, ele fica
                  marcado/qualificado ao fechar esta ficha.
                </p>
                {erroAutosaveIcp && (
                  <p className="mt-2 text-xs text-red-600">{erroAutosaveIcp}</p>
                )}
              </SecaoModal>

              <div className="space-y-4">
                <SecaoModal titulo="Contexto do lead" subtitulo="Dados que ajudam a decidir a abordagem.">
                  {/* Dados complementares: é para cá que vieram Endereço, Nota, Avaliações e Horário
                      quando saíram das colunas da tabela. */}
                  <dl className="divide-y divide-slate-100">
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
                    <BlocoInstagram lead={lead} empresaId={empresaId} onLeadAtualizado={onLeadAtualizado} pedidoRegistro={pedidoRegistroIg} />
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
                    {lead.bio && <Linha rotulo="Bio"><span className="text-xs leading-relaxed text-slate-600">{lead.bio}</span></Linha>}
                  </dl>
                </SecaoModal>

                <SecaoModal titulo="Sinais automáticos" subtitulo="Sugestões de apoio, não substituem a validação humana.">
                  <div className="grid gap-2">
                    {Object.entries(sinaisAuto).map(([id, sinal]) => {
                      const criterio = CRITERIOS_ICP_TENKA.find((c) => c.id === id)
                      if (!criterio) return null
                      return (
                        <div
                          key={id}
                          title={`${criterio.explicacao || criterio.rotulo}${criterio.exemplo ? ` Exemplo: ${criterio.exemplo}` : ''}`}
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            sinal?.sugerido ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{criterio.rotulo}</span>
                            <span>{sinal?.sugerido ? 'detectado' : 'não detectado'}</span>
                          </div>
                          {sinal?.motivo && <p className="mt-1 leading-relaxed opacity-80">{sinal.motivo}</p>}
                        </div>
                      )
                    })}
                  </div>
                </SecaoModal>

                {(alertasQualificacao.length > 0 || sinaisQualificacao.length > 0 || criterios.length > 0) && (
                  <SecaoModal titulo="Evidências e alertas" subtitulo="Pontuação de cadastro e régua operacional.">
                    <div className="space-y-4">
                      <ListaQualificacao titulo="Penalidades / revisão" itens={alertasQualificacao.slice(0, 5)} tom="alerta" />
                      <ListaQualificacao titulo="Sinais positivos" itens={sinaisQualificacao.slice(0, 5)} tom="positivo" />
                      {criterios.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cadastro</p>
                          <ul className="mt-2 grid gap-1">
                            {criterios.map((c, i) => (
                              <li key={c.chave || i} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${c.ok ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span>
                                <span className="min-w-0 flex-1">{c.label}</span>
                                {!c.ok && <span className="text-[10px] text-slate-400">+{c.pontos_possiveis ?? 0}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </SecaoModal>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={onFechar}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      </div>
      {jsonAberto && lead.json_apresentacao && (
        <JsonLeadModal titulo={lead.nome} json={lead.json_apresentacao} onFechar={() => setJsonAberto(false)} />
      )}
    </>
  )
}
