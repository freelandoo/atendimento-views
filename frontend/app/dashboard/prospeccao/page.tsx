'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { ThOrdenavel, type JsonApresentacao, type CriterioApresentacao } from '@/components/ui/JsonLeadModal'
import LeadDetalhesModal, { BolinhaIcp, criteriosDoLead, maximoDoLead } from '@/components/LeadDetalhesModal'
import DataTableFrame from '@/components/ui/DataTableFrame'
import TextoTruncado from '@/components/ui/TextoTruncado'
import NichoCidade from '@/components/ui/NichoCidade'
import MenuRadialAcoes, { type AcaoRadial } from '@/components/ui/MenuRadialAcoes'
import RotinasAquisicao, { type ModoAquisicao, type RotinasResp } from '@/components/RotinasAquisicao'
import HistoricoColetas from '@/components/HistoricoColetas'
import Abas, { PainelAba, type Aba } from '@/components/ui/Abas'
import { IconCheck, IconGear, IconTrash, IconUndo } from '@/components/ui/icons'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import { resumoIntervalo, POR_PAGINA_PADRAO } from '@/lib/paginacao'
import { aplicarRecorte, gravarFiltros, lerFiltros } from '@/lib/filtros-sessao'
import {
  FILTROS_STATUS, contagensDosFiltros, taxaResposta, paginaServidor, type PaginaServidor,
} from '@/lib/prospeccao-listagem'
import { qualificacaoDoLead, resumoIcpOperacional, seloIcp, seloValidacaoLead } from '@/lib/lead-icp'
import { leituraCadastro } from '@/lib/pontuacao-indicador'

type JsonApresProspect = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}

type Prospect = {
  id: string
  nome: string
  telefone: string | null
  email: string | null
  nicho: string
  cidade: string
  endereco: string | null
  rating: number | null
  avaliacoes: number | null
  // Canônicos do backend (services/site-classificacao.js): `site` só vem quando é site
  // PRÓPRIO; o link cru (Instagram, Linktree, ficha do Maps) vem em `link_original`.
  tem_site: boolean
  site: string | null
  link_original: string | null
  classificacao_url: string | null
  situacao_site: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  maps_url: string | null
  status: string
  score: number | null
  score_cadastro: number | null
  score_cadastro_max: number | null
  // Os critérios da completude sempre vieram na resposta (`prospecting.js:1422`) — só não
  // estavam declarados aqui. São eles que explicam a bolinha no tooltip e nos detalhes.
  score_cadastro_criterios: CriterioApresentacao[] | null
  json_apresentacao: JsonApresProspect | null
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
  created_at: string | null
}
type Metricas = {
  total: string; aguardando: string; aprovados: string; rejeitados: string
  enviados: string; responderam: string; taxa_resposta: number
}
// A configuração de prospecção (estratégia, nichos e regiões permitidos) continua
// existindo no banco, mas saiu desta tela: os critérios do assistente passaram a ser
// automáticos — ele aprende sozinho com o que você aprova e descarta.
// Busca da Aquisição (Bright Data Maps é assíncrona — o painel acompanha o status).
type Busca = {
  id: string; nicho: string; cidade: string; origem: string
  status: 'pendente' | 'processando' | 'concluido' | 'falhou'
  total_prospects: number; novos_prospects: number; erro: string | null
  created_at: string; updated_at: string
}
type Mercado = { nicho: string; cidade: string; total: string; enviados: string; responderam: string }
type Recente = { nome: string; telefone: string | null; nicho: string; cidade: string; score: number | null; updated_at: string }
type ResultadosResp = { por_mercado: Mercado[]; recentes: Recente[] }
type Rank = { chave: string; mensagens_enviadas: number; respostas: number; taxa_resposta: number; reunioes: number }
type Analytics = {
  metricas: {
    mensagens_enviadas: number; respostas: number; taxa_resposta: number
    diagnostico: number; proposta: number; reunioes: number; fechados: number
  }
  melhores: { categoria: Rank | null; cidade: Rank | null; horario: Rank | null }
}
type OpcaoFiltroMercado = { valor: string; total: number }
type FiltrosMercado = {
  nichos: OpcaoFiltroMercado[]
  categorias: OpcaoFiltroMercado[]
  cidades: OpcaoFiltroMercado[]
}
type EquipeDistribuicao = {
  id: string
  nome: string
  nicho_nome: string
  status: string
  total_membros: number
}
type PreviaDistribuicao = {
  equipe: { id: string; nome: string; nicho_nome: string }
  selecionados: number
  encontrados: number
  nao_encontrados: number
  elegiveis: number
  nao_elegiveis: number
  motivos: { motivo: string; total: number }[]
  destinos: { usuario_id: string; nome: string }[]
  previsao: { total: number; por_pessoa: { usuario_id: string; nome: string; receber: number }[] }
  executado?: boolean
  aprovados?: number
  distribuidos?: number
}
type MetaLoteProspects = { atualizados: number }
type Filtro3 = 'todos' | 'com' | 'sem'
type ViewAquisicao = {
  versao?: number
  cols: Record<string, boolean>
  site: Filtro3; social: Filtro3; email: Filtro3; telefone: Filtro3
  regiao: string
  scoreMin: string; scoreMax: string
  notaMin: string; notaMax: string
  avalMin: string; avalMax: string
  dataDe: string; dataAte: string
  ordenacao: string
}

const AQ_COLUNAS_TOGGLE: { key: string; label: string }[] = [
  { key: 'entrou', label: 'Entrou em' },
  { key: 'cadastro', label: 'ICP + cadastro' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  { key: 'nicho', label: 'Nicho / Cidade' },
  { key: 'status', label: 'Status' },
]
const AQ_ORDENACOES: { valor: string; label: string }[] = [
  { valor: 'padrao', label: 'Padrão (da tabela)' },
  { valor: 'prioridade_desc', label: 'Melhores leads primeiro' },
  { valor: 'prioridade_asc', label: 'Piores leads primeiro' },
  { valor: 'pontos_asc', label: 'Cadastro menos completo primeiro' },
  { valor: 'pontos_desc', label: 'Cadastro mais completo primeiro' },
  { valor: 'entrou_desc', label: 'Mais recentes primeiro' },
  { valor: 'entrou_asc', label: 'Mais antigos primeiro' },
  { valor: 'nota_desc', label: 'Maior nota primeiro' },
  { valor: 'nota_asc', label: 'Menor nota primeiro' },
  { valor: 'aval_desc', label: 'Mais avaliações primeiro' },
  { valor: 'aval_asc', label: 'Menos avaliações primeiro' },
  { valor: 'horario_asc', label: 'Sem horário cadastrado primeiro' },
  { valor: 'endereco_asc', label: 'Região / endereço (A-Z)' },
]
const AQ_VIEW_VERSAO = 1
const AQ_CHAVE_VIEW = 'prospeccaoView'
const AQ_VIEW_PADRAO: ViewAquisicao = {
  cols: Object.fromEntries(AQ_COLUNAS_TOGGLE.map((c) => [c.key, true])),
  site: 'todos', social: 'todos', email: 'todos', telefone: 'todos',
  regiao: '', scoreMin: '', scoreMax: '', notaMin: '', notaMax: '',
  avalMin: '', avalMax: '', dataDe: '', dataAte: '', ordenacao: 'padrao',
}
function migrarViewAquisicao(salvo: Partial<ViewAquisicao> & { versao?: number }): ViewAquisicao {
  const base = { ...AQ_VIEW_PADRAO, ...salvo }
  return { ...base, cols: { ...AQ_VIEW_PADRAO.cols, ...(salvo.cols || {}) } }
}

const STATUS_STYLE: Record<string, string> = {
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-red-100 text-red-600',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
}
// Rótulo amigável do status (consistente com os botões Marcar / Descartar).
const STATUS_LABEL: Record<string, string> = {
  aguardando: 'aguardando', aprovado: 'marcado', rejeitado: 'descartado',
  enviado: 'enviado', respondeu: 'respondeu',
}

// Os filtros de status (e a contagem de cada um) vivem em lib/prospeccao-listagem.js —
// puro e testado, porque "quantos leads tem cada status" é o número que o operador lê antes
// de decidir onde trabalhar.
function opcoesMercado(filtros: FiltrosMercado | null): OpcaoFiltroMercado[] {
  const mapa = new Map<string, OpcaoFiltroMercado>()
  for (const item of [...(filtros?.nichos || []), ...(filtros?.categorias || [])]) {
    const valor = String(item.valor || '').trim()
    if (!valor) continue
    const atual = mapa.get(valor)
    mapa.set(valor, { valor, total: (atual?.total || 0) + Number(item.total || 0) })
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.valor.localeCompare(b.valor, 'pt-BR'))
}

// Modo da tela. A Aquisição faz duas coisas distintas — operar uma busca e administrar
// automações — e exibi-las juntas era a densidade que este controle resolve. Trocar de modo
// só troca o conteúdo: não busca, não salva rotina, não chama a origem paga.
const ID_MODOS = 'modo'
const MODO_PADRAO: ModoAquisicao = 'busca'
const CHAVE_MODO = 'prospeccaoModo'

// Recorte de TRABALHO: status, busca, mercado, cidade, ordenação e página. Vive em
// sessionStorage por 30 min (lib/filtros-sessao), morre com a aba e não vai a banco. É outro
// eixo que `prospeccaoView` (localStorage, permanente: colunas e filtros do "Personalizar") e
// que `prospeccaoModo` (Busca × Rotinas, que também está na URL). Três coisas distintas, com
// durações distintas — juntá-las faria preferência evaporar ou recorte de hoje voltar amanhã.
const AQ_TELA_RECORTE = 'aquisicao'
const AQ_RECORTE_PADRAO = {
  filtro: '', buscaDados: '', mercado: '', cidadeFiltro: '',
  ordemChave: 'prioridade', ordemDir: 'desc', pagina: 1, abaResultado: 'desempenho',
}
const ABAS_MODO: Aba[] = [
  { id: 'busca', titulo: 'Busca', descricao: 'Encontrar, configurar e revisar leads de uma coleta.' },
  { id: 'rotinas', titulo: 'Rotinas', descricao: 'Configurar, acompanhar e revisar execuções automáticas.' },
]
function normalizarModo(valor: string | null | undefined): ModoAquisicao | null {
  return valor === 'busca' || valor === 'rotinas' ? valor : null
}

// Seção "Acompanhar resultados": consulta secundária, abaixo da lista de leads. As abas
// evitam que vários painéis analíticos disputem a tela ao mesmo tempo. O histórico de
// coletas saiu daqui: é execução de rotina, e vive no modo Rotinas.
const ID_ABAS = 'resultados'
const ABAS_RESULTADO: Aba[] = [
  { id: 'desempenho', titulo: 'Desempenho por mercado', descricao: 'Volume, envios, respostas e sinais comerciais por nicho e cidade' },
  { id: 'respostas', titulo: 'Respostas recentes', descricao: 'Quem respondeu por último' },
]
// O emoji de temperatura saiu da coluna Nome. Ele vinha de `prospects.score`, que é
// CONGELADO na coleta (`mapearPlace`) e nunca recalculado na leitura: um lead coletado antes
// da correção da classificação de site carrega um número de outra régua, e a explicação dele
// (`motivo_score`) é texto livre. Duas pontuações na mesma linha, com escalas, origens e
// DIREÇÕES opostas, sem a tela dizer que eram duas. Ficou a de cadastro, que é recalculada na
// leitura e tem critérios auditáveis. `p.score` continua no payload e no banco.

// Ordenações que NÃO têm mais coluna na tabela. Endereço, avaliações, nota e horário saíram
// da tela (viraram critério do tooltip e valor nos Detalhes), mas a ordenação deles é do
// SERVIDOR e continua válida — some do cabeçalho, não do produto. Sem este controle, reduzir a
// tabela teria removido em silêncio a capacidade de varrer a carteira inteira por esses
// campos. As chaves são as mesmas de `ORDEM_SQL_PROSPECTS`/`ORDEM_CALCULADA_PROSPECTS`.
const ORDENS_SEM_COLUNA: { chave: string; dir: 'asc' | 'desc'; label: string }[] = [
  { chave: 'aval', dir: 'desc', label: 'Mais avaliações primeiro' },
  { chave: 'aval', dir: 'asc', label: 'Menos avaliações primeiro' },
  { chave: 'nota', dir: 'desc', label: 'Maior nota primeiro' },
  { chave: 'nota', dir: 'asc', label: 'Menor nota primeiro' },
  { chave: 'horario', dir: 'asc', label: 'Sem horário cadastrado primeiro' },
  { chave: 'endereco', dir: 'asc', label: 'Endereço (A→Z)' },
]

// Data/hora "Entrou em" (1ª coluna): registro de quando o lead caiu na carteira.
function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// A ordenação passou a ser do SERVIDOR (`?ordenar=&direcao=`): a tabela mostra 25 de milhares,
// e ordenar só a página visível daria uma ordem falsa — "o menor cadastro" seria o menor
// daqueles 25, não o da carteira. O clique no cabeçalho vira parâmetro da requisição.

function chipsFiltrosAquisicao(mercado: string, cidadeFiltro: string, buscaDados: string, view: ViewAquisicao): string[] {
  const chips: string[] = []
  if (mercado) chips.push(`Nicho: ${mercado}`)
  if (cidadeFiltro) chips.push(`Cidade: ${cidadeFiltro}`)
  if (buscaDados.trim()) chips.push(`Busca: ${buscaDados.trim()}`)
  if (view.site !== 'todos') chips.push(view.site === 'com' ? 'Com site próprio' : 'Sem site próprio')
  if (view.social !== 'todos') chips.push(view.social === 'com' ? 'Com rede social' : 'Sem rede social')
  if (view.email !== 'todos') chips.push(view.email === 'com' ? 'Com e-mail' : 'Sem e-mail')
  if (view.telefone !== 'todos') chips.push(view.telefone === 'com' ? 'Com telefone' : 'Sem telefone')
  if (view.regiao.trim()) chips.push(`Região: ${view.regiao.trim()}`)
  if (view.scoreMin || view.scoreMax) chips.push(`Cadastro ${view.scoreMin || '0'}–${view.scoreMax || '∞'}`)
  if (view.notaMin || view.notaMax) chips.push(`Nota ${view.notaMin || '0'}–${view.notaMax || '∞'}`)
  if (view.avalMin || view.avalMax) chips.push(`Aval. ${view.avalMin || '0'}–${view.avalMax || '∞'}`)
  if (view.dataDe) chips.push(`Desde ${view.dataDe}`)
  if (view.dataAte) chips.push(`Até ${view.dataAte}`)
  if (view.ordenacao !== 'padrao') {
    const ord = AQ_ORDENACOES.find((o) => o.valor === view.ordenacao)
    chips.push(`Ordenação: ${ord?.label || view.ordenacao}`)
  }
  return chips
}
function ordemDaViewAquisicao(valor: string): { chave: string; dir: 'asc' | 'desc' } | null {
  if (!valor || valor === 'padrao') return null
  const [chave, dir] = valor.split('_')
  return chave ? { chave, dir: dir === 'asc' ? 'asc' : 'desc' } : null
}

export default function ProspeccaoPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [resultados, setResultados] = useState<ResultadosResp | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [buscas, setBuscas] = useState<Busca[]>([])
  const emAndamentoRef = useRef<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const [buscaDados, setBuscaDados] = useState('')
  const [mercado, setMercado] = useState('')
  const [cidadeFiltro, setCidadeFiltro] = useState('')
  const [filtrosMercado, setFiltrosMercado] = useState<FiltrosMercado | null>(null)
  const [agindo, setAgindo] = useState<string | null>(null)
  // As rotinas já carregadas pelo painel de rotinas, reaproveitadas pelo histórico de
  // coletas em "Acompanhar resultados" — sem repetir a mesma requisição.
  const [dadosRotinas, setDadosRotinas] = useState<RotinasResp | null>(null)
  // Ordenação da tabela: default = maior prioridade comercial no topo. Cadastro
  // continua aparecendo na célula, mas é só evidência/desempate, não chance de venda.
  // `site` saiu das colunas: uma ordenação ainda apontada para ela ordenaria por um critério
  // invisível, que o operador não conseguiria explicar nem desfazer pelo cabeçalho.
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' }>({ chave: 'prioridade', dir: 'desc' })
  // Aba visível de "Acompanhar resultados". Trocar de aba só alterna o painel: não
  // recarrega dado nenhum nem toca no filtro/ordenação da tabela de leads.
  const [abaResultado, setAbaResultado] = useState('desempenho')
  // Página visível da tabela. Recorte de APRESENTAÇÃO sobre os leads já carregados: trocar de
  // página não refaz requisição, não reordena e não muda filtro nenhum.
  const [pagina, setPagina] = useState(1)
  const [carregandoLista, setCarregandoLista] = useState(false)
  // Falso até o recorte guardado ser lido. Também é o que evita a lista sair duas vezes quando
  // a `view` do localStorage é restaurada logo antes.
  const [recortePronto, setRecortePronto] = useState(false)
  const listaSeqRef = useRef(0)
  const [persAberto, setPersAberto] = useState(false)
  const [view, setView] = useState<ViewAquisicao>(AQ_VIEW_PADRAO)
  const viewRestauradaRef = useRef(false)
  const patchView = useCallback((p: Partial<ViewAquisicao>) => {
    setView((v) => ({ ...v, ...p, cols: p.cols ? { ...v.cols, ...p.cols } : v.cols }))
    setPagina(1)
  }, [])
  // Modo da tela (Busca / Rotinas). Começa no padrão e só depois é restaurado, no efeito:
  // ler storage/URL durante o render quebraria a hidratação.
  const [modo, setModo] = useState<ModoAquisicao>(MODO_PADRAO)
  // Detalhes do lead: destino dos campos que saíram da tabela (endereço, nota, avaliações,
  // horário) e do JSON, que deixou de ser uma coluna da tela de trabalho.
  const [detalheAberto, setDetalheAberto] = useState<Prospect | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [distAberta, setDistAberta] = useState(false)
  const [distEquipes, setDistEquipes] = useState<EquipeDistribuicao[]>([])
  const [distEquipeId, setDistEquipeId] = useState('')
  const [distPrevia, setDistPrevia] = useState<PreviaDistribuicao | null>(null)
  const [distIds, setDistIds] = useState<string[]>([])
  const [distCarregando, setDistCarregando] = useState(false)
  const [distExecutando, setDistExecutando] = useState(false)
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  // Restaura o modo: a URL manda (link compartilhado/recarregado), senão a sessão.
  useEffect(() => {
    try {
      const daUrl = normalizarModo(new URLSearchParams(window.location.search).get('modo'))
      const daSessao = normalizarModo(sessionStorage.getItem(CHAVE_MODO))
      if (daUrl || daSessao) setModo(daUrl || daSessao!)
    } catch { /* storage indisponível: fica no padrão */ }
  }, [])

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(AQ_CHAVE_VIEW)
      if (salvo) setView(migrarViewAquisicao(JSON.parse(salvo)))
    } catch { /* localStorage indisponível: mantém o padrão */ }
    viewRestauradaRef.current = true
  }, [])
  useEffect(() => {
    if (!viewRestauradaRef.current) return
    try { localStorage.setItem(AQ_CHAVE_VIEW, JSON.stringify({ ...view, versao: AQ_VIEW_VERSAO })) } catch {}
  }, [view])

  // Recorte de trabalho: hidrata UMA vez, em efeito. Declarado DEPOIS do restore da `view`
  // de propósito: efeitos rodam na ordem de declaração, então quando `recortePronto` vira
  // verdadeiro a view já foi restaurada e a lista sai UMA vez, com tudo no lugar.
  useEffect(() => {
    const salvo = lerFiltros(AQ_TELA_RECORTE, empresaId)
    if (salvo) {
      const r = aplicarRecorte(AQ_RECORTE_PADRAO, salvo)
      setFiltro(r.filtro)
      setBuscaDados(r.buscaDados)
      setMercado(r.mercado)
      setCidadeFiltro(r.cidadeFiltro)
      setOrdem({ chave: r.ordemChave, dir: r.ordemDir === 'desc' ? 'desc' : 'asc' })
      setPagina(r.pagina > 0 ? r.pagina : 1)
      setAbaResultado(r.abaResultado)
    }
    setRecortePronto(true)
  }, [empresaId])
  useEffect(() => {
    if (!recortePronto) return
    gravarFiltros(AQ_TELA_RECORTE, empresaId, {
      filtro, buscaDados, mercado, cidadeFiltro,
      ordemChave: ordem.chave, ordemDir: ordem.dir, pagina, abaResultado,
    })
  }, [recortePronto, empresaId, filtro, buscaDados, mercado, cidadeFiltro, ordem, pagina, abaResultado])

  // Troca de modo: só apresentação. Nenhuma requisição sai daqui — `carregar`,
  // `carregarBuscas` e o painel de rotinas não dependem de `modo`.
  function trocarModo(id: string) {
    const alvo = normalizarModo(id)
    if (!alvo) return
    setModo(alvo)
    try {
      sessionStorage.setItem(CHAVE_MODO, alvo)
      const url = new URL(window.location.href)
      url.searchParams.set('modo', alvo)
      // replaceState: alternar modo não é navegação, não polui o histórico do navegador.
      window.history.replaceState(null, '', url.toString())
    } catch { /* storage/URL indisponível: o modo continua valendo na tela */ }
  }

  // Trocar filtro, busca ou ordenação recomeça a paginação: manter a página 3 de uma lista que
  // virou outra mostraria um recorte que ninguém pediu. Feito aqui, no HANDLER, e não num efeito
  // — resetar depois do render dispararia uma requisição a mais com a página velha, que ainda
  // poderia chegar DEPOIS da correta e sobrescrever a tela.
  function comReinicioDePagina(muda: () => void) {
    muda()
    setPagina(1)
    setSelecionados(new Set())
  }

  function ordenarPor(chave: string) {
    comReinicioDePagina(() =>
      setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' })))
  }

  // Filtros de recorte, compartilhados pela lista e pelas contagens.
  function filtrosAtuais() {
    const p = new URLSearchParams()
    if (buscaDados.trim()) p.set('busca', buscaDados.trim())
    if (mercado) p.set('mercado', mercado)
    if (cidadeFiltro) p.set('cidade', cidadeFiltro)
    if (view.site !== 'todos') p.set('site', view.site)
    if (view.social !== 'todos') p.set('social', view.social)
    if (view.email !== 'todos') p.set('email', view.email)
    if (view.telefone !== 'todos') p.set('telefone', view.telefone)
    if (view.regiao.trim()) p.set('regiao', view.regiao.trim())
    if (view.notaMin) p.set('notaMin', view.notaMin)
    if (view.notaMax) p.set('notaMax', view.notaMax)
    if (view.avalMin) p.set('avalMin', view.avalMin)
    if (view.avalMax) p.set('avalMax', view.avalMax)
    if (view.scoreMin) p.set('scoreMin', view.scoreMin)
    if (view.scoreMax) p.set('scoreMax', view.scoreMax)
    if (view.dataDe) p.set('dataDe', view.dataDe)
    if (view.dataAte) p.set('dataAte', view.dataAte)
    return p
  }

  // A LISTA é uma página do servidor: muda com filtro, ordenação e página.
  function carregarLista() {
    if (!empresaId || !recortePronto) return
    const p = filtrosAtuais()
    if (filtro) p.set('status', filtro)
    p.set('limit', String(POR_PAGINA_PADRAO))
    p.set('offset', String((pagina - 1) * POR_PAGINA_PADRAO))
    const ordemModal = ordemDaViewAquisicao(view.ordenacao)
    const ordemReq = ordemModal || ordem
    p.set('ordenar', ordemReq.chave)
    p.set('direcao', ordemReq.dir)
    // Só a requisição MAIS RECENTE pode escrever na tela: clicar rápido em "Próxima" duas vezes
    // pode fazer a resposta da página 2 chegar depois da 3 e reverter a navegação.
    const seq = ++listaSeqRef.current
    setCarregandoLista(true)
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?${p.toString()}`)
      .then((r) => { if (seq === listaSeqRef.current) setProspects(r.data || []) })
      .catch((e) => { if (seq === listaSeqRef.current) setErro(e.message) })
      .finally(() => { if (seq === listaSeqRef.current) setCarregandoLista(false) })
  }

  // O RESUMO (contagens, desempenho) não depende da página nem da ordenação — só do recorte.
  // Separado da lista de propósito: virar página não pode disparar quatro requisições.
  function carregarResumo() {
    if (!empresaId || !recortePronto) return
    // Contagens dos filtros de status: mesmo recorte da lista, MENOS o status — ele escolhe
    // qual contagem olhar, não o universo.
    apiFetch<Metricas>(`/api/empresas/${empresaId}/prospeccao/metricas?${filtrosAtuais().toString()}`)
      .then((r) => setMetricas(r.data)).catch(() => {})
    apiFetch<ResultadosResp>(`/api/empresas/${empresaId}/prospeccao/resultados`)
      .then((r) => setResultados(r.data)).catch(() => {})
    apiFetch<Analytics>(`/api/empresas/${empresaId}/prospeccao/analytics`)
      .then((r) => setAnalytics(r.data)).catch(() => {})
  }

  // Recarrega tudo: usado quando um lead muda de status ou uma coleta termina.
  function carregar() { carregarLista(); carregarResumo() }

  useEffect(() => { carregarLista() }, [empresaId, recortePronto, filtro, buscaDados, mercado, cidadeFiltro, view, pagina, ordem.chave, ordem.dir])
  useEffect(() => { carregarResumo() }, [empresaId, recortePronto, buscaDados, mercado, cidadeFiltro, view])
  useEffect(() => {
    if (!empresaId || !recortePronto) return
    const p = new URLSearchParams()
    if (filtro) p.set('status', filtro)
    apiFetch<FiltrosMercado>(`/api/empresas/${empresaId}/prospeccao/filtros?${p.toString()}`)
      .then((r) => setFiltrosMercado(r.data || null)).catch(() => {})
  }, [empresaId, recortePronto, filtro])

  // A busca da Aquisição é ASSÍNCRONA (Bright Data Maps, ~minutos). Aqui acompanhamos o
  // andamento: quando uma busca que estava rodando fica 'concluido'/'falhou', avisa e
  // recarrega a lista de leads sozinho.
  async function carregarBuscas() {
    if (!empresaId) return
    try {
      const r = await apiFetch<Busca[]>(`/api/empresas/${empresaId}/prospeccao/buscas?limit=10`)
      const lista = r.data || []
      const antes = emAndamentoRef.current
      const terminadas = lista.filter((b) => antes.has(b.id) && (b.status === 'concluido' || b.status === 'falhou'))
      for (const b of terminadas) {
        if (b.status === 'concluido') fb.toast(`Busca concluída: ${b.total_prospects} leads (${b.nicho} em ${b.cidade}).`, 'success')
        else fb.toast(`Busca falhou (${b.nicho} em ${b.cidade}): ${b.erro || 'erro'}.`, 'error')
      }
      if (terminadas.length) carregar()
      emAndamentoRef.current = new Set(lista.filter((b) => b.status === 'pendente' || b.status === 'processando').map((b) => b.id))
      setBuscas(lista)
      // A configuração NÃO é relida aqui: com o motor automático aposentado, não há mais
      // estado de busca mudando sozinho no servidor. Reler a cada 20s era só requisição
      // repetida — e ainda atropelava o que o operador estivesse digitando.
    } catch { /* silencioso */ }
  }
  useEffect(() => {
    if (!empresaId) return
    carregarBuscas()
    const t = setInterval(carregarBuscas, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  async function acao(id: string, acaoTipo: 'aprovar' | 'rejeitar', sucesso: string) {
    if (!empresaId) return
    setAgindo(id)
    try {
      await fb.runTask(
        () => apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/${acaoTipo}`, { method: 'POST' }),
        { sucesso }
      )
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setAgindo(null) }
  }

  async function acaoLote(acaoTipo: 'aprovar' | 'rejeitar') {
    if (!empresaId || selecionados.size === 0) return
    const ids = [...selecionados]
    const chave = `lote-${acaoTipo}`
    const rotulo = acaoTipo === 'aprovar' ? 'aprovado' : 'descartado'
    setAgindo(chave)
    try {
      const r = await fb.runTask(
        () => apiFetch<Prospect[], MetaLoteProspects>(`/api/empresas/${empresaId}/prospeccao/prospects/lote`, {
          method: 'POST',
          body: JSON.stringify({ ids, acao: acaoTipo }),
        }),
        { sucesso: null }
      )
      const total = r.meta?.atualizados ?? r.data?.length ?? ids.length
      fb.toast(`${total} lead${total === 1 ? '' : 's'} ${rotulo}${total === 1 ? '' : 's'} em lote.`, 'success')
      setSelecionados(new Set())
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setAgindo(null) }
  }

  function alternarSelecionado(id: string, marcado: boolean) {
    setSelecionados((atual) => {
      const prox = new Set(atual)
      if (marcado) prox.add(id)
      else prox.delete(id)
      return prox
    })
  }

  function alternarPagina(marcado: boolean) {
    setSelecionados((atual) => {
      const prox = new Set(atual)
      for (const p of pg.itens) {
        if (marcado) prox.add(p.id)
        else prox.delete(p.id)
      }
      return prox
    })
  }

  async function idsParaDistribuicao(): Promise<string[]> {
    const marcados = [...selecionados]
    if (marcados.length) return marcados
    const p = filtrosAtuais()
    if (filtro) p.set('status', filtro)
    p.set('limit', '200')
    p.set('offset', '0')
    const ordemModal = ordemDaViewAquisicao(view.ordenacao)
    const ordemReq = ordemModal || ordem
    p.set('ordenar', ordemReq.chave)
    p.set('direcao', ordemReq.dir)
    const r = await apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?${p.toString()}`)
    return (r.data || []).map((lead) => lead.id)
  }

  async function carregarEquipesDistribuicao(): Promise<EquipeDistribuicao[]> {
    if (distEquipes.length) return distEquipes
    const r = await apiFetch<EquipeDistribuicao[]>(`/api/empresas/${empresaId}/equipes-comerciais`)
    const equipes = (r.data || []).filter((e) => e.status === 'ativa')
    setDistEquipes(equipes)
    return equipes
  }

  async function carregarPreviaDistribuicao(ids: string[], equipeId: string) {
    if (!ids.length || !equipeId) return
    setDistCarregando(true)
    try {
      const r = await apiFetch<PreviaDistribuicao>(`/api/empresas/${empresaId}/prospeccao/prospects/lote/distribuicao/prever`, {
        method: 'POST',
        body: JSON.stringify({ ids, equipe_id: equipeId, entre: 'menor_carteira', criterio: 'melhores' }),
      })
      setDistPrevia(r.data)
    } finally {
      setDistCarregando(false)
    }
  }

  async function abrirDistribuicao() {
    if (!empresaId) return
    setDistCarregando(true)
    try {
      const [ids, equipes] = await Promise.all([idsParaDistribuicao(), carregarEquipesDistribuicao()])
      if (!ids.length) {
        fb.toast('Nenhum lead no recorte atual para aprovar e distribuir.', 'error')
        return
      }
      if (!equipes.length) {
        fb.toast('Crie uma equipe comercial ativa antes de distribuir leads.', 'error')
        return
      }
      const equipeId = distEquipeId || equipes[0].id
      setDistIds(ids)
      setDistEquipeId(equipeId)
      setDistAberta(true)
      await carregarPreviaDistribuicao(ids, equipeId)
    } catch (e: unknown) {
      fb.toast((e as Error)?.message || 'Nao foi possivel montar a previa.', 'error')
    } finally {
      setDistCarregando(false)
    }
  }

  async function trocarEquipeDistribuicao(equipeId: string) {
    setDistEquipeId(equipeId)
    setDistPrevia(null)
    await carregarPreviaDistribuicao(distIds, equipeId)
  }

  async function confirmarDistribuicao() {
    if (!empresaId || !distEquipeId || !distIds.length) return
    setDistExecutando(true)
    try {
      const r = await fb.runTask(
        () => apiFetch<PreviaDistribuicao>(`/api/empresas/${empresaId}/prospeccao/prospects/lote/distribuicao`, {
          method: 'POST',
          body: JSON.stringify({ ids: distIds, equipe_id: distEquipeId, entre: 'menor_carteira', criterio: 'melhores' }),
        }),
        { sucesso: null }
      )
      const data = r.data
      fb.toast(`${data.distribuidos || 0} lead${data.distribuidos === 1 ? '' : 's'} distribuído${data.distribuidos === 1 ? '' : 's'}; ${data.aprovados || 0} aprovado${data.aprovados === 1 ? '' : 's'} agora.`, 'success')
      setDistAberta(false)
      setDistPrevia(null)
      setDistIds([])
      setSelecionados(new Set())
      carregar()
    } catch { /* erro ja exibido */ }
    finally { setDistExecutando(false) }
  }

  // Ações da linha (fora de "rejeitado") no radial: Marcar (só quando aguardando, mesma
  // cardinalidade do par Concluir/Cancelar em Follow-ups) e Descartar (sempre). Mesmos
  // handlers/destinos de antes — só a apresentação virou o menu radial.
  function acoesAprovarDescartar(p: Prospect): AcaoRadial[] {
    const acoes: AcaoRadial[] = []
    if (p.status === 'aguardando') {
      acoes.push({
        id: 'aprovar',
        rotulo: 'Aprovar',
        zona: 'direita',
        tom: 'positivo',
        // O texto anterior dizia "(opcional — ele já pode ser disparado sem isso)", e era VERDADE:
        // nenhuma porta exigia aprovação. A Etapa 3 do CRM em equipe fechou as quatro portas
        // (campanha, WhatsApp manual, WhatsApp automático e e-mail), então aprovar deixou de ser
        // decoração e passou a ser o que libera o lead para a operação.
        descricao: 'Libera o lead para a operação comercial: ligação, WhatsApp, e-mail e campanhas.',
        desabilitado: agindo === p.id,
        onSelecionar: () => acao(p.id, 'aprovar', 'Lead aprovado — liberado para a operação.'),
      })
    }
    acoes.push({
      id: 'rejeitar',
      rotulo: 'Descartar',
      zona: 'esquerda',
      tom: 'negativo',
      descricao: 'Tira o lead da operação: ele deixa de ser abordado por qualquer canal.',
      desabilitado: agindo === p.id,
      onSelecionar: () => acao(p.id, 'rejeitar', 'Lead descartado — não será mais abordado.'),
    })
    return acoes
  }

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, email: email || null } : p)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  function aplicarLeadAtualizado(leadAtualizado: Prospect) {
    setProspects((prev) => prev.map((p) => (p.id === leadAtualizado.id ? { ...p, ...leadAtualizado } : p)))
    setDetalheAberto((cur) => (cur && cur.id === leadAtualizado.id ? { ...cur, ...leadAtualizado } : cur))
  }

  function resumoIcpCadastroLinha(p: Prospect) {
    const resumo = resumoIcpOperacional(p)
    const selo = seloIcp(resumo.faixa, resumo.score)
    const qualificacao = qualificacaoDoLead(p)
    const validacao = seloValidacaoLead(qualificacao.validacao)
    const maximo = maximoDoLead(p)
    const cadastro = leituraCadastro(p.score_cadastro, maximo, criteriosDoLead(p))
    const alertas = [...(qualificacao.bloqueios || []), ...(qualificacao.penalidades || []), ...(qualificacao.revisoes || [])]
      .slice(0, 2).map((a: { rotulo: string }) => a.rotulo).join(' · ')
    return {
      selo,
      resumo,
      cadastro,
      maximo,
      qualificacao,
      validacao,
      title: `${resumo.origem === 'previsao' ? 'Prévia automática' : 'ICP salvo'} — ${selo.rotulo}: ${selo.descricao}${selo.score != null ? ` (${selo.score}/13)` : ''}. Régua operacional: ${qualificacao.score_100}/100 — ${validacao.rotulo}. Cadastro/coleta: ${typeof p.score_cadastro === 'number' ? `${p.score_cadastro}/${maximo}` : 'sem score'} — ${cadastro.titulo}.${alertas ? ` Alertas: ${alertas}.` : ''}`,
    }
  }

  // A página já vem recortada e ordenada do servidor; o total do filtro vem das métricas.
  const contagens = contagensDosFiltros(metricas)
  const pg = paginaServidor<Prospect>({ itens: prospects, pagina, porPagina: POR_PAGINA_PADRAO, total: contagens[filtro] })
  const rodape = resumoIntervalo(pg, { vazio: 'Nenhum lead nesta lista' })
  const taxa = taxaResposta(metricas)

  const mercadoOpcoes = opcoesMercado(filtrosMercado)
  const cidadeOpcoes = filtrosMercado?.cidades || []
  const chips = chipsFiltrosAquisicao(mercado, cidadeFiltro, buscaDados, view)
  const filtrosAtivos = chips.length
  const cols = view.cols
  const idsPagina = pg.itens.map((p) => p.id)
  const selecionadosPagina = idsPagina.filter((id) => selecionados.has(id)).length
  const paginaTodaSelecionada = idsPagina.length > 0 && selecionadosPagina === idsPagina.length
  const colSpanTabela = 3 + AQ_COLUNAS_TOGGLE.filter((c) => cols[c.key] !== false).length
  const atividade = dadosRotinas?.atividade || []
  const porMercado = resultados?.por_mercado || []
  const recentes = resultados?.recentes || []
  const temAnalytics = !!analytics && analytics.metricas.mensagens_enviadas > 0
  const temDesempenho = porMercado.length > 0 || temAnalytics

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prospecção</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure a origem da busca: os leads continuam chegando ao Banco de Leads mesmo
          com esta tela fechada.
        </p>
      </div>

      <Abas
        abas={ABAS_MODO}
        ativa={modo}
        onMudar={trocarModo}
        idBase={ID_MODOS}
        ariaLabel="Modo da Aquisição"
      />

      {/* Painel único que troca de conteúdo: os ids acompanham o modo ativo, para o vínculo
          aba ↔ painel continuar valendo sem duplicar a tela inteira no DOM. */}
      <div
        role="tabpanel"
        id={`${ID_MODOS}-painel-${modo}`}
        aria-labelledby={`${ID_MODOS}-aba-${modo}`}
        tabIndex={0}
        className="space-y-6 focus:outline-none"
      >

      {/* Fica SEMPRE montado (só o card interno muda com o modo): é o que preserva o
          formulário da busca avulsa e o acompanhamento da coleta ao alternar. */}
      <RotinasAquisicao
        empresaId={empresaId}
        modo={modo}
        onColetaIniciada={carregarBuscas}
        onDados={setDadosRotinas}
        onLeadsAlterados={carregar}
      />

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {modo === 'busca' && (
      <div className="painel-troca space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Leads encontrados</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Tudo o que as rotinas e as buscas avulsas trouxeram. Marque ou descarte por aqui.
          </p>
        </div>

      {/* Filtros de status COM a contagem dentro do próprio rótulo: o número passou a viver
          onde a decisão é tomada, em vez de num painel de cards separado acima da tabela.
          A contagem fica DENTRO do botão, então entra no nome acessível ("Aguardando 42"). */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar leads por status">
        {FILTROS_STATUS.map((f) => {
          const ativo = filtro === f.valor
          const n = contagens[f.valor]
          return (
            <button
              key={f.valor || 'todos'}
              type="button"
              onClick={() => comReinicioDePagina(() => setFiltro(f.valor))}
              aria-pressed={ativo}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${ativo ? 'border-brand bg-brand text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
              {/* Contagem desconhecida (métricas ainda não chegaram) não vira "0". */}
              {n != null && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${ativo ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border bg-white px-3 py-3 shadow-sm">
        <div className="mb-2 text-xs font-medium text-slate-500">Filtrar leads encontrados</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Buscar dados</label>
            <input value={buscaDados} onChange={(e) => comReinicioDePagina(() => setBuscaDados(e.target.value))}
              placeholder="nome, telefone, endereço ou mercado" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Nicho/Categoria</label>
            <select value={mercado} onChange={(e) => comReinicioDePagina(() => setMercado(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm min-w-[180px]">
              <option value="">Todos os nichos</option>
              {mercadoOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Cidade</label>
            <select value={cidadeFiltro} onChange={(e) => comReinicioDePagina(() => setCidadeFiltro(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm min-w-[150px]">
              <option value="">Todas</option>
              {cidadeOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setPersAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            title="Abrir filtros, ordenação e colunas visíveis"
          >
            <span className="inline-flex items-center gap-1.5"><IconGear /> Personalizar</span>
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{filtrosAtivos}</span>
            )}
          </button>
          <div>
            <label htmlFor="ordem-sem-coluna" className="block text-xs text-slate-500 mb-1">Ordenar por</label>
            <select
              id="ordem-sem-coluna"
              value={ORDENS_SEM_COLUNA.some((o) => o.chave === ordem.chave && o.dir === ordem.dir) ? `${ordem.chave}:${ordem.dir}` : ''}
              onChange={(e) => {
                const [chave, dir] = e.target.value.split(':')
                if (chave) comReinicioDePagina(() => setOrdem({ chave, dir: dir === 'asc' ? 'asc' : 'desc' }))
              }}
              className="border rounded-lg px-3 py-2 text-sm min-w-[190px]"
            >
              <option value="">Cabeçalho da tabela</option>
              {ORDENS_SEM_COLUNA.map((o) => (
                <option key={`${o.chave}:${o.dir}`} value={`${o.chave}:${o.dir}`}>{o.label}</option>
              ))}
            </select>
          </div>
          {(mercado || cidadeFiltro || buscaDados.trim() || filtrosAtivos > 0) && (
            <button onClick={() => comReinicioDePagina(() => { setMercado(''); setCidadeFiltro(''); setBuscaDados(''); setView(AQ_VIEW_PADRAO) })}
              className="border rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Limpar filtros
            </button>
          )}
          {selecionados.size > 0 && (
            <Botao
              variante="secundaria"
              tamanho="md"
              iconeInicio={<IconCheck />}
              carregando={agindo === 'lote-aprovar'}
              onClick={() => acaoLote('aprovar')}
            >
              Aprovar selecionados
            </Botao>
          )}
          {selecionados.size > 0 && (
            <Botao
              variante="perigosa"
              tamanho="md"
              iconeInicio={<IconTrash />}
              carregando={agindo === 'lote-rejeitar'}
              onClick={() => acaoLote('rejeitar')}
            >
              Descartar selecionados
            </Botao>
          )}
          {selecionados.size > 0 && (
            <Botao
              variante="neutra"
              tamanho="md"
              onClick={() => setSelecionados(new Set())}
              disabled={agindo?.startsWith('lote-') || distCarregando || distExecutando}
            >
              Limpar seleção
            </Botao>
          )}
          <Botao
            variante="primaria"
            tamanho="md"
            carregando={distCarregando && !distAberta}
            onClick={abrirDistribuicao}
            motivoDesabilitado={!empresaId ? 'Empresa nao identificada.' : ''}
          >
            Aprovar e distribuir
          </Botao>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {selecionados.size > 0
            ? `${selecionados.size} lead${selecionados.size === 1 ? '' : 's'} marcado${selecionados.size === 1 ? '' : 's'} para a acao em lote.`
            : 'Sem linhas marcadas, a acao usa ate 200 primeiros leads do recorte atual.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos da Aquisição">
        {[
          { chave: 'sem_site', label: 'Sem site próprio', ativo: view.site === 'sem', onClick: () => patchView({ site: view.site === 'sem' ? 'todos' : 'sem' }) },
          { chave: 'com_social', label: 'Com rede social', ativo: view.social === 'com', onClick: () => patchView({ social: view.social === 'com' ? 'todos' : 'com' }) },
          { chave: 'sem_social', label: 'Sem rede social', ativo: view.social === 'sem', onClick: () => patchView({ social: view.social === 'sem' ? 'todos' : 'sem' }) },
          { chave: 'com_tel', label: 'Com telefone', ativo: view.telefone === 'com', onClick: () => patchView({ telefone: view.telefone === 'com' ? 'todos' : 'com' }) },
          { chave: 'sem_tel', label: 'Sem telefone', ativo: view.telefone === 'sem', onClick: () => patchView({ telefone: view.telefone === 'sem' ? 'todos' : 'sem' }) },
          { chave: 'com_email', label: 'Com e-mail', ativo: view.email === 'com', onClick: () => patchView({ email: view.email === 'com' ? 'todos' : 'com' }) },
          { chave: 'sem_email', label: 'Sem e-mail', ativo: view.email === 'sem', onClick: () => patchView({ email: view.email === 'sem' ? 'todos' : 'sem' }) },
        ].map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={item.onClick}
            aria-pressed={item.ativo}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${item.ativo ? 'border-brand bg-brand text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Filtros ativos:</span>
          {chips.map((chip) => (
            <span key={chip} className="rounded-full border bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{chip}</span>
          ))}
        </div>
      )}

      {/* Os cards de resumo (Total/Aguardando/Marcados/Enviados/Responderam/Taxa) saíram daqui:
          cada número foi para onde ele é usado — as contagens, para dentro dos filtros de
          status; a taxa de resposta, para o rodapé da listagem. */}

      {buscas.filter((b) => b.status === 'pendente' || b.status === 'processando').map((b) => (
        <div key={b.id} className="flex items-center gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
          <Spinner />
          <span>
            <strong>Busca em andamento</strong> — {b.nicho} em {b.cidade}. Os leads aparecem em alguns minutos; a lista atualiza sozinha.
          </span>
        </div>
      ))}

      {/* O card envolve tabela + rodapé: o rodapé fica FORA do viewport rolável, para não
          sumir na rolagem horizontal nem na vertical da tabela. */}
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm" aria-busy={carregandoLista}>
      <DataTableFrame ariaLabel="Rolagem horizontal da tabela de prospecção">
      <table className="w-full min-w-max text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="w-10 px-3 py-2 text-left">
              <input
                type="checkbox"
                checked={paginaTodaSelecionada}
                onChange={(e) => alternarPagina(e.target.checked)}
                aria-label="Selecionar todos os leads desta pagina"
                className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
              />
            </th>
            {cols.entrou !== false && <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={ordenarPor} />}
            <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
            {cols.cadastro !== false && <ThOrdenavel label="ICP + cadastro" chave="prioridade" ordem={ordem} onOrdenar={ordenarPor} />}
            {cols.telefone !== false && <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={ordenarPor} />}
            {cols.email !== false && <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={ordenarPor} />}
            {cols.nicho !== false && <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={ordenarPor} />}
            {cols.status !== false && <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={ordenarPor} />}
            {/* Largura própria e fixa: dá folga para o radial (bolinhas satélite a 56px do
                centro do gatilho "⋯") abrir sem colar na borda direita da tabela. */}
            <th className="w-32 min-w-[8rem] px-3 py-2 text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {pg.itens.map((p) => {
            const icpLinha = resumoIcpCadastroLinha(p)
            return (
            <tr key={p.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selecionados.has(p.id)}
                  onChange={(e) => alternarSelecionado(p.id, e.target.checked)}
                  aria-label={`Selecionar ${p.nome}`}
                  className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
                />
              </td>
              {cols.entrou !== false && <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{quando(p.created_at)}</td>}
              <td className="px-3 py-2 font-medium">
                <TextoTruncado
                  texto={p.nome}
                  href={p.maps_url}
                  dica={p.maps_url ? 'Ver ficha no Google Maps' : undefined}
                  className={`max-w-[220px] ${p.maps_url ? 'text-brand hover:underline' : ''}`}
                  sufixo={p.maps_url ? <span className="text-xs text-slate-400 shrink-0">↗</span> : undefined}
                />
              </td>
              {/* ICP + cadastro: cadastro/coleta e' evidencia para validar o ICP geral. */}
              {cols.cadastro !== false && <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <BolinhaIcp l={p} />
                  <div className="min-w-[92px] leading-tight" title={icpLinha.title}>
                    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${icpLinha.selo.classe}`}>
                      {icpLinha.selo.rotulo}{icpLinha.selo.score != null ? ` · ${icpLinha.selo.score}/13` : ''}
                    </span>
                    <span className="mt-0.5 block max-w-[150px] truncate text-[10px] text-slate-500">
                      {icpLinha.validacao.rotulo} · {icpLinha.qualificacao.score_100}/100
                    </span>
                  </div>
                  <button
                    onClick={() => setDetalheAberto(p)}
                    className="text-[11px] text-slate-500 underline-offset-2 hover:text-brand hover:underline"
                    title="ICP, cadastro como evidência, endereço, nota, avaliações, horário, links e dados completos do lead"
                  >
                    Detalhes
                  </button>
                </div>
              </td>}
              {cols.telefone !== false && <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.telefone || '—'}</td>}
              {cols.email !== false && <td className="px-3 py-2 text-xs"><EmailEditavel value={p.email} onSave={(email) => salvarEmail(p.id, email)} /></td>}
              {cols.nicho !== false && <td className="px-3 py-2 text-xs"><NichoCidade nicho={p.nicho} cidade={p.cidade} /></td>}
              {cols.status !== false && (
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[p.status] || p.status}</span>
                </td>
              )}
              <td className="w-32 min-w-[8rem] px-3 py-2 text-center whitespace-nowrap">
                {p.status === 'rejeitado' ? (
                  <button disabled={agindo === p.id}
                    onClick={() => acao(p.id, 'aprovar', 'Lead restaurado — voltou para a fila de disparo.')}
                    title="Traz o lead de volta para a fila de disparo (sai dos Descartados)."
                    className="inline-flex items-center gap-1.5 text-emerald-600 hover:underline disabled:opacity-40">
                    <IconUndo /> Restaurar</button>
                ) : (
                  <MenuRadialAcoes
                    acoes={acoesAprovarDescartar(p)}
                    rotuloContexto={p.nome}
                  />
                )}
              </td>
            </tr>
            )
          })}
          {pg.itens.length === 0 && (
            <tr><td colSpan={colSpanTabela} className="px-4 py-6 text-center text-gray-400">Nenhum prospect ainda. Configure a busca acima e clique em Buscar agora.</td></tr>
          )}
        </tbody>
      </table>
      </DataTableFrame>
      <RodapeListagem pg={pg} texto={rodape} taxa={taxa} onPagina={setPagina} />
      </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Acompanhar resultados</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Consulta do que já aconteceu: o que cada mercado rendeu e quem respondeu.
          </p>
        </div>

        <Abas
          abas={ABAS_RESULTADO}
          ativa={abaResultado}
          onMudar={setAbaResultado}
          idBase={ID_ABAS}
          ariaLabel="Acompanhar resultados"
        />

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <PainelAba id="desempenho" idBase={ID_ABAS} ativa={abaResultado}>
            {temDesempenho ? (
              <div className="space-y-5">
                {porMercado.length > 0 && (
                  <div className="-mx-4 overflow-x-auto px-4">
                    <table className="w-full min-w-max text-sm">
                      <thead><tr className="text-left text-xs text-slate-500">
                        <th className="py-1 pr-4">Nicho / Cidade</th><th className="py-1 pr-4 text-right">Total</th><th className="py-1 pr-4 text-right">Enviados</th><th className="py-1 text-right">Resp.</th>
                      </tr></thead>
                      <tbody>
                        {porMercado.map((m, i) => (
                          <tr key={i} className="border-t">
                            <td className="py-1.5 pr-4"><NichoCidade nicho={m.nicho} cidade={m.cidade} /></td>
                            <td className="py-1.5 pr-4 text-right">{m.total}</td>
                            <td className="py-1.5 pr-4 text-right">{m.enviados}</td>
                            <td className="py-1.5 text-right font-semibold text-orange-600">{m.responderam}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {temAnalytics && (
                  <div className="space-y-3 border-t pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sinais comerciais · esta empresa</p>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                      <Mini title="Enviados" value={analytics!.metricas.mensagens_enviadas} />
                      <Mini title="Respostas" value={analytics!.metricas.respostas} />
                      <Mini title="Taxa resp." value={`${analytics!.metricas.taxa_resposta}%`} />
                      <Mini title="Diagnóstico" value={analytics!.metricas.diagnostico} />
                      <Mini title="Reuniões" value={analytics!.metricas.reunioes} />
                      <Mini title="Fechados" value={analytics!.metricas.fechados} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Destaque title="Melhor nicho" rank={analytics!.melhores.categoria} />
                      <Destaque title="Melhor cidade" rank={analytics!.melhores.cidade} />
                      <Destaque title="Melhor horário" rank={analytics!.melhores.horario} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <VazioAba
                titulo="Ainda não há desempenho para mostrar."
                dica="Assim que os leads coletados começarem a receber mensagens no Banco de Leads, o resultado de cada mercado aparece aqui."
              />
            )}
          </PainelAba>

          <PainelAba id="respostas" idBase={ID_ABAS} ativa={abaResultado}>
            {recentes.length > 0 ? (
              <ul className="space-y-1.5">
                {recentes.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm border-t pt-1.5 first:border-0 first:pt-0">
                    <span className="inline-flex flex-wrap items-baseline gap-x-1">
                      <span className="font-medium">{r.nome}</span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <NichoCidade nicho={r.nicho} cidade={r.cidade} className="text-slate-500" />
                    </span>
                    <span className="font-mono text-xs text-slate-500">{r.telefone || '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <VazioAba
                titulo="Ninguém respondeu ainda."
                dica="As respostas dos leads que receberam mensagem aparecem aqui, da mais recente para a mais antiga."
              />
            )}
          </PainelAba>

        </div>
      </section>
      </div>
      )}

      {modo === 'rotinas' && (
      <section className="painel-troca space-y-3">
        <div>
          <h2 className="text-base font-semibold">Histórico de coletas</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            O que cada execução rendeu — das rotinas e das buscas avulsas —, da mais recente para a mais antiga.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <HistoricoColetas atividade={atividade} />
        </div>
      </section>
      )}

      </div>

      {persAberto && (
        <PersonalizarAquisicaoModal
          view={view}
          onPatch={patchView}
          onReset={() => { setView(AQ_VIEW_PADRAO); setPagina(1) }}
          onPreset={(patch) => {
            setView({ ...AQ_VIEW_PADRAO, ...patch, cols: { ...AQ_VIEW_PADRAO.cols, ...(patch.cols || {}) } })
            setPagina(1)
            setPersAberto(false)
          }}
          onClose={() => setPersAberto(false)}
        />
      )}

      {distAberta && (
        <ModalAprovarDistribuir
          equipes={distEquipes}
          equipeId={distEquipeId}
          previa={distPrevia}
          carregando={distCarregando}
          executando={distExecutando}
          onEquipe={trocarEquipeDistribuicao}
          onConfirmar={confirmarDistribuicao}
          onClose={() => {
            if (distExecutando) return
            setDistAberta(false)
            setDistPrevia(null)
          }}
        />
      )}

      {detalheAberto && (
        <LeadDetalhesModal
          lead={detalheAberto}
          onFechar={() => setDetalheAberto(null)}
          empresaId={empresaId}
          onLeadAtualizado={(lead) => aplicarLeadAtualizado(lead as Prospect)}
        />
      )}
    </div>
  )
}

const MOTIVOS_DISTRIBUICAO: Record<string, string> = {
  elegivel: 'Elegiveis',
  nao_encontrado: 'Nao encontrados',
  sem_nicho: 'Sem nicho estruturado',
  fora_do_nicho: 'Fora do nicho da equipe',
  ja_tem_responsavel: 'Ja tinham responsavel',
  nao_abordavel: 'Ainda sem aprovação operacional',
  status_avancado: 'Status avancado',
  bloqueado: 'Bloqueados',
  ja_trabalhado: 'Ja trabalhados',
  follow_up_aberto: 'Com follow-up',
  reuniao_marcada: 'Com reuniao',
  conversa_aberta: 'Com conversa',
}

function ModalAprovarDistribuir({
  equipes,
  equipeId,
  previa,
  carregando,
  executando,
  onEquipe,
  onConfirmar,
  onClose,
}: {
  equipes: EquipeDistribuicao[]
  equipeId: string
  previa: PreviaDistribuicao | null
  carregando: boolean
  executando: boolean
  onEquipe: (id: string) => void
  onConfirmar: () => void
  onClose: () => void
}) {
  const semElegiveis = !previa || previa.previsao.total <= 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">Aprovar e distribuir</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              Aprova o lote e distribui somente leads livres, intocados e vinculados ao nicho da equipe.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-line px-2 py-1 text-sm text-ink-3 hover:bg-surface-3">x</button>
        </div>

        <div className="space-y-4">
          <Campo etiqueta="Equipe que receberá o lote" ajuda="A distribuição usa o nicho estruturado desta equipe. Lead sem nicho_id não entra.">
            <select value={equipeId} onChange={(e) => onEquipe(e.target.value)} disabled={carregando || executando}>
              {equipes.map((e) => (
                <option key={e.id} value={e.id}>{e.nome} - {e.nicho_nome}</option>
              ))}
            </select>
          </Campo>

          {carregando && (
            <div className="rounded-lg border border-line bg-surface-2 px-4 py-5 text-sm text-ink-2">
              Calculando prévia do lote...
            </div>
          )}

          {previa && !carregando && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ResumoDistribuicao rotulo="Selecionados" valor={previa.selecionados} />
                <ResumoDistribuicao rotulo="Elegíveis" valor={previa.elegiveis} destaque />
                <ResumoDistribuicao rotulo="Previstos" valor={previa.previsao.total} destaque />
                <ResumoDistribuicao rotulo="Fora" valor={previa.nao_elegiveis} />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.75fr)]">
                <section>
                  <h4 className="text-sm font-semibold text-ink">Por que alguns ficam fora</h4>
                  <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                    {previa.motivos.map((m) => (
                      <div key={m.motivo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="text-ink-2">{MOTIVOS_DISTRIBUICAO[m.motivo] || m.motivo}</span>
                        <span className="font-semibold tabular-nums text-ink">{m.total}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h4 className="text-sm font-semibold text-ink">Distribuição prevista</h4>
                  <div className="mt-2 divide-y divide-line rounded-lg border border-line">
                    {previa.previsao.por_pessoa.length > 0 ? previa.previsao.por_pessoa.map((p) => (
                      <div key={p.usuario_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="truncate text-ink-2">{p.nome}</span>
                        <span className="font-semibold tabular-nums text-ink">{p.receber}</span>
                      </div>
                    )) : (
                      <p className="px-3 py-4 text-sm text-ink-3">Nenhum lead elegível para distribuir nesta prévia.</p>
                    )}
                  </div>
                </section>
              </div>

              {previa.nao_encontrados > 0 && (
                <p className="rounded-lg border border-estado-warn/30 bg-estado-warn/10 px-3 py-2 text-xs text-ink-2">
                  {previa.nao_encontrados} lead{previa.nao_encontrados === 1 ? '' : 's'} não foram encontrados nesta empresa e foram ignorados.
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <p className="text-xs text-ink-3">Busca não dispara isso sozinha; esta confirmação é o ato de distribuição.</p>
          <div className="flex gap-2">
            <Botao variante="secundaria" onClick={onClose} disabled={executando}>Cancelar</Botao>
            <Botao
              variante="primaria"
              onClick={onConfirmar}
              carregando={executando}
              disabled={semElegiveis || carregando}
              motivoDesabilitado={semElegiveis ? 'Não há leads elegíveis nesta prévia.' : ''}
            >
              Confirmar distribuição
            </Botao>
          </div>
        </div>
      </div>
    </div>
  )
}

function ResumoDistribuicao({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${destaque ? 'border-brand/30 bg-brand/5' : 'border-line bg-surface-2'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{rotulo}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{valor}</p>
    </div>
  )
}


type PresetAquisicao = {
  nome: string
  dica: string
  patch: Partial<ViewAquisicao>
}
const AQ_PRESETS: PresetAquisicao[] = [
  { nome: 'Sem presença digital', dica: 'Sem site próprio, sem rede social e com telefone.', patch: { site: 'sem', social: 'sem', telefone: 'com', ordenacao: 'pontos_asc' } },
  { nome: 'Só rede social', dica: 'Tem rede social, mas não tem site próprio.', patch: { site: 'sem', social: 'com', telefone: 'com', ordenacao: 'pontos_asc' } },
  { nome: 'Com telefone e sem e-mail', dica: 'Bom para completar cadastro antes do contato.', patch: { telefone: 'com', email: 'sem' } },
  { nome: 'Baixa autoridade', dica: 'Poucas avaliações, útil para oferta de presença digital.', patch: { avalMax: '10', ordenacao: 'aval_asc' } },
  { nome: 'Melhor nota', dica: 'Boa reputação, prioriza leads com nota alta.', patch: { notaMin: '4', ordenacao: 'nota_desc' } },
  { nome: 'Mais recentes', dica: 'Ordena pelo que entrou por último na base.', patch: { ordenacao: 'entrou_desc' } },
]

function SelFiltroAquisicao({ label, value, onChange, opcoes }: { label: string; value: string; onChange: (v: string) => void; opcoes: [string, string][] }) {
  return (
    <label className="block text-xs text-slate-500">
      <span className="mb-1 block">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-sm text-slate-700">
        {opcoes.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
      </select>
    </label>
  )
}

function CampoTextoAquisicao({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block text-xs text-slate-500">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-2 py-1.5 text-sm text-slate-700"
      />
    </label>
  )
}

function PersonalizarAquisicaoModal({ view, onPatch, onReset, onPreset, onClose }: {
  view: ViewAquisicao
  onPatch: (patch: Partial<ViewAquisicao>) => void
  onReset: () => void
  onPreset: (patch: Partial<ViewAquisicao>) => void
  onClose: () => void
}) {
  const aplicarColuna = (key: string, checked: boolean) => onPatch({ cols: { ...view.cols, [key]: checked } })
  const pararClique = (e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={pararClique}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">⠿ Personalizar aquisição</h3>
            <p className="mt-0.5 text-xs text-slate-500">Filtros, presets, ordenação e colunas visíveis para revisar os leads encontrados.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border px-2 py-1 text-sm text-slate-500 hover:bg-slate-50">×</button>
        </div>

        <div className="space-y-5">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Presets rápidos</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AQ_PRESETS.map((p) => (
                <button
                  key={p.nome}
                  type="button"
                  onClick={() => onPreset(p.patch)}
                  className="rounded-xl border p-3 text-left hover:border-brand hover:bg-brand/5"
                >
                  <span className="block text-sm font-medium text-slate-700">{p.nome}</span>
                  <span className="mt-1 block text-xs text-slate-500">{p.dica}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelFiltroAquisicao label="Ordenação" value={view.ordenacao} onChange={(v) => onPatch({ ordenacao: v })} opcoes={AQ_ORDENACOES.map((o): [string, string] => [o.valor, o.label])} />
            <CampoTextoAquisicao label="Região / endereço contém" value={view.regiao} onChange={(v) => onPatch({ regiao: v })} placeholder="bairro, avenida ou cidade" />
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelFiltroAquisicao label="Site próprio" value={view.site} onChange={(v) => onPatch({ site: v as Filtro3 })} opcoes={[["todos", "Todos"], ["com", "Com site próprio"], ["sem", "Sem site próprio"]]} />
              <SelFiltroAquisicao label="Rede social" value={view.social} onChange={(v) => onPatch({ social: v as Filtro3 })} opcoes={[["todos", "Todas"], ["com", "Com rede social"], ["sem", "Sem rede social"]]} />
              <SelFiltroAquisicao label="Telefone" value={view.telefone} onChange={(v) => onPatch({ telefone: v as Filtro3 })} opcoes={[["todos", "Todos"], ["com", "Com telefone"], ["sem", "Sem telefone"]]} />
              <SelFiltroAquisicao label="E-mail" value={view.email} onChange={(v) => onPatch({ email: v as Filtro3 })} opcoes={[["todos", "Todos"], ["com", "Com e-mail"], ["sem", "Sem e-mail"]]} />
              <CampoTextoAquisicao label="Cadastro/coleta ≥" type="number" value={view.scoreMin} onChange={(v) => onPatch({ scoreMin: v })} placeholder="0" />
              <CampoTextoAquisicao label="Cadastro/coleta ≤" type="number" value={view.scoreMax} onChange={(v) => onPatch({ scoreMax: v })} placeholder="100" />
              <CampoTextoAquisicao label="Nota ≥" type="number" value={view.notaMin} onChange={(v) => onPatch({ notaMin: v })} placeholder="0" />
              <CampoTextoAquisicao label="Nota ≤" type="number" value={view.notaMax} onChange={(v) => onPatch({ notaMax: v })} placeholder="5" />
              <CampoTextoAquisicao label="Avaliações ≥" type="number" value={view.avalMin} onChange={(v) => onPatch({ avalMin: v })} placeholder="0" />
              <CampoTextoAquisicao label="Avaliações ≤" type="number" value={view.avalMax} onChange={(v) => onPatch({ avalMax: v })} placeholder="100" />
              <CampoTextoAquisicao label="Entrou desde" type="date" value={view.dataDe} onChange={(v) => onPatch({ dataDe: v })} />
              <CampoTextoAquisicao label="Entrou até" type="date" value={view.dataAte} onChange={(v) => onPatch({ dataAte: v })} />
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Colunas visíveis</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AQ_COLUNAS_TOGGLE.map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={view.cols[c.key] !== false} onChange={(e) => aplicarColuna(c.key, e.target.checked)} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <button type="button" onClick={onReset} className="rounded-lg border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">↺ Restaurar padrão</button>
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">Aplicar</button>
        </div>
      </div>
    </div>
  )
}

// Rodapé da listagem: o que está visível, o que já foi respondido e como andar na lista.
// Toda a aritmética (intervalo, total, taxa) vem de lib/paginacao + lib/prospeccao-listagem —
// aqui é só apresentação. Desktop: resumo à esquerda, navegação à direita; mobile: empilhado
// com alvos de toque de 36px, mesmo padrão do rodapé da fila da Central de Ligações.
function RodapeListagem({ pg, texto, taxa, onPagina }: {
  pg: PaginaServidor<Prospect>
  texto: string
  taxa: { texto: string; responderam: number; base: number }
  onPagina: (p: number) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs text-slate-500" aria-live="polite">
          <span className="tabular-nums">{texto}</span>
          <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
          Taxa de resposta <b className="tabular-nums text-slate-700">{taxa.texto}</b>
          {taxa.base > 0 ? (
            <span className="text-slate-400"> ({taxa.responderam} de {taxa.base} que receberam mensagem)</span>
          ) : (
            <span className="text-slate-400"> (nenhuma mensagem enviada ainda)</span>
          )}
        </p>
      </div>
      {(pg.temAnterior || pg.temProxima) && (
        <div className="flex items-center gap-1 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => onPagina(pg.pagina - 1)}
            disabled={!pg.temAnterior}
            aria-label="Página anterior"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ◀ <span className="hidden sm:inline">Anterior</span>
          </button>
          <span className="px-1 text-xs text-slate-500">
            Página <b className="tabular-nums text-slate-700">{pg.pagina}</b>
            {/* Sem o total do filtro (métricas em voo) não dá para afirmar quantas páginas há. */}
            {!pg.totalEstimado && <> de <span className="tabular-nums">{pg.totalPaginas}</span></>}
          </span>
          <button
            type="button"
            onClick={() => onPagina(pg.pagina + 1)}
            disabled={!pg.temProxima}
            aria-label="Próxima página"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <span className="hidden sm:inline">Próxima</span> ▶
          </button>
        </div>
      )}
    </div>
  )
}

function VazioAba({ titulo, dica }: { titulo: string; dica: string }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-8 text-center">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">{dica}</p>
    </div>
  )
}

function Mini({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  )
}

function Destaque({ title, rank }: { title: string; rank: Rank | null }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</p>
      {rank ? (
        <>
          <p className="text-sm font-semibold mt-0.5 truncate" title={rank.chave}>{rank.chave}</p>
          <p className="text-xs text-slate-500 mt-0.5">{rank.respostas} resp. · {rank.taxa_resposta}% · {rank.reunioes} reun.</p>
        </>
      ) : (
        <p className="text-sm text-slate-400 mt-0.5">Sem dados</p>
      )}
    </div>
  )
}
