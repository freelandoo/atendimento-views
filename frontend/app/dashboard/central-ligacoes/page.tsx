'use client'
// Central de Ligações + Operação da Ligação (módulo Prospecção & Inteligência Comercial).
// Cockpit do vendedor: escolhe a campanha ativa, vê a fila priorizada e liga. A Operação
// (3 colunas) mostra o lead, o roteiro navegável e o registro rápido; ao encerrar, o
// resumo estruturado é enviado. Consome /api/empresas/:id/{campanhas,roteiros,ligacoes}.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconClose, IconSend } from '@/components/ui/icons'
import TextoTruncado from '@/components/ui/TextoTruncado'
import { resumoSinais } from '@/lib/ligacao-sinais-resumo'
import { segDesde, fmtCronometro } from '@/lib/ligacao-estado'
import { fmtFone, telHref, avisoFone, analisarFone } from '@/lib/ligacao-fone'
import {
  VIEW_PADRAO, SITE_OPCOES, PRIORIDADE_OPCOES, TENTATIVAS_OPCOES, PROXIMA_ACAO_OPCOES,
  EMAIL_OPCOES, REDES_OPCOES, RECENCIA_OPCOES,
  normalizarView, limparFiltros, filaPadrao, limparCampo, filtrarFila, opcoesDaFila,
  chipsAtivos, contarFiltrosAtivos, viewsIguais,
  TAMANHOS_PAGINA, POR_PAGINA_PADRAO, normalizarPorPagina, paginar, resumoPaginacao, mostrarPaginacao,
  type FilaView, type ChipFiltro, type OpcoesDaFila, type PaginaFila,
} from '@/lib/fila-ligacoes-view'
import { rotuloLink, tituloLinkNaoSite } from '@/lib/site-rotulos'
// Vocabulario da PROXIMA ACAO — o MESMO modulo puro que a fila de Follow-ups usa. A Central
// de Ligacoes nao decide nada sobre a fila: ela registra a decisao e mostra o resumo.
// `PRIORIDADE_OPCOES` ja existe neste arquivo (filtros da fila de ligacao, outro dominio),
// entao o vocabulario do follow-up entra com apelido.
import {
  CANAL_OPCOES,
  PRIORIDADE_OPCOES as PRIORIDADE_FOLLOWUP_OPCOES,
  sugerirProximaAcao, validarProximaAcao, montarPayloadProximaAcao, resumoProximaAcao, formatarQuando,
  type FormProximaAcao, type FollowUpApi,
} from '@/lib/follow-up-acao'
import { msgErro } from '@/lib/erro-msg'
import BolinhaPontuacao from '@/components/ui/BolinhaPontuacao'
import { VARIANTES, O_QUE_MEDE, fatoresDeMotivos } from '@/lib/pontuacao-indicador'
import MenuRadialAcoes from '@/components/ui/MenuRadialAcoes'

const base = () => `/api/empresas/${typeof window !== 'undefined' ? localStorage.getItem('empresa_id') : ''}`

const ETAPA_LABEL: Record<string, string> = {
  abertura: 'Abertura', permissao: 'Permissão', situacao: 'Situação', descoberta: 'Descoberta',
  problema: 'Problema', implicacao: 'Implicação', insight: 'Insight', qualificacao: 'Qualificação',
  objecoes: 'Objeções', convite_reuniao: 'Convite p/ reunião', proxima_acao: 'Próxima ação',
}
const RESULTADOS: [string, string][] = [
  ['atendeu', 'Atendeu'], ['nao_atendeu', 'Não atendeu'], ['caixa_postal', 'Caixa postal'],
  ['ocupado', 'Ocupado'], ['numero_invalido', 'Número inválido'], ['reagendou', 'Reagendou'],
]
const STATUS_OP: [string, string][] = [
  ['nao_iniciado', 'Não iniciado'], ['tentativa_contato', 'Tentativa de contato'], ['nao_atendeu', 'Não atendeu'],
  ['contato_realizado', 'Contato realizado'], ['em_descoberta', 'Em descoberta'], ['qualificado', 'Qualificado'],
  ['follow_up', 'Follow-up'], ['reuniao_marcada', 'Reunião marcada'], ['proposta_enviada', 'Proposta enviada'],
  ['negociacao', 'Negociação'], ['convertido', 'Convertido'], ['descartado', 'Descartado'],
]
// Espelha MOTIVO_PERDA (backend/src/domain-enums.js) — CHECK redefinida na migration 052.
// 'numero_invalido' saiu (é disposição da chamada, vive em RESULTADOS) e 'pediu_novo_contato'
// também (é adiamento: use Resultado "Reagendou" + status Follow-up).
const MOTIVOS: [string, string][] = [
  ['nao_era_decisor', 'Não era o decisor'], ['sem_disponibilidade', 'Sem disponibilidade'],
  ['sem_prioridade', 'Sem prioridade'], ['sem_orcamento', 'Sem orçamento'], ['ja_tem_fornecedor', 'Já tem fornecedor'],
  ['nao_percebeu_valor', 'Não percebeu valor'], ['sem_perfil', 'Sem perfil'], ['sem_interesse', 'Sem interesse'],
]

// Cor por status da oportunidade. Antes TODOS usavam o mesmo cinza — "Convertido" e
// "Descartado" ficavam visualmente idênticos na lista. Só apresentação.
const STATUS_CLS: Record<string, string> = {
  descartado: 'bg-red-100 text-red-700',
  convertido: 'bg-emerald-100 text-emerald-800',
  reuniao_marcada: 'bg-emerald-100 text-emerald-700',
  proposta_enviada: 'bg-sky-100 text-sky-700',
  negociacao: 'bg-sky-100 text-sky-700',
  qualificado: 'bg-indigo-100 text-indigo-700',
  em_descoberta: 'bg-indigo-100 text-indigo-700',
  follow_up: 'bg-amber-100 text-amber-700',
  nao_atendeu: 'bg-amber-100 text-amber-700',
  tentativa_contato: 'bg-amber-100 text-amber-700',
  contato_realizado: 'bg-slate-200 text-slate-700',
  nao_iniciado: 'bg-slate-100 text-slate-500',
}
const clsStatus = (s: string) => STATUS_CLS[s] || 'bg-slate-100 text-slate-600'
const rotuloStatus = (s: string) => STATUS_OP.find((x) => x[0] === s)?.[1] || s
// Status que caracterizam PERDA — só neles faz sentido pedir "motivo de perda".
const STATUS_PERDA = new Set(['descartado'])

type Campanha = { id: string; nome: string; status: string; total_leads: number; convertidos: number }
type CampanhaDetalhe = {
  id: string; nome: string; roteiro_versao_id: string | null; roteiro_nome: string | null; roteiro_versao: number | null
  meta_ligacoes: number | null; meta_reunioes: number | null; leads_por_status: Record<string, number>
}
// Prioridade COMERCIAL da campanha (0-100), calculada no backend
// (src/services/ligacao-prioridade.js). Não é a pontuação de cadastro do lead (`score`) —
// aqui a pergunta é "quanto vale ligar para este negócio agora, nesta campanha".
type Prioridade = {
  score: number; faixa: 'alta' | 'media' | 'baixa'; faixa_label: string
  situacao_site: 'tem_site' | 'sem_site' | 'nao_identificado'; motivos: string[]
}
// Os campos opcionais já existem no cadastro (Bright Data / Banco de Leads) e só são
// exibidos — nada é coletado por esta tela. Opcionais porque a aba Acompanhamento reaproveita
// este tipo para abrir a Operação com o que ela tem em mãos.
// Sinais enriquecidos do cadastro (Bright Data / Banco de Leads). Ficam FORA da listagem —
// só aparecem na tela de atendimento, na Visão detalhada. Nenhum deles é coletado aqui.
type LeadEnriquecido = {
  tem_site?: boolean | null; site?: string | null; maps_url?: string | null
  avaliacoes?: number | null; rating?: number | null
  email?: string | null; endereco?: string | null
  instagram_handle?: string | null; link_bio?: string | null
  seguidores?: number | null; categoria_perfil?: string | null
  // `situacao_site` chega pronta do backend (mesma função pura da prioridade). A regra de
  // "tem / não tem / não identificado" NUNCA é recalculada aqui.
  situacao_site?: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  // `site` só vem preenchido quando é site PRÓPRIO; o link cru (Instagram, Linktree,
  // ficha do Maps) vem em `link_original`, com a categoria em `classificacao_url`.
  link_original?: string | null
  classificacao_url?: string | null
}
type FilaItem = LeadEnriquecido & {
  campanha_lead_id: string; status: string; prospect_id: string; nome: string
  telefone: string | null; cidade: string | null; nicho: string | null; score: number | null; tentativas: number
  prioridade?: Prioridade | null
  proxima_acao?: string | null
  // Qualidade do dado (filtros): de onde veio e há quanto tempo está na base.
  origem?: string | null; created_at?: string | null
}
type LeadAcomp = LeadEnriquecido & {
  id: string; status: string; proxima_acao: string | null; data_followup: string | null
  prospect_id: string; nome: string; telefone: string | null; cidade: string | null; nicho: string | null
}
type EtapaApi = {
  id: string; ordem: number; tipo: string; titulo: string | null; objetivo: string | null; frase_sugerida: string | null
  perguntas_json: string[]; sinais_interesse_json: string[]; sinais_resistencia_json: string[]
  objecoes_json: { objecao: string; resposta: string }[]
}
type SinalReg = { id: string; tipo: 'interesse' | 'resistencia'; texto: string; origem: string; etapa_tipo: string | null }
type ObjecaoReg = { id: string; texto_objecao: string; origem: string; etapa_tipo: string | null; resposta_utilizada: string | null; resolvida: boolean }
type PerguntaReg = { id: string; texto_no_momento: string; etapa_tipo: string | null; pergunta_indice: number | null }
type ObjecaoRoteiro = { objecao: string; resposta: string }
type Ligacao = { id: string; resultado: string; etapa_alcancada: string | null; objecao_principal: string | null; motivo_perda: string | null; notas?: string | null; criado_em: string }
type Funil = { encerraram: Record<string, number>; perderam: Record<string, number>; total_ligacoes: number }
const ETAPA_ORDEM = ['abertura', 'permissao', 'situacao', 'descoberta', 'problema', 'implicacao', 'insight', 'qualificacao', 'objecoes', 'convite_reuniao', 'proxima_acao']

// Severidade do alerta de qualidade do número, derivada do `motivo` de analisarFone().
// Glifo DIFERENTE por severidade (não só cor) para não depender de percepção de cor.
// 'vazio' não entra: telefone ausente já se explica com o "—", alerta ali seria ruído.
const FONE_ALERTA: Record<string, { glifo: string; rotulo: string; cls: string }> = {
  sem_ddd: { glifo: '!', rotulo: 'Atenção', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  formato_desconhecido: { glifo: '✕', rotulo: 'Número inválido', cls: 'border-red-300 bg-red-50 text-red-700' },
}

// Telefone clicável: o vendedor disca no clique em vez de ler da tela e digitar — que era a
// principal fonte de erro de discagem. Número não discável (sem DDD/irreconhecível) não vira
// link e ganha um SELO de alerta, em vez de aparecer como se estivesse completo.
//
// O aviso era texto inline ("⚠ sem DDD — confira antes de ligar"): ocupava mais espaço que o
// próprio número, quebrava a célula em duas linhas e engordava a tabela toda. Agora é um selo
// de 16px + tooltip sob demanda — nenhuma informação se perde: o motivo continua no tooltip
// visual (hover E foco por teclado), no `title` nativo e no aria-label para leitor de tela.
function Fone({ tel, className = '' }: { tel: string | null; className?: string }) {
  const href = telHref(tel)
  const aviso = avisoFone(tel)
  const alerta = FONE_ALERTA[analisarFone(tel).motivo || '']
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}>
      {href
        ? <a href={href} className="text-brand hover:underline" title="Clique para discar">{fmtFone(tel)}</a>
        : <span className="text-slate-500">{fmtFone(tel)}</span>}
      {alerta && aviso && (
        // tabIndex=0 + group-focus: o tooltip abre no Tab, não só no mouse. O `title` fica como
        // fallback nativo; o aria-label é o que o leitor de tela anuncia.
        <span tabIndex={0} title={aviso} aria-label={`${alerta.rotulo}: ${aviso}`}
          className="group relative inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <span aria-hidden="true" className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${alerta.cls}`}>{alerta.glifo}</span>
          {/* Abre para CIMA: dentro da tabela (wrapper overflow-hidden) sempre há o cabeçalho
              acima da 1ª linha, então a bolha nunca é cortada. */}
          <span role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden w-max max-w-[210px] -translate-x-1/2 whitespace-normal rounded-md bg-slate-800 px-2 py-1 text-left text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus:block">
            {aviso}
          </span>
        </span>
      )}
    </span>
  )
}

// A paleta da faixa de prioridade saiu daqui: virou a variante `prioridade_comercial` de
// `lib/pontuacao-indicador.js`, preservada classe a classe (há teste que falha se mudar).
// Rótulos explícitos: "Tem site próprio" / "Sem site próprio" / "Verificar link". Um lead
// cujo único link é Instagram, Facebook ou Linktree é "Sem site próprio" — nunca "Tem site".
// A decisão vem pronta do backend em `situacao_site` (services/site-classificacao.js).
const SITE_SELO: Record<string, { txt: string; cls: string }> = {
  sem_site: { txt: 'Sem site próprio', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  nao_identificado: { txt: 'Verificar link', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  tem_site: { txt: 'Tem site próprio', cls: 'border-slate-300 bg-slate-50 text-slate-500' },
}
// v2: a view salva pela versão anterior tinha `modo` (extinto) e `tentativas: 'todas'`, que
// sobreviveria à normalização — o operador antigo não veria a fila padrão "não iniciados".
const CHAVE_VIEW = 'filaLigacoesView.v2'
// Tamanho de página fica FORA da view: não é filtro (não vira chip nem conta como filtro ativo),
// mas continua sendo preferência do operador — por isso, chave própria.
const CHAVE_POR_PAGINA = 'filaLigacoesPorPagina.v1'

// Círculo de pontuação da coluna Prioridade. O componente (geometria, tooltip em portal,
// foco por teclado, fechamento em scroll/resize) foi extraído para
// `components/ui/BolinhaPontuacao.tsx` — esta tela era a única das três com acessibilidade e
// posicionamento corretos, então virou a referência que as outras passaram a consumir.
// O que continua sendo desta tela: os pesos, as faixas e o significado — prioridade de
// LIGAÇÃO dentro de uma campanha, que não é qualidade do lead nem qualidade da conversa.
function CirculoPrioridade({ p }: { p: Prioridade | null | undefined }) {
  if (!p) return <span className="text-slate-300">—</span>
  return (
    <BolinhaPontuacao
      valor={p.score}
      maximo={100}
      faixa={p.faixa}
      titulo={p.faixa_label}
      oQueMede={O_QUE_MEDE.prioridade_ligacao}
      fatores={fatoresDeMotivos(p.motivos)}
      variante={VARIANTES.PRIORIDADE}
    />
  )
}

// Visão detalhada do lead — exclusiva da TELA DE ATENDIMENTO. Reapresenta os sinais que já
// vieram do cadastro (Bright Data / Banco de Leads) para orientar a conversa; nada é coletado
// aqui. A situação do site vem pronta do backend (`situacao_site`), nunca recalculada.
function LeadDetalhes({ l }: { l: FilaItem }) {
  const sit = l.prioridade?.situacao_site || l.situacao_site || null
  const selo = sit ? SITE_SELO[sit] : null
  const insta = (l.instagram_handle || '').replace(/^@/, '')
  const temAlgo = !!(selo || l.site || l.link_original || l.avaliacoes != null || l.rating != null || l.email
    || insta || l.link_bio || l.maps_url || l.endereco || l.seguidores != null || l.categoria_perfil)
  if (!temAlgo) {
    return <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-400">Sem dados enriquecidos para este lead.</div>
  }
  return (
    <div className="space-y-1.5 border-t pt-2 text-xs text-slate-500">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {selo && <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${selo.cls}`}>{selo.txt}</span>}
        {l.tem_site && l.site && <a href={l.site} target="_blank" rel="noreferrer" className="text-brand hover:underline">abrir site ↗</a>}
        {/* O link que NÃO é site continua acessível ao operador, dito pelo que ele é —
            "abrir rede social", nunca "abrir site". */}
        {!l.tem_site && l.link_original && (
          <a href={l.link_original} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline"
            title={tituloLinkNaoSite(l.classificacao_url, l.link_original)}>
            abrir {rotuloLink(l.classificacao_url) || 'link'} ↗
          </a>
        )}
      </div>
      {(l.avaliacoes != null || l.rating != null || l.seguidores != null) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {l.avaliacoes != null && <span>{l.avaliacoes} avaliações</span>}
          {l.rating != null && <span>★ {Number(l.rating).toFixed(1)}</span>}
          {l.seguidores != null && <span>{l.seguidores.toLocaleString('pt-BR')} seguidores</span>}
        </div>
      )}
      {(l.email || insta || l.link_bio || l.maps_url) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {l.email && <a href={`mailto:${l.email}`} className="break-all text-brand hover:underline">{l.email}</a>}
          {insta && <a href={`https://instagram.com/${insta}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">@{insta}</a>}
          {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-brand hover:underline">link da bio ↗</a>}
          {l.maps_url && <a href={l.maps_url} target="_blank" rel="noreferrer" className="hover:underline">ver no Maps ↗</a>}
        </div>
      )}
      {l.endereco && <div title={l.endereco}>📍 {l.endereco}</div>}
      {(l.nicho || l.categoria_perfil) && <div>🏷 {[l.nicho, l.categoria_perfil].filter(Boolean).join(' · ')}</div>}
    </div>
  )
}

// ── Painel de filtros da fila ────────────────────────────────────────────────────────
// Painel OPERACIONAL GERAL (não um filtro de site): grupos Operação, Contato, Potencial
// comercial, Perfil do negócio, Presença digital e Qualidade do dado — mesmo padrão compacto
// do Banco de Leads. Tudo client-side sobre a fila já carregada; nenhuma requisição nova.
//
// Ele é FLUTUANTE (portal no <body> + position:fixed ancorado no botão "Filtros"), e não uma
// seção no fluxo da página: a versão anterior era renderizada entre os chips e a tabela, então
// abrir os filtros empurrava a fila centenas de pixels para baixo justamente quando o operador
// precisava vê-la. Em portal ele tem altura ZERO no fluxo — a tabela não se move.
function GrupoFiltro({ titulo, children, cols = 3 }: { titulo: string; children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <div className={`grid gap-3 ${cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>{children}</div>
    </section>
  )
}

function SelFiltro({ label, value, onChange, opcoes }: {
  label: string; value: string; onChange: (v: string) => void; opcoes: readonly (readonly [string, string])[]
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-sm">
        {opcoes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function FaixaNum({ label, min, max, onMin, onMax, step, teto }: {
  label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; step?: number; teto?: number
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-500">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" min={0} max={teto} step={step} value={min} onChange={(e) => onMin(e.target.value)} placeholder="mín"
          aria-label={`${label} — mínimo`} className="w-full min-w-0 rounded-lg border px-2 py-1.5 text-sm" />
        <input type="number" min={0} max={teto} step={step} value={max} onChange={(e) => onMax(e.target.value)} placeholder="máx"
          aria-label={`${label} — máximo`} className="w-full min-w-0 rounded-lg border px-2 py-1.5 text-sm" />
      </div>
    </div>
  )
}

// Indicador de critério FIXO da fila — algo que o operador precisa saber que está valendo,
// mas que não é controlável aqui (quem decide é o servidor, ou já existe controle em outro
// lugar). Duplicar esses estados como <select> criaria dois donos para a mesma informação.
function NotaFixa({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-500">{children}</div>
}

const LARGURA_PAINEL = 620

// Posição do painel ancorada no botão "Filtros". Recalcula em scroll/resize para a bolha não
// ficar solta da âncora. Abaixo de 768px vira drawer inferior (largura total, rolagem interna).
type CaixaPainel = { left: number; top: number; larg: number; maxH: number; compacto: boolean }
function usePosicaoPainel(ancora: HTMLElement | null): CaixaPainel | null {
  const [caixa, setCaixa] = useState<CaixaPainel | null>(null)
  useEffect(() => {
    // Só troca o estado quando a posição realmente muda: o listener de scroll é `capture`,
    // então a própria rolagem INTERNA do painel o dispara — sem isso, re-renderizava a cada
    // tique de rolagem dentro do painel.
    const guardar = (nova: CaixaPainel) => setCaixa((atual) => (
      atual && atual.left === nova.left && atual.top === nova.top
        && atual.larg === nova.larg && atual.maxH === nova.maxH && atual.compacto === nova.compacto
        ? atual : nova
    ))
    const calcular = () => {
      const compacto = window.innerWidth < 768
      if (compacto) {
        guardar({ left: 0, top: 0, larg: window.innerWidth, maxH: Math.round(window.innerHeight * 0.85), compacto })
        return
      }
      const r = ancora?.getBoundingClientRect()
      const larg = Math.min(LARGURA_PAINEL, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r ? r.left : 8, window.innerWidth - larg - 8))
      // Clampa o topo: se o botão sair da tela por rolagem, o painel para na borda em vez de
      // subir junto e desaparecer.
      const top = Math.max(8, Math.min(r ? r.bottom + 8 : 88, window.innerHeight - 220))
      guardar({ left, top, larg, maxH: Math.max(240, window.innerHeight - top - 16), compacto })
    }
    calcular()
    window.addEventListener('resize', calcular)
    window.addEventListener('scroll', calcular, true)
    return () => {
      window.removeEventListener('resize', calcular)
      window.removeEventListener('scroll', calcular, true)
    }
  }, [ancora])
  return caixa
}

function FiltrosFila({ ancora, viewAplicada, fila, opcoes, campanhaNome, onAplicar, onFechar }: {
  ancora: HTMLElement | null
  viewAplicada: FilaView
  fila: FilaItem[]
  opcoes: OpcoesDaFila
  campanhaNome: string
  onAplicar: (v: FilaView) => void
  onFechar: () => void
}) {
  // RASCUNHO: mexer nos controles não mexe na fila — só "Aplicar filtros" troca a view da tela.
  // Fechar (botão, clique fora, Escape) descarta o rascunho e mantém o que já estava aplicado.
  // O componente é montado/desmontado no toggle, então reabrir sempre parte do aplicado.
  const [rascunho, setRascunho] = useState<FilaView>(viewAplicada)
  const painelRef = useRef<HTMLDivElement | null>(null)
  const caixa = usePosicaoPainel(ancora)

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    // Clique dentro da âncora é ignorado aqui: o próprio botão faz o toggle, e tratar os dois
    // fecharia e reabriria no mesmo clique.
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (painelRef.current?.contains(alvo) || ancora?.contains(alvo)) return
      onFechar()
    }
    window.addEventListener('keydown', tecla)
    window.addEventListener('mousedown', fora)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('mousedown', fora)
    }
  }, [ancora, onFechar])

  if (typeof document === 'undefined' || !caixa) return null

  const set = (patch: Partial<FilaView>) => setRascunho((v) => ({ ...v, ...patch }))
  const nAtivos = contarFiltrosAtivos(rascunho)
  const previa = filtrarFila(fila, rascunho).length
  const pendente = !viewsIguais(rascunho, viewAplicada)
  // Só os status realmente presentes na fila — filtro que não casaria com ninguém é ruído.
  const statusOpcoes: [string, string][] = [
    ['todos', 'Todos os status'],
    ...opcoes.status.map((s) => [s, rotuloStatus(s)] as [string, string]),
  ]

  const corpo = (
    <>
      {/* Backdrop só no drawer: no desktop o painel é discreto e a fila continua clicável. */}
      {caixa.compacto && <div className="fixed inset-0 z-[75] bg-black/30" aria-hidden="true" />}
      <div ref={painelRef} role="dialog" aria-modal={caixa.compacto} aria-label="Filtrar fila"
        style={caixa.compacto
          ? { position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: caixa.maxH }
          : { position: 'fixed', left: caixa.left, top: caixa.top, width: caixa.larg, maxHeight: caixa.maxH }}
        className={`z-[80] flex flex-col border bg-white shadow-2xl ${caixa.compacto ? 'rounded-t-2xl' : 'rounded-2xl'}`}>

        <div className="flex items-start justify-between gap-3 rounded-t-2xl border-b bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">Filtrar fila</h3>
            <p className="text-[11px] text-slate-500">
              {nAtivos === 0 ? 'Nenhum filtro ativo' : `${nAtivos} filtro${nAtivos > 1 ? 's' : ''} ativo${nAtivos > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* "Limpar" volta à FILA PADRÃO (não iniciados), não a uma lista sem critério —
                zerar tudo devolveria ao operador leads que ele já trabalhou. */}
            <button onClick={() => setRascunho(filaPadrao())}
              className="rounded-lg border bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
              Limpar filtros
            </button>
            <button onClick={onFechar} aria-label="Fechar"
              className="text-xl leading-none text-slate-400 hover:text-slate-700">×</button>
          </div>
        </div>

        {/* min-h-0: sem isso o item flex não encolhe abaixo do conteúdo e a rolagem interna
            não acontece — o painel estouraria a altura máxima. */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <GrupoFiltro titulo="Operação">
            <SelFiltro label="Status" value={rascunho.status} onChange={(v) => set({ status: v })} opcoes={statusOpcoes} />
            <SelFiltro label="Tentativas de contato" value={rascunho.tentativas}
              onChange={(v) => set({ tentativas: v as FilaView['tentativas'] })} opcoes={TENTATIVAS_OPCOES} />
            <SelFiltro label="Próxima ação" value={rascunho.proximaAcao}
              onChange={(v) => set({ proximaAcao: v as FilaView['proximaAcao'] })} opcoes={PROXIMA_ACAO_OPCOES} />
            {/* Campanha NÃO ganha um segundo seletor: o controle já existe no topo da página e
                duplicar o mesmo estado em dois lugares confunde mais do que ajuda. A ordem
                também não é editável: quem ordena é o servidor, por prioridade comercial. */}
            <div className="sm:col-span-2 lg:col-span-3">
              <NotaFixa>
                Campanha: <b className="text-slate-700">{campanhaNome || '—'}</b> · troque no seletor do topo da página.
                <br />Ordem da fila: <b className="text-slate-700">maior prioridade primeiro</b> (definida pelo sistema).
              </NotaFixa>
            </div>
          </GrupoFiltro>

          <GrupoFiltro titulo="Contato" cols={2}>
            <SelFiltro label="E-mail disponível" value={rascunho.email} onChange={(v) => set({ email: v as FilaView['email'] })} opcoes={EMAIL_OPCOES} />
            {/* Telefone não é filtro: é requisito de ENTRADA, aplicado no servidor. */}
            <NotaFixa>Telefone válido é exigido para entrar na fila — todos os leads listados são discáveis.</NotaFixa>
          </GrupoFiltro>

          <GrupoFiltro titulo="Potencial comercial">
            <SelFiltro label="Faixa de prioridade" value={rascunho.prioridade}
              onChange={(v) => set({ prioridade: v as FilaView['prioridade'] })} opcoes={PRIORIDADE_OPCOES} />
            <FaixaNum label="Quantidade de avaliações" min={rascunho.avalMin} max={rascunho.avalMax}
              onMin={(v) => set({ avalMin: v })} onMax={(v) => set({ avalMax: v })} />
            <FaixaNum label="Faixa de nota" min={rascunho.notaMin} max={rascunho.notaMax} step={0.1} teto={5}
              onMin={(v) => set({ notaMin: v })} onMax={(v) => set({ notaMax: v })} />
          </GrupoFiltro>

          <GrupoFiltro titulo="Perfil do negócio" cols={2}>
            <div>
              <label className="mb-1 block text-[11px] text-slate-500">Localização (cidade ou endereço contém)</label>
              <input value={rascunho.local} onChange={(e) => set({ local: e.target.value })} placeholder="ex: Feira de Santana, Centro"
                className="w-full rounded-lg border px-2 py-1.5 text-sm" />
            </div>
            <SelFiltro label="Segmento" value={rascunho.nicho} onChange={(v) => set({ nicho: v })}
              opcoes={[['', 'Todos os segmentos'], ...opcoes.nichos.map((n) => [n, n] as [string, string])]} />
          </GrupoFiltro>

          <GrupoFiltro titulo="Presença digital" cols={2}>
            <SelFiltro label="Situação do site" value={rascunho.site} onChange={(v) => set({ site: v as FilaView['site'] })} opcoes={SITE_OPCOES} />
            <SelFiltro label="Redes sociais" value={rascunho.redes} onChange={(v) => set({ redes: v as FilaView['redes'] })} opcoes={REDES_OPCOES} />
          </GrupoFiltro>

          {/* Só aparece quando o dado existe na fila carregada. */}
          {opcoes.mostrarQualidadeDado && (
            <GrupoFiltro titulo="Qualidade do dado" cols={2}>
              {opcoes.origens.length > 0 && (
                <SelFiltro label="Origem do dado" value={rascunho.origem} onChange={(v) => set({ origem: v })}
                  opcoes={[['todas', 'Todas'], ...opcoes.origens.map((o) => [o, o] as [string, string])]} />
              )}
              {opcoes.temRecencia && (
                <SelFiltro label="Recência do dado" value={rascunho.recencia}
                  onChange={(v) => set({ recencia: v as FilaView['recencia'] })} opcoes={RECENCIA_OPCOES} />
              )}
            </GrupoFiltro>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-3">
          {/* Prévia: a contagem acompanha o rascunho, mas a LISTAGEM só muda no Aplicar —
              a fila não pode dançar embaixo do operador enquanto ele configura. */}
          <span className="text-xs text-slate-500">
            <b className="text-slate-800">{previa}</b> de {fila.length} lead(s) com estes filtros
            {pendente && <span className="ml-1 font-medium text-amber-600">· ainda não aplicado</span>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
            <button onClick={() => onAplicar(rascunho)}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
              Aplicar filtros
            </button>
          </div>
        </div>
      </div>
    </>
  )
  return createPortal(corpo, document.body)
}

// ── Rodapé de paginação da fila ──────────────────────────────────────────────────────
// Fila longa cansa e esconde onde o operador está. O recorte é client-side (a fila já veio
// inteira e ordenada por prioridade) — trocar de página NÃO refaz requisição e não recarrega
// a tela. Nada de rolagem infinita: o operador precisa saber o tamanho do trabalho.
// Desktop: resumo + navegação + seletor na mesma linha. Mobile: empilhado, com alvos de toque
// maiores (min-h 36px) — mesmo padrão discreto do rodapé da aba Acompanhamento.
function PaginacaoFila({ pg, onPagina, onPorPagina }: {
  pg: PaginaFila<FilaItem>
  onPagina: (p: number) => void
  onPorPagina: (n: number) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-slate-500">{resumoPaginacao(pg)}</span>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="hidden sm:inline">Itens por página</span>
          <span className="sm:hidden">Por página</span>
          <select value={pg.porPagina} onChange={(e) => onPorPagina(Number(e.target.value))}
            aria-label="Itens por página"
            className="min-h-[36px] rounded-lg border px-2 py-1 text-xs">
            {TAMANHOS_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => onPagina(pg.pagina - 1)} disabled={!pg.temAnterior}
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent">
            ◀ <span className="hidden sm:inline">Anterior</span>
          </button>
          <span className="px-1 text-xs text-slate-500" aria-live="polite">
            Página <b className="text-slate-700">{pg.pagina}</b> de {pg.totalPaginas}
          </span>
          <button onClick={() => onPagina(pg.pagina + 1)} disabled={!pg.temProxima}
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent">
            <span className="hidden sm:inline">Próxima</span> ▶
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CentralLigacoesPage() {
  const fb = useFeedback()
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [campanhaId, setCampanhaId] = useState('')
  const [detalhe, setDetalhe] = useState<CampanhaDetalhe | null>(null)
  const [fila, setFila] = useState<FilaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [operando, setOperando] = useState<FilaItem | null>(null)
  // Anotações rápidas de ligações já encerradas — visualização leve, à parte do registro
  // completo (`operando`/`OperacaoLigacao`). Guarda o lead para o modal buscar e exibir.
  const [verAnotacoes, setVerAnotacoes] = useState<LeadAcomp | null>(null)
  const [aba, setAba] = useState<'fila' | 'acompanhamento' | 'funil'>('fila')
  const [todosLeads, setTodosLeads] = useState<LeadAcomp[]>([])
  const [funil, setFunil] = useState<Funil | null>(null)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const POR_PAGINA = 25
  useEffect(() => { setPagina(1) }, [busca, statusFiltro, campanhaId, aba])
  // Filtros da fila, persistidos como no Banco de Leads: o operador não reconfigura a tela a
  // cada abertura. Só apresentação — nada aqui muda o que o servidor considera elegível
  // (telefone válido) nem a ordem por prioridade. Padrão: leads ainda não iniciados.
  const [view, setView] = useState<FilaView>(VIEW_PADRAO)
  // Paginação da FILA (separada da aba Acompanhamento, que tem a sua). Só recorte de
  // apresentação: não muda filtros, ordem nem faz requisição.
  const [paginaFila, setPaginaFila] = useState(1)
  const [porPaginaFila, setPorPaginaFila] = useState(POR_PAGINA_PADRAO)
  const [trocandoPagina, setTrocandoPagina] = useState(false)
  // Qualquer mudança no recorte volta para a primeira página: aplicar/remover/limpar filtro,
  // trocar de campanha ou de aba. Sem isso o operador cairia numa página vazia ou, pior,
  // no meio de uma lista que ele acabou de redefinir.
  useEffect(() => { setPaginaFila(1) }, [view, campanhaId, aba])
  // Pista visual curta na ÁREA DA TABELA. Não há requisição: o conteúdo já trocou, isto é só
  // a transição que evita o "pisca" de a lista inteira se substituir sem aviso.
  useEffect(() => {
    if (!trocandoPagina) return
    const t = setTimeout(() => setTrocandoPagina(false), 140)
    return () => clearTimeout(t)
  }, [trocandoPagina])
  const irParaPagina = useCallback((p: number) => { setPaginaFila(Math.max(1, p)); setTrocandoPagina(true) }, [])
  const trocarPorPagina = useCallback((n: number) => {
    setPorPaginaFila(normalizarPorPagina(n)); setPaginaFila(1); setTrocandoPagina(true)
    try { localStorage.setItem(CHAVE_POR_PAGINA, String(normalizarPorPagina(n))) } catch { /* quota/privado */ }
  }, [])
  const [painelFiltros, setPainelFiltros] = useState(false)
  // Âncora do painel flutuante. Fica aqui (topo do componente) porque a aba Fila é renderizada
  // dentro de uma IIFE — não dá para declarar hook lá dentro.
  const btnFiltrosRef = useRef<HTMLButtonElement | null>(null)
  const fecharPainel = useCallback(() => setPainelFiltros(false), [])
  // A tela de atendimento é um overlay `fixed inset-0`; o painel flutuante ficaria POR CIMA
  // dela e o Escape seria disputado pelos dois. Entrar em ligação fecha o painel.
  useEffect(() => { if (operando) setPainelFiltros(false) }, [operando])
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_VIEW)
      if (salvo) setView(normalizarView(JSON.parse(salvo)))
    } catch { /* view corrompida ⇒ padrão */ }
    try {
      const tam = localStorage.getItem(CHAVE_POR_PAGINA)
      if (tam) setPorPaginaFila(normalizarPorPagina(tam))
    } catch { /* tamanho corrompido ⇒ padrão */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(CHAVE_VIEW, JSON.stringify(view)) } catch { /* quota/privado */ }
  }, [view])

  useEffect(() => {
    apiFetch<Campanha[]>(`${base()}/campanhas`).then((r) => {
      setCampanhas(r.data)
      const ativa = r.data.find((c) => c.status === 'ativa') || r.data[0]
      if (ativa) setCampanhaId(ativa.id)
    }).catch((e) => fb.toast(msgErro(e, 'Não foi possível carregar as campanhas.'), 'error')).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const carregarCampanha = useCallback(async (id: string) => {
    if (!id) { setDetalhe(null); setFila([]); return }
    try {
      const [d, f, l, fu] = await Promise.all([
        apiFetch<CampanhaDetalhe>(`${base()}/campanhas/${id}`),
        // Fila inteira de uma vez (teto do servidor): os filtros da tela são client-side,
        // então precisam da lista completa para não esconder lead sem avisar.
        apiFetch<FilaItem[]>(`${base()}/campanhas/${id}/fila?limit=500`),
        apiFetch<LeadAcomp[]>(`${base()}/campanhas/${id}/leads`),
        apiFetch<Funil>(`${base()}/campanhas/${id}/funil`),
      ])
      setDetalhe(d.data); setFila(f.data); setTodosLeads(l.data); setFunil(fu.data)
    } catch (e) { fb.toast(msgErro(e, 'Não foi possível carregar a campanha.'), 'error') }
  }, [fb])

  useEffect(() => { carregarCampanha(campanhaId) }, [campanhaId, carregarCampanha])

  // Chegada vinda da fila de Follow-ups: `?campanha=<id>&lead=<campanha_lead_id>`.
  // É o que fecha a regra de roteamento — follow-up de ligação é operado pela fila e
  // EXECUTADO aqui, sem o operador ter de procurar o lead na campanha certa.
  // Lido no efeito (nunca no render, para não quebrar a hidratação) e no padrão que a
  // Aquisição já usa: `location.search` + `history.replaceState`, sem `useSearchParams`.
  const alvoRef = useRef<string | null>(null)
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const c = q.get('campanha')
      const l = q.get('lead')
      if (!c || !l) return
      alvoRef.current = l
      setCampanhaId(c)
      // Limpa a URL: um F5 depois de fechar a operação não pode reabri-la.
      window.history.replaceState({}, '', window.location.pathname)
    } catch { /* sem window/URL: navegação normal */ }
  }, [])

  // A fila chega depois da URL. Só quando ela existe dá para achar o lead e abrir a operação.
  // Lead fora da fila (já convertido, descartado ou sem telefone discável) NÃO abre nada e
  // avisa — abrir a operação de um lead que a campanha não trabalha mais seria mentira.
  useEffect(() => {
    const alvo = alvoRef.current
    if (!alvo || !fila.length) return
    alvoRef.current = null
    const item = fila.find((f) => f.campanha_lead_id === alvo)
    if (item) setOperando(item)
    else fb.toast('Este lead não está mais na fila desta campanha.', 'info')
  }, [fila, fb])

  const fecharOperacao = useCallback((recarrega: boolean) => {
    setOperando(null)
    if (recarrega) carregarCampanha(campanhaId)
  }, [campanhaId, carregarCampanha])

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Central de Ligações</h1>
          <p className="text-sm text-slate-500">Escolha a campanha, ligue para o próximo da fila e registre em poucos cliques.</p>
        </div>
        <select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Selecione a campanha…</option>
          {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome} {c.status === 'ativa' ? '• ativa' : ''}</option>)}
        </select>
      </div>

      {!detalhe ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">
          {campanhas.length === 0 ? 'Nenhuma campanha ainda. Crie uma campanha para começar a ligar.' : 'Selecione uma campanha acima.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Na fila" valor={fila.length} cor="text-brand" />
            <Card label="Reuniões marcadas" valor={detalhe.leads_por_status?.reuniao_marcada || 0} cor="text-emerald-600" />
            <Card label="Convertidos" valor={detalhe.leads_por_status?.convertido || 0} cor="text-emerald-700" />
            <Card label="Roteiro" valor={detalhe.roteiro_nome ? `v${detalhe.roteiro_versao}` : '—'} cor="text-slate-600" sub={detalhe.roteiro_nome || 'sem roteiro'} />
          </div>

          <div className="flex gap-2 border-b">
            {([['fila', `📞 Fila (${fila.length})`], ['acompanhamento', `📋 Acompanhamento (${todosLeads.length})`], ['funil', '📊 Funil']] as ['fila' | 'acompanhamento' | 'funil', string][]).map(([id, label]) => (
              <button key={id} onClick={() => setAba(id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${aba === id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>

          {aba === 'fila' && (() => {
            // Só apresentação: a fila já chega do servidor sem quem não tem telefone
            // discável e ordenada por prioridade. Aqui apenas recortamos a visão.
            const visiveis = filtrarFila(fila, view)
            const chips: ChipFiltro[] = chipsAtivos(view)
            const nFiltros = contarFiltrosAtivos(view)
            const opcoes = opcoesDaFila(fila)
            // O próximo a ligar é o 1º do conjunto FILTRADO INTEIRO, não o 1º da página aberta:
            // a fila é priorizada pelo servidor e navegar não pode trocar quem vem primeiro.
            const proximo = visiveis[0]
            // Paginar DEPOIS de filtrar: `filtrarFila` preserva a ordem de prioridade, então o
            // recorte sempre sai do conjunto completo já ordenado.
            const pg = paginar(visiveis, paginaFila, porPaginaFila)
            return (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={!proximo}
                    onClick={() => proximo && setOperando(proximo)}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                    ▶ Ligar agora {proximo ? `(${proximo.nome})` : ''}
                  </button>
                  <button onClick={() => carregarCampanha(campanhaId)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Atualizar</button>
                  {/* Compacto e colado no Atualizar, no padrão do Banco de Leads. Nenhum
                      controle de "visão" aqui: a listagem é sempre enxuta. O painel abre
                      FLUTUANTE (portal), ancorado neste botão — a tabela não se move. */}
                  <button ref={btnFiltrosRef} onClick={() => setPainelFiltros((v) => !v)} aria-expanded={painelFiltros}
                    className={`rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 ${nFiltros ? 'border-brand text-brand' : ''}`}>
                    ⚙ Filtros{nFiltros ? ` (${nFiltros})` : ''}
                  </button>
                </div>

                {chips.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {chips.map((c) => (
                      <button key={c.campo} onClick={() => setView(limparCampo(view, c.campo))}
                        title="Remover este filtro"
                        className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/5 px-2 py-0.5 text-xs text-brand hover:bg-brand/10">
                        {c.label} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                    {/* Restaura a FILA PADRÃO (não iniciados) — "limpar" aqui não devolve uma
                        lista sem critério. Para ver a fila inteira, remova o chip de tentativas. */}
                    {!viewsIguais(view, VIEW_PADRAO) && (
                      <button onClick={() => setView(filaPadrao())} className="text-xs text-slate-400 underline hover:text-slate-600">restaurar padrão</button>
                    )}
                  </div>
                )}

                {painelFiltros && (
                  <FiltrosFila ancora={btnFiltrosRef.current} viewAplicada={view} fila={fila}
                    opcoes={opcoes} campanhaNome={detalhe.nome}
                    onAplicar={(v) => { setView(v); setPainelFiltros(false) }} onFechar={fecharPainel} />
                )}

                {fila.length === 0 ? (
                  <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">Fila vazia — todos os leads com telefone válido desta campanha já foram trabalhados. 🎉</div>
                ) : visiveis.length === 0 ? (
                  <div className="space-y-2 rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">
                    <p>Nenhum lead com esses filtros.</p>
                    <div className="flex flex-wrap justify-center gap-3 text-sm">
                      <button onClick={() => setView(filaPadrao())} className="text-brand underline">Restaurar fila padrão</button>
                      <button onClick={() => setView(limparFiltros())} className="text-slate-400 underline hover:text-slate-600">Ver a fila inteira</button>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                    {visiveis.length !== fila.length && (
                      <div className="border-b px-4 py-2 text-xs text-slate-500">{visiveis.length} de {fila.length} lead(s) na fila</div>
                    )}
                    {/* Estado de carregamento leve: aria-busy + opacidade SÓ na tabela — a
                        troca de página não pisca a tela nem mexe na barra de filtros acima. */}
                    <table aria-busy={trocandoPagina}
                      className={`w-full text-sm transition-opacity duration-150 ${trocandoPagina ? 'opacity-50' : 'opacity-100'}`}>
                      <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Telefone</th>
                          <th className="px-4 py-3">Status</th><th className="px-4 py-3">Tentativas</th><th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {/* Destaque âmbar = o PRÓXIMO da fila (índice global 0), não o 1º da
                            página atual — senão a 2ª página fingiria ter um "próximo". */}
                        {pg.itens.map((l, i) => (
                          <tr key={l.campanha_lead_id} className={pg.offset + i === 0 ? 'bg-amber-50/40' : ''}>
                            <td className="px-4 py-3"><CirculoPrioridade p={l.prioridade} /></td>
                            <td className="px-4 py-3">
                              {/* Só nome + localização. O nicho já é contextualizado pela
                                  campanha ativa, e os dados enriquecidos vivem na tela de
                                  atendimento — a listagem fica enxuta e rápida de escanear. */}
                              <TextoTruncado texto={l.nome} className="max-w-[200px] font-medium text-slate-800" />
                              <div className="text-xs text-slate-400">{l.cidade || '—'}</div>
                            </td>
                            <td className="px-4 py-3 align-top"><Fone tel={l.telefone} className="text-sm" /></td>
                            <td className="px-4 py-3 align-top"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${clsStatus(l.status)}`}>{rotuloStatus(l.status)}</span></td>
                            <td className="px-4 py-3 align-top text-slate-500">{l.tentativas}</td>
                            <td className="px-4 py-3 text-right align-top"><button onClick={() => setOperando(l)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Ligar</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {mostrarPaginacao(pg.total, pg.porPagina) && (
                      <PaginacaoFila pg={pg} onPagina={irParaPagina} onPorPagina={trocarPorPagina} />
                    )}
                  </div>
                )}
              </>
            )
          })()}

          {aba === 'acompanhamento' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone…" className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm" />
                <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} className="rounded-lg border px-2 py-2 text-sm">
                  <option value="">Todos os status</option>
                  {STATUS_OP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={() => carregarCampanha(campanhaId)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Atualizar</button>
              </div>
              {(() => {
                const qn = busca.trim().toLowerCase()
                const qd = busca.replace(/\D/g, '')
                const filtrados = todosLeads.filter((l) =>
                  (!statusFiltro || l.status === statusFiltro) &&
                  (!qn || l.nome.toLowerCase().includes(qn) || (qd !== '' && (l.telefone || '').replace(/\D/g, '').includes(qd))))
                  // Descartado é status final (vermelho): vai para o FIM da lista, senão o lead
                  // que você acabou de descartar volta ao topo (ordem do servidor = atualizado_em
                  // DESC) e empurra o trabalho vivo para a página seguinte. Sort estável ⇒ dentro
                  // de cada grupo a ordem do servidor é preservada. Só apresentação.
                  .slice().sort((a, b) => Number(a.status === 'descartado') - Number(b.status === 'descartado'))
                if (filtrados.length === 0) {
                  return <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">Nenhum lead {busca || statusFiltro ? 'com esse filtro' : 'nesta campanha'}.</div>
                }
                const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
                const p = Math.min(pagina, totalPaginas)
                const pageItems = filtrados.slice((p - 1) * POR_PAGINA, p * POR_PAGINA)
                return (
                  <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                    <div className="border-b px-4 py-2 text-xs text-slate-500">{filtrados.length}{filtrados.length !== todosLeads.length ? ` de ${todosLeads.length}` : ''} lead(s)</div>
                    <table className="w-full text-sm">
                      <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Telefone</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Próxima ação</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3"></th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {pageItems.map((l) => (
                          <tr key={l.id}>
                            <td className="px-4 py-3">
                              <TextoTruncado texto={l.nome} className="max-w-[200px] font-medium text-slate-800" />
                              <div className="text-xs text-slate-400">{[l.nicho, l.cidade].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td className="px-4 py-3"><Fone tel={l.telefone} className="text-sm" /></td>
                            <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${clsStatus(l.status)}`}>{rotuloStatus(l.status)}</span></td>
                            {/* Texto livre: trunca em 1 linha (completo no title) para não ser
                                ele a esticar a altura da linha que acabamos de compactar. */}
                            <td className="max-w-[220px] truncate px-4 py-3 text-xs text-slate-500" title={l.proxima_acao || ''}>{l.proxima_acao || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {l.data_followup ? (
                                <>
                                  <div>{formatarQuando(l.data_followup) || '—'}</div>
                                  {/* Link, não fila: quem gerencia a próxima ação é a tela de
                                      Follow-ups. Aqui fica só o caminho até ela. */}
                                  <a href="/dashboard/follow-ups" className="text-brand hover:underline">Abrir no Follow-ups</a>
                                </>
                              ) : '—'}
                            </td>
                            {/* Espalha o lead inteiro: a tela de atendimento tem a mesma Visão
                                detalhada aberta pela fila, e sem os campos enriquecidos ela
                                abriria vazia por este caminho. Sem `prioridade`: esta lista
                                não é a fila de ligação (inclui convertido/descartado). */}
                            <td className="px-4 py-3 text-right">
                              <MenuRadialAcoes
                                rotuloContexto={l.nome}
                                acoes={[
                                  {
                                    id: 'notas', rotulo: 'Notas', zona: 'cima', tom: 'neutro',
                                    descricao: 'Ver as anotações rápidas já registradas nas ligações deste lead.',
                                    onSelecionar: () => setVerAnotacoes(l),
                                  },
                                  {
                                    id: 'registrar', rotulo: 'Registrar', zona: 'direita', tom: 'positivo',
                                    descricao: 'Abrir o registro completo desta ligação.',
                                    onSelecionar: () => setOperando({ ...l, campanha_lead_id: l.id, score: null, tentativas: 0 }),
                                  },
                                ]}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {totalPaginas > 1 && (
                      <div className="flex items-center justify-between border-t px-4 py-2">
                        <span className="text-xs text-slate-500">Página {p} de {totalPaginas} · {POR_PAGINA}/página</span>
                        <div className="flex gap-1">
                          <button onClick={() => setPagina(Math.max(1, p - 1))} disabled={p === 1} className="rounded border px-3 py-1 text-xs disabled:opacity-30">◀ Anterior</button>
                          <button onClick={() => setPagina(Math.min(totalPaginas, p + 1))} disabled={p === totalPaginas} className="rounded border px-3 py-1 text-xs disabled:opacity-30">Próxima ▶</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}

          {aba === 'funil' && <FunilPanel funil={funil} />}
        </>
      )}

      {operando && detalhe && (
        <OperacaoLigacao lead={operando} campanha={detalhe} onFechar={fecharOperacao} fb={fb} />
      )}
      {verAnotacoes && (
        <AnotacoesRapidasModal lead={verAnotacoes} onFechar={() => setVerAnotacoes(null)} fb={fb} />
      )}
    </div>
  )
}

function FunilPanel({ funil }: { funil: Funil | null }) {
  if (!funil || funil.total_ligacoes === 0) {
    return <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">Ainda não há ligações registradas nesta campanha. O funil aparece conforme você registra as ligações — mostrando em qual etapa cada ligação parou.</div>
  }
  const max = Math.max(1, ...ETAPA_ORDEM.map((e) => funil.encerraram[e] || 0))
  return (
    <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">Onde as ligações estão <b>parando</b> (etapa em que foram encerradas) e onde os leads <b>perdem interesse</b>. Total: {funil.total_ligacoes} ligação(ões).</div>
      <div className="space-y-2">
        {ETAPA_ORDEM.map((e) => {
          const enc = funil.encerraram[e] || 0
          const perd = funil.perderam[e] || 0
          if (enc === 0 && perd === 0) return null
          return (
            <div key={e} className="flex items-center gap-2">
              <div className="w-40 shrink-0 text-sm text-slate-600">{ETAPA_LABEL[e] || e}</div>
              <div className="h-5 flex-1 rounded bg-slate-100"><div className="h-5 rounded bg-brand/70" style={{ width: `${(enc / max) * 100}%` }} /></div>
              <div className="w-32 shrink-0 text-right text-xs text-slate-500">{enc} encerr.{perd ? ` · ${perd} 🔴` : ''}</div>
            </div>
          )
        })}
      </div>
      <div className="text-xs text-slate-400">🔴 = leads que perderam interesse naquela etapa. Barra = quantas ligações terminaram ali.</div>
    </div>
  )
}

function Card({ label, valor, cor, sub }: { label: string; valor: number | string; cor: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${cor}`}>{valor}</div>
      <div className="text-xs text-slate-500">{label}{sub ? ` · ${sub}` : ''}</div>
    </div>
  )
}

// Visualização leve das anotações rápidas ("notas") já registradas nas ligações
// ENCERRADAS deste lead — reusa o MESMO endpoint que `OperacaoLigacao` já consome
// (`GET /ligacoes?campanha_lead_id=`), sem rota nova. Existe para o operador consultar
// o que já foi anotado sem abrir o registro completo da ligação (que é uma tela cheia).
function AnotacoesRapidasModal({ lead, onFechar, fb }: {
  lead: LeadAcomp; onFechar: () => void; fb: ReturnType<typeof useFeedback>
}) {
  const [carregando, setCarregando] = useState(true)
  const [ligacoes, setLigacoes] = useState<Ligacao[]>([])
  const [copiado, setCopiado] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    apiFetch<Ligacao[]>(`${base()}/ligacoes?campanha_lead_id=${lead.id}`)
      .then((r) => { if (vivo) setLigacoes(r.data) })
      .catch((e) => { if (vivo) fb.toast(msgErro(e, 'Não foi possível carregar as anotações.'), 'error') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id])

  useEffect(() => {
    ref.current?.focus()
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [onFechar])

  const copiar = useCallback(async (id: string, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(id)
      setTimeout(() => setCopiado((atual) => (atual === id ? null : atual)), 1500)
    } catch { fb.toast('Não foi possível copiar neste navegador.', 'error') }
  }, [fb])

  const comNotas = ligacoes.filter((l) => (l.notas || '').trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Anotações rápidas — ${lead.nome}`}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Anotações rápidas</div>
            <div className="text-xs text-slate-500">{lead.nome}</div>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600"><IconClose className="h-5 w-5" /></button>
        </div>
        {carregando ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : comNotas.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">Nenhuma anotação registrada para este lead ainda.</div>
        ) : (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
            {comNotas.map((l) => (
              <li key={l.id} className="rounded-lg border p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">{new Date(l.criado_em).toLocaleString('pt-BR')}</span>
                  <button
                    onClick={() => copiar(l.id, l.notas || '')}
                    className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                  >
                    {copiado === l.id ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
                <div className="whitespace-pre-wrap text-sm text-slate-700">{l.notas}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}

function OperacaoLigacao({ lead, campanha, onFechar, fb }: {
  lead: FilaItem; campanha: CampanhaDetalhe; onFechar: (recarrega: boolean) => void; fb: ReturnType<typeof useFeedback>
}) {
  const [etapas, setEtapas] = useState<EtapaApi[]>([])
  const [historico, setHistorico] = useState<Ligacao[]>([])
  const [idx, setIdx] = useState(0)
  // Nível de detalhe do bloco do lead. Começa em 'simples': durante a ligação o que importa
  // primeiro é nome/telefone/status. Não é persistido — é escolha do atendimento atual.
  const [visao, setVisao] = useState<'simples' | 'detalhada'>('simples')
  // Sessão: visualizando → em_andamento → aguardando_resumo → encerrada.
  // 'visualizando' só existe aqui (abrir a tela não grava nada). Os outros três vêm do
  // servidor em `estado_sessao` — o front NUNCA decide sozinho se a chamada acabou. Antes,
  // "chamada encerrada" era só o booleano local `encerrando`, que o refresh perdia: a sessão
  // voltava como em_andamento, o cronômetro reiniciava e o resumo preenchido sumia.
  const [estado, setEstado] = useState<'visualizando' | 'em_andamento' | 'aguardando_resumo' | 'encerrada'>('visualizando')
  const [ligacaoId, setLigacaoId] = useState<string | null>(null)
  const [iniciadaEm, setIniciadaEm] = useState<string | null>(null)
  // Instante oficial do fim da chamada (servidor). Congela o cronômetro e é o marco da duração.
  const [chamadaEncerradaEm, setChamadaEncerradaEm] = useState<string | null>(null)
  const [encerrandoChamada, setEncerrandoChamada] = useState(false)
  // A chamada acabou e o resumo ainda não foi salvo.
  const encerrando = estado === 'aguardando_resumo'
  const [agora, setAgora] = useState(() => Date.now())
  const [confirmFechar, setConfirmFechar] = useState(false)
  const [iniciando, setIniciando] = useState(false)
  const iniciandoRef = useRef(false)
  const encerrandoRef = useRef(false)
  const clientEventIdRef = useRef('')
  // resumo
  const [resultado, setResultado] = useState('atendeu')
  const [novoStatus, setNovoStatus] = useState(lead.status)
  const [objecao, setObjecao] = useState('')
  const [motivo, setMotivo] = useState('')
  // Etapa "Proxima acao" do resumo. Substitui os dois campos soltos que existiam aqui
  // (um <input> de texto livre + um <input type="date">, gravados so' em
  // `app.campanha_leads` e invisiveis para a fila de Follow-ups). Agora e' uma decisao
  // estruturada — canal, prazo COM HORA, prioridade e responsavel — que vira item da fila.
  const [proxAcao, setProxAcao] = useState<FormProximaAcao>(() => sugerirProximaAcao('atendeu'))
  const [errosProxAcao, setErrosProxAcao] = useState<Record<string, string>>({})
  const [responsaveis, setResponsaveis] = useState<{ id: string; nome: string }[]>([])
  const [notas, setNotas] = useState('')
  const [perguntasReg, setPerguntasReg] = useState<PerguntaReg[]>([])
  // sinais (Fatia D) e objeções (Fatia E) estruturados: persistidos na hora; fonte da seleção.
  const [roteiroId, setRoteiroId] = useState<string | null>(null)
  const [sinaisReg, setSinaisReg] = useState<SinalReg[]>([])
  const [objecoesReg, setObjecoesReg] = useState<ObjecaoReg[]>([])
  // etapas temporais (Fatia B): a etapa ativa vem do servidor; navegação chama /etapas/trocar.
  const [etapaAtivaReId, setEtapaAtivaReId] = useState<string | null>(null)
  const [trocando, setTrocando] = useState(false)
  const trocandoRef = useRef(false)
  // registro rápido incremental (Fatia F): autosave das notas + indicador de sincronização.
  const [notasSync, setNotasSync] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedNotasRef = useRef<string | null>(null)

  useEffect(() => {
    if (campanha.roteiro_versao_id) {
      apiFetch<{ roteiro_id: string; etapas: EtapaApi[] }>(`${base()}/roteiros/versoes/${campanha.roteiro_versao_id}`).then((r) => { setEtapas(r.data.etapas || []); setRoteiroId(r.data.roteiro_id || null) }).catch(() => setEtapas([]))
    }
    apiFetch<Ligacao[]>(`${base()}/ligacoes?campanha_lead_id=${lead.campanha_lead_id}`).then((r) => setHistorico(r.data)).catch(() => {})
    // Responsaveis possiveis. Falha silenciosa de proposito: sem a lista, o campo fica
    // vazio ("Nao atribuido") e o encerramento continua funcionando — atribuir dono nunca
    // pode ser pre-requisito para registrar uma ligacao que ja aconteceu.
    apiFetch<{ itens: { id: string; nome: string }[] }>(`${base()}/follow-ups/responsaveis`)
      .then((r) => setResponsaveis(r.data.itens || [])).catch(() => setResponsaveis([]))
    // Recuperação: se já existe sessão recuperável deste lead, retoma (não duplica). O
    // `estado_sessao` do servidor decide se voltamos para a conversa ou para o resumo pendente.
    apiFetch<{ id: string; iniciada_em: string; chamada_encerrada_em: string | null; estado_sessao: string; notas: string | null } | null>(`${base()}/ligacoes/ativa?campanha_lead_id=${lead.campanha_lead_id}`).then((r) => {
      if (r.data && r.data.id) {
        const pendente = r.data.estado_sessao === 'aguardando_resumo'
        setLigacaoId(r.data.id); setIniciadaEm(r.data.iniciada_em)
        setChamadaEncerradaEm(r.data.chamada_encerrada_em || null)
        setEstado(pendente ? 'aguardando_resumo' : 'em_andamento')
        // Recupera o registro rápido já salvo (evita reenviar o mesmo valor no autosave).
        setNotas(r.data.notas || ''); lastSavedNotasRef.current = r.data.notas || ''
        fb.toast(pendente ? 'Retomando o resumo pendente — a chamada já foi encerrada' : 'Retomando ligação em andamento', 'info')
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cronômetro VISUAL — sempre reconstruído de iniciada_em (fonte oficial = servidor), nunca
  // do momento do refresh. Só roda enquanto a chamada está de fato acontecendo.
  useEffect(() => {
    if (estado !== 'em_andamento') return
    setAgora(Date.now())
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [estado])

  // Duração exibida: com a chamada encerrada, congela em chamada_encerrada_em (servidor) —
  // assim o tempo de preenchimento do resumo não aparece como tempo de ligação, e o valor
  // sobrevive a refresh sem "andar".
  const fimVisual = chamadaEncerradaEm ? new Date(chamadaEncerradaEm).getTime() : agora
  const segundosChamada = segDesde(iniciadaEm, fimVisual)

  // Proteção contra perda: avisa ao atualizar/fechar a aba com chamada ativa OU resumo pendente.
  useEffect(() => {
    if (estado !== 'em_andamento' && estado !== 'aguardando_resumo') return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [estado])

  // Sinais + objeções + etapa ativa (reconstrói a seleção/navegação ao iniciar OU retomar).
  useEffect(() => {
    if (!ligacaoId) { setSinaisReg([]); setObjecoesReg([]); setPerguntasReg([]); return }
    apiFetch<SinalReg[]>(`${base()}/ligacoes/${ligacaoId}/sinais`).then((r) => setSinaisReg(r.data || [])).catch(() => {})
    apiFetch<ObjecaoReg[]>(`${base()}/ligacoes/${ligacaoId}/objecoes`).then((r) => setObjecoesReg(r.data || [])).catch(() => {})
    apiFetch<PerguntaReg[]>(`${base()}/ligacoes/${ligacaoId}/perguntas`).then((r) => setPerguntasReg(r.data || [])).catch(() => {})
    apiFetch<{ roteiro_etapa_id: string } | null>(`${base()}/ligacoes/${ligacaoId}/etapas/ativa`).then((r) => { if (r.data?.roteiro_etapa_id) setEtapaAtivaReId(r.data.roteiro_etapa_id) }).catch(() => {})
  }, [ligacaoId])

  // Posiciona a navegação na etapa ativa devolvida pelo servidor (após carregar as etapas).
  useEffect(() => {
    if (!etapaAtivaReId || etapas.length === 0) return
    const i = etapas.findIndex((e) => e.id === etapaAtivaReId)
    if (i >= 0) setIdx(i)
  }, [etapaAtivaReId, etapas])

  // Autosave do registro rápido (Fatia F): last-write-wins, só durante a ligação; recuperável.
  const salvarNotas = useCallback(async (valor: string) => {
    if (!ligacaoId || estado !== 'em_andamento' || lastSavedNotasRef.current === valor) return
    setNotasSync('saving')
    try {
      await apiFetch(`${base()}/ligacoes/${ligacaoId}/notas`, { method: 'PATCH', body: JSON.stringify({ notas: valor }) })
      lastSavedNotasRef.current = valor
      setNotasSync('saved')
    } catch { setNotasSync('error') }
  }, [ligacaoId, estado])
  useEffect(() => {
    if (estado !== 'em_andamento' || !ligacaoId) return
    const t = setTimeout(() => salvarNotas(notas), 800) // debounce
    return () => clearTimeout(t)
  }, [notas, estado, ligacaoId, salvarNotas])

  const ativo = estado === 'em_andamento'
  const etapa = etapas[idx]
  // --- Perguntas estruturadas (marcar = feita; persistência imediata; só do roteiro) -----
  const perguntaAtiva = (indice: number) =>
    perguntasReg.find((p) => p.pergunta_indice === indice && (p.etapa_tipo || '') === (etapa?.tipo || ''))
  const registrarPergunta = async (indice: number, texto: string) => {
    if (!ativo || !ligacaoId || perguntaAtiva(indice)) return
    try {
      const r = await apiFetch<PerguntaReg>(`${base()}/ligacoes/${ligacaoId}/perguntas`, {
        method: 'POST',
        body: JSON.stringify({
          texto, pergunta_indice: indice, client_event_id: novoClientEventId(),
          roteiro_versao_id: campanha.roteiro_versao_id, roteiro_etapa_id: etapa?.id || null, etapa_tipo: etapa?.tipo || null,
        }),
      })
      setPerguntasReg((a) => (a.some((x) => x.id === r.data.id) ? a : [...a, r.data]))
    } catch (e) { fb.toast(msgErro(e, 'Não foi possível marcar a pergunta.'), 'error') }
  }
  const removerPergunta = async (id: string) => {
    setPerguntasReg((a) => a.filter((p) => p.id !== id)) // otimista
    try { await apiFetch(`${base()}/ligacoes/${ligacaoId}/perguntas/${id}`, { method: 'DELETE' }) } catch { /* */ }
  }
  const togglePergunta = (indice: number, texto: string) => {
    const ja = perguntaAtiva(indice)
    if (ja) removerPergunta(ja.id); else registrarPergunta(indice, texto)
  }

  // --- Sinais estruturados (persistência imediata no clique) -------------------------
  const sinalAtivo = (tipo: 'interesse' | 'resistencia', texto: string) =>
    sinaisReg.find((s) => s.tipo === tipo && s.texto.toLowerCase() === texto.trim().toLowerCase() && (s.etapa_tipo || '') === (etapa?.tipo || ''))
  const registrarSinal = async (tipo: 'interesse' | 'resistencia', texto: string, origem: 'roteiro' | 'novo_durante_ligacao') => {
    if (!ativo || !ligacaoId) return
    const t = texto.trim(); if (!t || sinalAtivo(tipo, t)) return // já selecionado → não duplica
    try {
      const r = await apiFetch<SinalReg>(`${base()}/ligacoes/${ligacaoId}/sinais`, {
        method: 'POST',
        body: JSON.stringify({
          tipo, texto: t, origem, client_event_id: novoClientEventId(),
          roteiro_versao_id: campanha.roteiro_versao_id, roteiro_id: roteiroId,
          roteiro_etapa_id: etapa?.id || null, etapa_tipo: etapa?.tipo || null,
        }),
      })
      setSinaisReg((a) => (a.some((x) => x.id === r.data.id) ? a : [...a, r.data]))
    } catch (e) { fb.toast(msgErro(e, 'Não foi possível registrar o sinal.'), 'error') }
  }
  const removerSinal = async (id: string) => {
    setSinaisReg((a) => a.filter((s) => s.id !== id)) // otimista
    try { await apiFetch(`${base()}/ligacoes/${ligacaoId}/sinais/${id}`, { method: 'DELETE' }) } catch { /* */ }
  }
  const toggleSinal = (tipo: 'interesse' | 'resistencia', texto: string, origem: 'roteiro' | 'novo_durante_ligacao') => {
    const ja = sinalAtivo(tipo, texto)
    if (ja) removerSinal(ja.id); else registrarSinal(tipo, texto, origem)
  }
  const novosDaEtapa = (tipo: 'interesse' | 'resistencia') =>
    sinaisReg.filter((s) => s.tipo === tipo && s.origem === 'novo_durante_ligacao' && (s.etapa_tipo || '') === (etapa?.tipo || '')).map((s) => s.texto)

  // --- Objeções estruturadas (persistência imediata; resposta + resolvida) ------------
  const objecaoAtiva = (texto: string) =>
    objecoesReg.find((o) => o.texto_objecao.toLowerCase() === texto.trim().toLowerCase() && (o.etapa_tipo || '') === (etapa?.tipo || ''))
  const registrarObjecao = async (texto: string, origem: 'roteiro' | 'novo_durante_ligacao', respostaSugerida?: string) => {
    if (!ativo || !ligacaoId) return
    const t = texto.trim(); if (!t || objecaoAtiva(t)) return
    try {
      const r = await apiFetch<ObjecaoReg>(`${base()}/ligacoes/${ligacaoId}/objecoes`, {
        method: 'POST',
        body: JSON.stringify({
          texto: t, origem, resposta_utilizada: respostaSugerida || null, client_event_id: novoClientEventId(),
          roteiro_versao_id: campanha.roteiro_versao_id, roteiro_id: roteiroId,
          roteiro_etapa_id: etapa?.id || null, etapa_tipo: etapa?.tipo || null,
        }),
      })
      setObjecoesReg((a) => (a.some((x) => x.id === r.data.id) ? a : [...a, r.data]))
    } catch (e) { fb.toast(msgErro(e, 'Não foi possível registrar a objeção.'), 'error') }
  }
  const removerObjecao = async (id: string) => {
    setObjecoesReg((a) => a.filter((o) => o.id !== id)) // otimista
    try { await apiFetch(`${base()}/ligacoes/${ligacaoId}/objecoes/${id}`, { method: 'DELETE' }) } catch { /* */ }
  }
  const toggleObjecao = (texto: string, origem: 'roteiro' | 'novo_durante_ligacao', respostaSugerida?: string) => {
    const ja = objecaoAtiva(texto)
    if (ja) removerObjecao(ja.id); else registrarObjecao(texto, origem, respostaSugerida)
  }
  const patchObjecao = async (id: string, patch: { resposta_utilizada?: string; resolvida?: boolean }) => {
    setObjecoesReg((a) => a.map((o) => (o.id === id ? { ...o, ...('resolvida' in patch ? { resolvida: !!patch.resolvida } : {}), ...('resposta_utilizada' in patch ? { resposta_utilizada: patch.resposta_utilizada ?? null } : {}) } : o))) // otimista
    try { await apiFetch(`${base()}/ligacoes/${ligacaoId}/objecoes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }) }
    catch (e) { fb.toast(msgErro(e, 'Não foi possível atualizar a objeção.'), 'error') }
  }
  const objecoesDaEtapa = objecoesReg.filter((o) => (o.etapa_tipo || '') === (etapa?.tipo || ''))

  // Encerrada NA ETAPA que está aberta agora.
  const etapaAlcancada = etapa?.tipo || (etapas[idx - 1]?.tipo)
  // Interesse/resistência vêm SÓ dos sinais persistidos (fonte única) — por isso sobrevivem
  // ao refresh. Aqui é só exibição; o que fica gravado é a derivação equivalente do servidor.
  const { interesse: nInteresse, resistencia: nResistencia, etapaMaiorInteresse, etapaPerda } = resumoSinais(sinaisReg)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (encerrando && !objecao && objecoesReg[0]) setObjecao(objecoesReg[0].texto_objecao) }, [encerrando])

  // Resultado e status eram 3 campos independentes: dava para salvar combinação contraditória.
  // "Número inválido" é disposição da chamada; a oportunidade telefônica acaba junto — mas o
  // lead NÃO é excluído (outros canais leem prospects, não campanha_leads). Sugestão editável.
  const trocarResultado = (v: string) => {
    setResultado(v)
    if (v === 'numero_invalido') { setNovoStatus('descartado'); setMotivo('') }
    // Sugestao, nao decisao: todos os campos seguem editaveis e "Sem proxima acao" fica a um
    // clique. Existe para o caso comum nao exigir digitacao.
    setProxAcao(sugerirProximaAcao(v))
    setErrosProxAcao({})
  }
  // Sai de um status de perda ⇒ limpa o motivo, senão um valor escondido seria enviado.
  const trocarStatus = (v: string) => {
    setNovoStatus(v)
    if (!STATUS_PERDA.has(v)) setMotivo('')
  }

  function novoClientEventId(): string {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID() } catch { /* */ }
    return 'cid-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  }

  // Início EXPLÍCITO: cria a ligação em_andamento (idempotente por client_event_id).
  const iniciar = useCallback(async () => {
    // Guarda síncrona (ref) contra duplo disparo + estado que DESABILITA o botão no request.
    if (estado !== 'visualizando' || iniciandoRef.current) return
    iniciandoRef.current = true; setIniciando(true)
    if (!clientEventIdRef.current) clientEventIdRef.current = novoClientEventId() // 1 client_event_id por operação
    try {
      const r = await apiFetch<{ id: string; iniciada_em: string; chamada_encerrada_em: string | null; estado_sessao: string; notas: string | null; etapa_ativa: { roteiro_etapa_id: string } | null }>(`${base()}/ligacoes/iniciar`, {
        method: 'POST',
        body: JSON.stringify({
          campanha_id: campanha.id, campanha_lead_id: lead.campanha_lead_id, prospect_id: lead.prospect_id,
          telefone: lead.telefone, roteiro_versao_id: campanha.roteiro_versao_id, client_event_id: clientEventIdRef.current,
        }),
      })
      // Estado (e cronômetro) só mudam APÓS sucesso real do backend, e seguem o estado_sessao
      // dele: /iniciar é idempotente e pode devolver uma sessão cujo resumo já está pendente —
      // nesse caso abrimos o resumo, não a conversa.
      setLigacaoId(r.data.id); setIniciadaEm(r.data.iniciada_em)
      setChamadaEncerradaEm(r.data.chamada_encerrada_em || null)
      setEstado(r.data.estado_sessao === 'aguardando_resumo' ? 'aguardando_resumo' : 'em_andamento')
      if (r.data.notas) { setNotas(r.data.notas); lastSavedNotasRef.current = r.data.notas }
      if (r.data.etapa_ativa?.roteiro_etapa_id) setEtapaAtivaReId(r.data.etapa_ativa.roteiro_etapa_id)
    } catch (e) {
      // Falha NÃO muda o estado (segue 'visualizando'); uma única mensagem operacional.
      if (typeof console !== 'undefined') console.error('[iniciar ligação]', e)
      fb.toast(msgErro(e, 'Não foi possível iniciar a ligação. Tente novamente.'), 'error')
    } finally { iniciandoRef.current = false; setIniciando(false) }
  }, [estado, campanha, lead, fb])

  // Navegação de etapas = troca temporal no servidor (fecha a ativa, abre a destino). Otimista,
  // com guarda contra duplo clique; em erro, restaura a etapa anterior.
  const irParaEtapa = useCallback(async (destIdx: number) => {
    if (!ativo || trocandoRef.current || destIdx < 0 || destIdx >= etapas.length || destIdx === idx) return
    const alvo = etapas[destIdx]
    if (!alvo || !ligacaoId) return
    trocandoRef.current = true; setTrocando(true)
    const prev = idx
    setIdx(destIdx)
    try {
      const r = await apiFetch<{ roteiro_etapa_id: string }>(`${base()}/ligacoes/${ligacaoId}/etapas/trocar`, {
        method: 'POST', body: JSON.stringify({ roteiro_etapa_id: alvo.id, client_event_id: novoClientEventId() }),
      })
      if (r.data?.roteiro_etapa_id) setEtapaAtivaReId(r.data.roteiro_etapa_id)
    } catch (e) { setIdx(prev); fb.toast(msgErro(e, 'Não foi possível trocar de etapa.'), 'error') }
    finally { trocandoRef.current = false; setTrocando(false) }
  }, [ativo, etapas, idx, ligacaoId, fb])

  // A CHAMADA terminou: marca o instante no servidor ANTES de abrir o resumo, senão todo o
  // tempo de preenchimento entraria na duração da ligação e da última etapa. Só depois abre
  // o formulário — e mesmo se a marcação falhar, o operador não fica preso (cai no NOW()).
  // A transição para 'aguardando_resumo' é do SERVIDOR: só mudamos a tela depois que ele
  // grava chamada_encerrada_em e fecha a etapa ativa (na mesma transação). Antes isto era
  // `setEncerrando(true)` local e otimista — que o refresh perdia. Em falha, a tela continua
  // na chamada e o operador pode tentar de novo, em vez de ficar num estado que o servidor
  // desconhece. É idempotente: o servidor mantém o instante do PRIMEIRO clique.
  const encerrarChamada = useCallback(async () => {
    if (!ligacaoId || estado !== 'em_andamento' || encerrandoChamada) return
    setEncerrandoChamada(true)
    try {
      const r = await apiFetch<{ chamada_encerrada_em: string; estado_sessao: string }>(
        `${base()}/ligacoes/${ligacaoId}/chamada-encerrada`, { method: 'POST' })
      setChamadaEncerradaEm(r.data.chamada_encerrada_em)
      setEstado('aguardando_resumo')
    } catch (e) {
      if (typeof console !== 'undefined') console.error('[fim de chamada]', e)
      fb.toast(msgErro(e, 'Não foi possível encerrar a chamada. Tente novamente.'), 'error')
    } finally { setEncerrandoChamada(false) }
  }, [ligacaoId, estado, encerrandoChamada, fb])

  // Encerramento: idempotente (guard por ref + status no backend). Só fecha em sucesso.
  const salvar = useCallback(async () => {
    // Só a partir do resumo pendente — a chamada precisa ter sido encerrada antes.
    if (!ligacaoId || estado !== 'aguardando_resumo' || encerrandoRef.current) return
    encerrandoRef.current = true
    // Perguntas/sinais/objeções agora são estruturados; notas = só conteúdo realmente livre.
    // etapa_maior_interesse / etapa_perda_interesse NÃO são enviados: o servidor os deriva
    // dos sinais ativos (fonte única), então não dependem do estado desta aba.
    const notasFinais = notas.trim() || null
    // Validacao local so' para o operador nao perder o resumo inteiro num 400; a validacao
    // de verdade e a do backend (fonte unica).
    const checagem = validarProximaAcao(proxAcao)
    if (!checagem.ok) {
      setErrosProxAcao(checagem.erros)
      fb.toast('Revise a próxima ação antes de salvar.', 'error')
      encerrandoRef.current = false
      return
    }
    setErrosProxAcao({})
    const followUp = montarPayloadProximaAcao(proxAcao)
    try {
      const r = await apiFetch<{ follow_up: FollowUpApi | null }>(
        `${base()}/ligacoes/${ligacaoId}/encerrar`, {
          method: 'POST',
          body: JSON.stringify({
            resultado,
            etapa_alcancada: etapaAlcancada || null,
            objecao_principal: objecao || objecoesReg[0]?.texto_objecao || null,
            motivo_perda: motivo || null, notas: notasFinais,
            novo_status_oportunidade: novoStatus || null,
            // A proxima acao vai ESTRUTURADA. O backend deriva dela o resumo gravado em
            // `app.campanha_leads`, para as duas telas nao divergirem sobre o combinado.
            follow_up: followUp,
          }),
        })
      const criado = r.data?.follow_up
      fb.toast(criado
        ? `Ligação registrada · ${resumoProximaAcao(criado)}`
        : 'Ligação registrada', 'success')
      setEstado('encerrada')
      onFechar(true)
    } catch (e) { fb.toast(msgErro(e, 'Não foi possível encerrar a ligação.'), 'error') }
    finally { encerrandoRef.current = false }
  }, [ligacaoId, estado, fb, resultado, etapaAlcancada, objecao, objecoesReg, motivo, notas, novoStatus, proxAcao, onFechar])

  // Descarte: fica só para auditoria (fora da analítica).
  const descartar = useCallback(async () => {
    if (!ligacaoId) { onFechar(false); return }
    try { await apiFetch(`${base()}/ligacoes/${ligacaoId}/descartar`, { method: 'POST', body: JSON.stringify({ motivo: 'descartada_pelo_operador' }) }) } catch { /* */ }
    onFechar(true)
  }, [ligacaoId, onFechar])

  // X (fechar interface) ≠ Encerrar. Confirma tanto com a chamada rolando quanto com o
  // resumo pendente — nos dois casos há sessão viva que sairia da analítica se descartada.
  const tentarFechar = useCallback(() => {
    if (estado === 'em_andamento' || estado === 'aguardando_resumo') { setConfirmFechar(true); return }
    onFechar(estado === 'encerrada')
  }, [estado, onFechar])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <div className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <TextoTruncado texto={lead.nome} className="max-w-[280px] text-lg font-semibold" />
            <span className="shrink-0 text-sm text-slate-400">· {campanha.nome}</span>
          </div>
          {/* Cronômetro: pulsando enquanto a chamada corre; congelado no fim da chamada. */}
          {estado === 'em_andamento' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> ⏱ {fmtCronometro(segundosChamada)}
            </span>
          )}
          {estado === 'aguardando_resumo' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
              ⏱ {fmtCronometro(segundosChamada)} · chamada encerrada · resumo pendente
            </span>
          )}
          {estado === 'visualizando' && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">Visualizando — a ligação ainda não começou</span>}
        </div>
        <div className="flex items-center gap-2">
          {estado === 'visualizando' && (
            <button onClick={iniciar} disabled={iniciando} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{iniciando ? 'Iniciando…' : '▶ Iniciar ligação'}</button>
          )}
          {estado === 'em_andamento' && (
            <button onClick={encerrarChamada} disabled={encerrandoChamada} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{encerrandoChamada ? 'Encerrando…' : 'Encerrar ligação'}</button>
          )}
          {estado === 'aguardando_resumo' && (
            <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-800">Conclua o resumo →</span>
          )}
          <button onClick={tentarFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600"><IconClose className="h-6 w-6" /></button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto p-4 lg:grid-cols-[280px_1fr_320px]">
        {/* Lead — é AQUI que vive a alternância de visão (nunca na listagem da fila). */}
        <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase text-slate-400">Lead</div>
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Nível de detalhe do lead">
              {([['simples', 'Simples'], ['detalhada', 'Detalhada']] as ['simples' | 'detalhada', string][]).map(([m, label]) => (
                <button key={m} onClick={() => setVisao(m)} aria-pressed={visao === m}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${visao === m ? 'bg-brand text-white' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <TextoTruncado texto={lead.nome} className="max-w-full text-lg font-semibold" />
          <div className="text-sm text-slate-600">📞 <Fone tel={lead.telefone} /></div>
          {lead.cidade && <div className="text-sm text-slate-500">📍 {lead.cidade}</div>}
          <div className="text-sm text-slate-500">
            <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${clsStatus(lead.status)}`}>{rotuloStatus(lead.status)}</span>
          </div>
          <div className="text-sm text-slate-500">Tentativas: {lead.tentativas}</div>
          {/* Visão detalhada: sinais enriquecidos que já existem no cadastro, para orientar
              a conversa. Nada é coletado ao abrir — é só reapresentação. */}
          {visao === 'detalhada' && <LeadDetalhes l={lead} />}
          <div className="border-t pt-2">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-400">Ligações anteriores</div>
            {historico.length === 0 ? <div className="text-xs text-slate-400">Nenhuma.</div>
              : historico.map((h) => <div key={h.id} className="text-xs text-slate-500">{new Date(h.criado_em).toLocaleDateString('pt-BR')} — {RESULTADOS.find((r) => r[0] === h.resultado)?.[1] || h.resultado}{h.motivo_perda ? ` (${h.motivo_perda})` : ''}</div>)}
          </div>
        </div>

        {/* Roteiro */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          {etapas.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">Esta campanha não tem um roteiro publicado com etapas.<br />Você ainda pode registrar a ligação à direita.</div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-brand">
                  Etapa {idx + 1}/{etapas.length}: {ETAPA_LABEL[etapa?.tipo] || etapa?.tipo}
                  {trocando && <span className="text-xs font-normal text-slate-400">salvando…</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => irParaEtapa(idx - 1)} disabled={!ativo || idx === 0 || trocando} className="rounded border px-2 py-1 text-xs disabled:opacity-30">◀ Voltar</button>
                  <button onClick={() => irParaEtapa(idx + 1)} disabled={!ativo || idx === etapas.length - 1 || trocando} className="rounded bg-brand px-2 py-1 text-xs text-white disabled:opacity-30">Avançar ▶</button>
                </div>
              </div>
              {etapa?.titulo && <div className="font-medium">{etapa.titulo}</div>}
              {etapa?.objetivo && <div className="mb-2 text-sm text-slate-500">🎯 {etapa.objetivo}</div>}
              {etapa?.frase_sugerida && <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm italic text-slate-700">“{etapa.frase_sugerida}”</div>}
              <div className="grid gap-3 md:grid-cols-2">
                {etapa?.perguntas_json?.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-500">Perguntas — clique nas que você fez</div>
                    <div className="flex flex-wrap gap-1">
                      {etapa.perguntas_json.map((q, i) => {
                        const feita = !!perguntaAtiva(i)
                        return (
                          <button key={i} onClick={() => togglePergunta(i, q)} disabled={!ativo} className={`rounded-full border px-2 py-1 text-left text-xs ${feita ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50'} ${!ativo ? 'opacity-60' : ''}`}>{feita ? '✓ ' : ''}{q}</button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="md:col-span-2">
                  <ObjecaoGroup itensRoteiro={etapa?.objecoes_json || []} registradas={objecoesDaEtapa} ativo={ativo}
                    estaAtiva={(t) => !!objecaoAtiva(t)} onToggle={(t, o) => toggleObjecao(t, o)}
                    onNovo={(t) => registrarObjecao(t, 'novo_durante_ligacao')}
                    onResposta={(id, r) => patchObjecao(id, { resposta_utilizada: r })}
                    onResolvida={(id, v) => patchObjecao(id, { resolvida: v })} />
                </div>
                <SinalGroup titulo="Sinais de interesse 🟢" cor="emerald" itensRoteiro={etapa?.sinais_interesse_json || []} novos={novosDaEtapa('interesse')} ativo={ativo}
                  estaAtivo={(t) => !!sinalAtivo('interesse', t)} onToggle={(t, o) => toggleSinal('interesse', t, o)} onNovo={(t) => registrarSinal('interesse', t, 'novo_durante_ligacao')} />
                <SinalGroup titulo="Sinais de resistência 🔴" cor="red" itensRoteiro={etapa?.sinais_resistencia_json || []} novos={novosDaEtapa('resistencia')} ativo={ativo}
                  estaAtivo={(t) => !!sinalAtivo('resistencia', t)} onToggle={(t, o) => toggleSinal('resistencia', t, o)} onNovo={(t) => registrarSinal('resistencia', t, 'novo_durante_ligacao')} />
              </div>
              <div className="mt-auto space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-slate-400">Registro nesta etapa · {ETAPA_LABEL[etapa?.tipo] || etapa?.tipo}</div>
                  {estado === 'visualizando' && <span className="text-xs text-amber-600">Inicie a ligação para registrar</span>}
                  {estado === 'aguardando_resumo' && <span className="text-xs font-medium text-amber-700">🔒 Somente leitura — a chamada foi encerrada</span>}
                </div>
                <div className="text-xs text-slate-400">{nInteresse}🟢 interesse · {nResistencia}🔴 resistência · {objecoesReg.length} objeção · {perguntasReg.length} pergunta(s) — tudo salvo na hora</div>
              </div>
            </div>
          )}
        </div>

        {/* Registro / Resumo */}
        <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          {estado === 'visualizando' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
              <div className="text-4xl">📞</div>
              <div className="text-sm text-slate-500">Você está <b>visualizando</b> o roteiro.<br />Nada é gravado até iniciar a ligação.</div>
              <button onClick={iniciar} disabled={iniciando} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{iniciando ? 'Iniciando…' : '▶ Iniciar ligação'}</button>
            </div>
          ) : !encerrando ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase text-slate-400">Registro rápido</div>
                <span className="text-xs text-slate-400">{notasSync === 'saving' ? 'salvando…' : notasSync === 'saved' ? '✓ salvo' : notasSync === 'error' ? '⚠ erro ao salvar' : ''}</span>
              </div>
              <textarea className="w-full rounded-lg border px-2 py-1.5 text-sm" rows={4} placeholder="Anotações durante a ligação…" value={notas} onChange={(e) => setNotas(e.target.value)} onBlur={() => salvarNotas(notas)} />
              {(objecoesReg.length > 0 || perguntasReg.length > 0 || sinaisReg.length > 0) && (
                <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                  {nInteresse}🟢 · {nResistencia}🔴 · {objecoesReg.length} objeção · {perguntasReg.length} pergunta(s)
                </div>
              )}
              <div className="text-xs text-slate-400">Marque sinais e objeções direto no roteiro (chips) conforme a conversa. Ao <b>Encerrar ligação</b>, a etapa em que você parar fica registrada.</div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold uppercase text-slate-400">Resumo da ligação</div>
              <div className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">Encerrada na etapa: <b>{ETAPA_LABEL[etapaAlcancada || ''] || '—'}</b></div>
              <label className="block text-sm">Resultado
                <select value={resultado} onChange={(e) => trocarResultado(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">{RESULTADOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              {resultado === 'numero_invalido' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Descarta a oportunidade <b>só para a prospecção por telefone</b>. O lead continua na base e
                  segue disponível para WhatsApp e e-mail. Descreva o que a operadora informou nas notas.
                </div>
              )}
              <label className="block text-sm">Status da oportunidade
                <select value={novoStatus} onChange={(e) => trocarStatus(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">{STATUS_OP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
              <input className="w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Objeção principal" value={objecao} onChange={(e) => setObjecao(e.target.value)} />
              {/* Motivo de perda só faz sentido quando o status É perda — evita gravar motivo
                  em lead que segue vivo (o que inflava a contagem de perdas). */}
              {STATUS_PERDA.has(novoStatus) && (
                <label className="block text-sm">Motivo de perda
                  <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"><option value="">—</option>{MOTIVOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
              )}
              <ProximaAcaoCampos
                form={proxAcao}
                erros={errosProxAcao}
                responsaveis={responsaveis}
                onPatch={(patch) => { setProxAcao((f) => ({ ...f, ...patch })); setErrosProxAcao({}) }}
              />
              <div className="text-xs text-slate-400">{etapaMaiorInteresse ? `Maior interesse: ${ETAPA_LABEL[etapaMaiorInteresse]}. ` : ''}{etapaPerda ? `Perdeu interesse: ${ETAPA_LABEL[etapaPerda]}.` : ''}</div>
              <button onClick={salvar} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"><IconSend className="h-4 w-4" /> Salvar ligação</button>
              {/* Sem "Voltar ao roteiro": a chamada já terminou e não pode ser reaberta. O
                  roteiro segue visível ao lado, em modo somente leitura. */}
              <div className="text-center text-[11px] text-slate-400">O roteiro ao lado fica em consulta — a chamada já foi encerrada.</div>
            </>
          )}
        </div>
      </div>

      {confirmFechar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-lg font-semibold">Existe uma ligação em andamento</div>
            <p className="mt-2 text-sm text-slate-600">Esta ligação ainda não foi encerrada. Ao descartar a operação, os registros não serão considerados nas métricas comerciais nem nas análises futuras.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => setConfirmFechar(false)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Voltar para a ligação</button>
              <button onClick={() => { setConfirmFechar(false); descartar() }} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Descartar operação</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Etapa "Próxima ação" do resumo ─────────────────────────
// Curta de propósito: canal, o que fazer, quando, prioridade e responsável. É o que cria o
// item na fila de Follow-ups — e é TUDO o que a Central de Ligações faz a respeito dela.
// A tela de ligações não vira fila de mensagens: quem gerencia a fila é /dashboard/follow-ups.
function ProximaAcaoCampos({ form, erros, responsaveis, onPatch }: {
  form: FormProximaAcao
  erros: Record<string, string>
  responsaveis: { id: string; nome: string }[]
  onPatch: (patch: Partial<FormProximaAcao>) => void
}) {
  const escolhida = CANAL_OPCOES.find((o) => o.valor === form.canal) || CANAL_OPCOES[0]
  const semAcao = form.canal === 'nenhuma'
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="text-xs font-semibold uppercase text-slate-500">Próxima ação</div>
      <div className="inline-flex w-full rounded-lg border bg-white p-0.5" role="group" aria-label="Canal da próxima ação">
        {CANAL_OPCOES.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => onPatch({ canal: o.valor })}
            aria-pressed={form.canal === o.valor}
            title={o.ajuda}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${form.canal === o.valor ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* A consequência de cada escolha fica escrita, não só implícita na cor do botão. */}
      <p className="text-[11px] text-slate-500">{escolhida.ajuda}</p>

      {!semAcao && (
        <>
          <label className="block text-sm">O que fazer
            <input
              className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${erros.proxima_acao ? 'border-red-400' : ''}`}
              placeholder="Ex.: retomar pelo preço"
              value={form.proxima_acao}
              aria-invalid={!!erros.proxima_acao}
              onChange={(e) => onPatch({ proxima_acao: e.target.value })}
            />
            {erros.proxima_acao && <span className="mt-0.5 block text-[11px] text-red-600">{erros.proxima_acao}</span>}
          </label>
          {/* datetime-local, não date: "amanhã às 10h" é o compromisso real; só a data
              perderia a hora e a fila não saberia dizer o que é para agora. */}
          <label className="block text-sm">Quando
            <input
              type="datetime-local"
              className={`mt-1 w-full rounded-lg border px-2 py-1.5 text-sm ${erros.agendado_para ? 'border-red-400' : ''}`}
              value={form.agendado_para}
              aria-invalid={!!erros.agendado_para}
              onChange={(e) => onPatch({ agendado_para: e.target.value })}
            />
            {erros.agendado_para && <span className="mt-0.5 block text-[11px] text-red-600">{erros.agendado_para}</span>}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">Prioridade
              <select
                className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                value={form.prioridade || 'media'}
                onChange={(e) => onPatch({ prioridade: e.target.value as FormProximaAcao['prioridade'] })}
              >
                {PRIORIDADE_FOLLOWUP_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">Responsável
              <select
                className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                value={form.responsavel_id}
                onChange={(e) => onPatch({ responsavel_id: e.target.value })}
              >
                {/* Sem dono é estado legítimo e filtrável na fila — não uma pendência. */}
                <option value="">Não atribuído</option>
                {responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            Entra na fila de <b>Follow-ups</b>. Esta tela só guarda o resumo.
          </p>
        </>
      )}
    </div>
  )
}

// Grupo de sinais (interesse/resistência) na PRÓPRIA seção do roteiro: chips clicáveis +
// botão ＋ para criar um sinal na hora. Selecionar/criar persiste imediatamente (Fatia D);
// o selecionado fica destacado. Sem lista de histórico durante a chamada (só chips).
function SinalGroup({ titulo, cor, itensRoteiro, novos, ativo, estaAtivo, onToggle, onNovo }: {
  titulo: string; cor: 'emerald' | 'red'; itensRoteiro: string[]; novos: string[]; ativo: boolean
  estaAtivo: (texto: string) => boolean
  onToggle: (texto: string, origem: 'roteiro' | 'novo_durante_ligacao') => void
  onNovo: (texto: string) => void
}) {
  const [add, setAdd] = useState(false)
  const [txt, setTxt] = useState('')
  const extras = novos.filter((n) => !itensRoteiro.some((r) => r.toLowerCase() === n.toLowerCase()))
  const chips = [
    ...itensRoteiro.map((t) => ({ t, origem: 'roteiro' as const })),
    ...extras.map((t) => ({ t, origem: 'novo_durante_ligacao' as const })),
  ]
  if (!ativo && chips.length === 0) return null
  const confirmar = () => { const t = txt.trim(); if (t) { onNovo(t); setTxt(''); setAdd(false) } }
  const selCls = cor === 'emerald' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-red-400 bg-red-50 text-red-700'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">{titulo}</div>
        {ativo && <button onClick={() => setAdd((v) => !v)} title="Adicionar sinal" className="rounded-full border px-2 text-sm leading-5 text-slate-500 hover:bg-slate-50">＋</button>}
      </div>
      {ativo && add && (
        <div className="mb-1 flex gap-1">
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') { setTxt(''); setAdd(false) } }}
            placeholder="Novo sinal…" className="w-full rounded-lg border px-2 py-1 text-xs" />
          <button onClick={confirmar} className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-medium text-white">Salvar</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {chips.length === 0 && <span className="text-xs text-slate-300">Nenhum — use ＋ para adicionar.</span>}
        {chips.map(({ t, origem }, i) => {
          const sel = estaAtivo(t)
          return (
            <button key={t + i} disabled={!ativo} onClick={() => onToggle(t, origem)}
              className={`rounded-full border px-2 py-1 text-left text-xs ${sel ? selCls : 'hover:bg-slate-50'} ${!ativo ? 'opacity-60' : ''}`}>
              {sel ? '✓ ' : ''}{t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Objeções na própria seção do roteiro (Fatia E): chips clicáveis + ＋ para criar na hora.
// Selecionar/criar persiste imediatamente. Cada objeção selecionada abre um detalhe com
// "resposta utilizada" (opcional, salva no blur) e "resolvida" (toggle). Soft-remove ao desmarcar.
function ObjecaoGroup({ itensRoteiro, registradas, ativo, estaAtiva, onToggle, onNovo, onResposta, onResolvida }: {
  itensRoteiro: ObjecaoRoteiro[]; registradas: ObjecaoReg[]; ativo: boolean
  estaAtiva: (texto: string) => boolean
  onToggle: (texto: string, origem: 'roteiro' | 'novo_durante_ligacao') => void
  onNovo: (texto: string) => void
  onResposta: (id: string, resposta: string) => void
  onResolvida: (id: string, resolvida: boolean) => void
}) {
  const [add, setAdd] = useState(false)
  const [txt, setTxt] = useState('')
  const roteiroTextos = itensRoteiro.map((o) => o.objecao)
  const extras = registradas
    .filter((o) => o.origem === 'novo_durante_ligacao' && !roteiroTextos.some((t) => t.toLowerCase() === o.texto_objecao.toLowerCase()))
    .map((o) => o.texto_objecao)
  const chips = [
    ...roteiroTextos.map((t) => ({ t, origem: 'roteiro' as const })),
    ...extras.map((t) => ({ t, origem: 'novo_durante_ligacao' as const })),
  ]
  if (!ativo && chips.length === 0) return null
  const confirmar = () => { const t = txt.trim(); if (t) { onNovo(t); setTxt(''); setAdd(false) } }
  const respSugerida = (texto: string) => itensRoteiro.find((o) => o.objecao.toLowerCase() === texto.toLowerCase())?.resposta || ''
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">Objeções — clique se surgir</div>
        {ativo && <button onClick={() => setAdd((v) => !v)} title="Adicionar objeção" className="rounded-full border px-2 text-sm leading-5 text-slate-500 hover:bg-slate-50">＋</button>}
      </div>
      {ativo && add && (
        <div className="mb-1 flex gap-1">
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') { setTxt(''); setAdd(false) } }}
            placeholder="Nova objeção…" className="w-full rounded-lg border px-2 py-1 text-xs" />
          <button onClick={confirmar} className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-medium text-white">Salvar</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {chips.length === 0 && <span className="text-xs text-slate-300">Nenhuma — use ＋ para adicionar.</span>}
        {chips.map(({ t, origem }, i) => {
          const sel = estaAtiva(t)
          return (
            <button key={t + i} disabled={!ativo} onClick={() => onToggle(t, origem)}
              className={`rounded-full border px-2 py-1 text-left text-xs ${sel ? 'border-amber-400 bg-amber-50 text-amber-700' : 'hover:bg-slate-50'} ${!ativo ? 'opacity-60' : ''}`}>
              {sel ? '✓ ' : ''}{t}
            </button>
          )
        })}
      </div>
      {ativo && registradas.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {registradas.map((o) => (
            <div key={o.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-1.5 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-amber-800">{o.texto_objecao}</span>
                <label className="flex items-center gap-1 whitespace-nowrap text-slate-600">
                  <input type="checkbox" checked={o.resolvida} onChange={(e) => onResolvida(o.id, e.target.checked)} /> resolvida
                </label>
              </div>
              <input defaultValue={o.resposta_utilizada || ''}
                placeholder={respSugerida(o.texto_objecao) ? `Resposta utilizada…  (sugestão: ${respSugerida(o.texto_objecao)})` : 'Resposta utilizada…'}
                onBlur={(e) => { if ((e.target.value || '') !== (o.resposta_utilizada || '')) onResposta(o.id, e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="w-full rounded border px-2 py-1 text-xs" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
