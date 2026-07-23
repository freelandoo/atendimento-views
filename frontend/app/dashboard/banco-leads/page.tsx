'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { apiFetch, apiDownload, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'
import ConversaHistoricoModal from '@/components/ConversaHistoricoModal'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconPlus, IconBroom, IconDownload, IconFlask, IconGear, IconLock, IconTrash, IconCalendar, IconSend, IconAlert } from '@/components/ui/icons'

// Banco de Leads — central de disparo com Modo Manual / Semiautomático / Automático.
// As duas origens (Google Places e Instagram) em tabelas separadas, com as MESMAS
// colunas/pontuação/ordenação/JSON da Aquisição, agrupadas nos 3 estágios do funil.
// Consome /api/empresas/:id/banco-leads.
type JsonApresLead = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}
type Lead = {
  id: string; origem: string; status: string; nome: string
  telefone: string | null; email: string | null; instagram_handle: string | null
  nicho: string | null; cidade: string | null; site: string | null
  seguidores: number | null; categoria_perfil: string | null
  endereco: string | null; rating: number | null; avaliacoes: number | null
  tem_site: boolean | null; maps_url: string | null; link_bio: string | null; bio: string | null
  score: number | null
  score_cadastro: number | null; score_cadastro_max: number | null
  json_apresentacao: JsonApresLead | null
  created_at: string; updated_at: string
  bloqueado_ate: string | null; bloqueio_motivo: string | null
  rodado_em: string | null; rodado_por: string | null
  mensagem_gerada: string | null; gerada_em: string | null
  tem_whatsapp: boolean | null
  ultimo_status: string | null; ultimo_erro: string | null
  proximo_agendamento: string | null
}
type Ordem = { chave: string; dir: 'asc' | 'desc' }
type Resumo = { abas: Record<string, number>; por_status: Record<string, number> }
type Instancia = {
  id: string; evolution_instance: string; nome?: string | null
  ativo: boolean; config_json?: { saudacao?: string } | null
}
type StatusConexaoInstancia = {
  id: string | null; evolution_instance: string; connected: boolean | null; state: string
}
type ResumoConexao = {
  total: number; desconectadas: number; alguma_desconectada: boolean
  instancias: StatusConexaoInstancia[]
}
type Config = {
  modo: string; gerar_ia: boolean; instrucoes_ia: string | null
  auto_ativo: boolean; auto_instancia_id: string | null
  janela_inicio: string; janela_fim: string
  teto_diario: number; intervalo_min: number; intervalo_max: number
  auto_proximo_disparo_em?: string | null
}
type OpcaoFiltroMercado = { valor: string; total: number }
type FiltrosMercado = {
  nichos: OpcaoFiltroMercado[]
  categorias: OpcaoFiltroMercado[]
  cidades: OpcaoFiltroMercado[]
}
type RodarResumo = {
  rodada: boolean
  aceitos: { id: string; nome: string }[]
  pulados: { id: string; motivo: string }[]
  teto_restante: number | null
  total_dia?: number
  envios?: { prospect_id: string; disparo_id: string; status: string; erro: string | null }[] | null
}
type GerarResumo = {
  gerados: { prospect_id: string; nome: string; mensagem?: string; gerada_por_ia?: boolean; erro_ia?: boolean }[]
  pulados: { id: string; motivo: string }[]
}
type PrevisaoEnvio = {
  titulo: string
  detalhe?: string
  tom: 'auto' | 'pronto' | 'enviado' | 'erro' | 'neutro'
  ts?: number   // hora estimada de envio (ms) — usada para ORDENAR a coluna Envio
}
// Progresso da preparação das mensagens (barra). A geração roda no worker de fundo.
type GeracaoProgresso = { eligiveis: number; prontas: number; gerando: number; enviados: number; erros: number }

const MAX_LOTE = 15
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])

// Modos de disparo do Banco de Leads.
const MODOS: { valor: string; label: string; hint: string; disabled?: boolean }[] = [
  { valor: 'manual', label: 'Manual', hint: 'Você seleciona os leads e envia. Clicar em Enviar já é a aprovação.' },
  { valor: 'semi_automatico', label: 'Semiautomático', hint: 'A IA gera a mensagem e deixa pronta; você dispara quando quiser (sem aprovação).' },
  { valor: 'automatico', label: 'Automático', hint: 'O sistema dispara sozinho na janela e intervalo abaixo. O botão manual continua disponível.' },
]

const ABAS: { valor: string; label: string }[] = [
  { valor: 'sem_contato', label: 'Sem contato ainda' },
  { valor: 'conversou', label: 'Já conversou' },
  { valor: 'fecharam', label: 'Fecharam' },
  { valor: 'agendados', label: 'Agendados' },
  { valor: 'descartados', label: 'Descartados' },
]
const ORIGENS: { valor: string; label: string }[] = [
  { valor: '', label: 'Todas as origens' },
  { valor: 'places', label: 'Google Places' },
  { valor: 'social', label: 'Instagram' },
]
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
const STATUS_STYLE: Record<string, string> = {
  coletado: 'bg-slate-100 text-slate-600',
  contato_encontrado: 'bg-slate-100 text-slate-600',
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
  fechado: 'bg-violet-100 text-violet-700',
  rejeitado: 'bg-red-100 text-red-600',
  nao_contatar: 'bg-red-100 text-red-600',
}
// Rótulos amigáveis em PT (o operador nunca vê os códigos internos crus).
// coletado/contato_encontrado/aguardando = todos "Sem contato" (mesma etapa do funil).
const STATUS_LABEL: Record<string, string> = {
  coletado: 'Sem contato',
  contato_encontrado: 'Sem contato',
  aguardando: 'Sem contato',
  aprovado: 'Marcado',
  enviado: 'Contatado',
  respondeu: 'Respondeu',
  fechado: 'Fechado',
  rejeitado: 'Rejeitado',
  nao_contatar: 'Não contatar',
}
const MOTIVO_LABEL: Record<string, string> = {
  rejeicao: 'rejeição', sem_resposta: 'sem resposta',
}
// Falha do último disparo traduzida (só as que ainda NÃO são mostradas por outro selo).
const ERRO_ENVIO_LABEL: Record<string, string> = {
  instance_disconnected: 'instância desconectada',
  numero_inexistente: 'número sem WhatsApp',
  timeout: 'tempo esgotado',
  message_error: 'WhatsApp recusou a mensagem',
}

function isLocked(l: Lead): boolean {
  return !!(l.bloqueado_ate && new Date(l.bloqueado_ate).getTime() > Date.now())
}
function isRodavel(l: Lead): boolean {
  return STATUS_RODAVEL.has(l.status) && !isLocked(l) && !!String(l.telefone || '').trim() && l.tem_whatsapp !== false
}
// Motivo pelo qual o lead está descartado (para a aba/rótulo claro). null = não descartado.
function motivoDescarte(l: Lead): string | null {
  if (l.tem_whatsapp === false) return 'Sem conta WhatsApp'
  if (l.status === 'rejeitado') return 'Rejeitado'
  if (l.status === 'nao_contatar') return 'Não contatar'
  return null
}
// A última geração de mensagem falhou na IA (mensagem obrigatoriamente por IA).
function temErroIa(l: Lead): boolean {
  return l.ultimo_status === 'erro_ia' || (l.ultimo_status === 'falhou' && l.ultimo_erro === 'ia_falhou')
}
// O ÚLTIMO disparo falhou por um motivo que ainda não é mostrado por outro selo
// (Erro IA e Descartado já têm o seu). Torna visível o "tentou e não foi" — ex.: instância
// desconectada. Retorna o motivo legível, ou null quando não há falha "solta".
function falhaEnvio(l: Lead): string | null {
  if (l.ultimo_status !== 'falhou') return null
  if (temErroIa(l) || motivoDescarte(l)) return null
  return ERRO_ENVIO_LABEL[l.ultimo_erro || ''] || 'falha no envio'
}
function fmtData(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return '' }
}
function fmtDataHora(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function dataValida(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.valueOf()) ? null : d
}
function horaParaMinutos(hhmm: string): number {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}
// Joga o horário para DENTRO da janela: antes do início → início do mesmo dia;
// depois do fim → início do DIA SEGUINTE. Assim a estimativa nunca cai fora do horário.
function ajustarParaJanela(d: Date, iniMin: number, fimMin: number): Date {
  if (fimMin <= iniMin) return d // janela inválida: não ajusta
  const r = new Date(d)
  const min = r.getHours() * 60 + r.getMinutes()
  if (min < iniMin) r.setHours(Math.floor(iniMin / 60), iniMin % 60, 0, 0)
  else if (min > fimMin) { r.setDate(r.getDate() + 1); r.setHours(Math.floor(iniMin / 60), iniMin % 60, 0, 0) }
  return r
}
function rotuloDia(d: Date): string {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const alvo = new Date(d); alvo.setHours(0, 0, 0, 0)
  const dias = Math.round((alvo.getTime() - hoje.getTime()) / 864e5)
  if (dias <= 0) return 'Hoje'
  if (dias === 1) return 'Amanhã'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
function fmtHoraCurta(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
// Estimativa de quando cada lead sairá no modo Automático: 1 por vez, a cada ~intervalo
// médio, SEMPRE dentro da janela (rola pro próximo dia quando a janela fecha).
// A ORDEM da fila espelha EXATAMENTE o backend (banco-leads-auto.js): melhor score
// primeiro, desempate por mais antigo e id — senão a estimativa não bate com o envio real.
function montarPrevisoesAutomaticas(lista: Lead[], config: Config): Map<string, PrevisaoEnvio> {
  const mapa = new Map<string, PrevisaoEnvio>()
  if (config.modo !== 'automatico' || !config.auto_ativo) return mapa
  const iniMin = horaParaMinutos(config.janela_inicio)
  const fimMin = horaParaMinutos(config.janela_fim)
  const passo = Math.max(1, Math.round((Number(config.intervalo_min) + Number(config.intervalo_max)) / 2))
  const agora = new Date()
  const proximo = dataValida(config.auto_proximo_disparo_em)
  let cursor = proximo && proximo.getTime() > agora.getTime() ? new Date(proximo) : new Date(agora)
  const fila = lista
    .filter(isRodavel)
    .sort((a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
      a.id.localeCompare(b.id))
  fila.forEach((lead, idx) => {
    cursor = ajustarParaJanela(cursor, iniMin, fimMin)
    mapa.set(lead.id, {
      titulo: idx === 0 ? 'Próximo envio' : 'Estimado',
      detalhe: `${rotuloDia(cursor)} ~${fmtHoraCurta(cursor)}`,
      tom: 'auto',
      ts: cursor.getTime(),
    })
    cursor = new Date(cursor.getTime() + passo * 60_000)
  })
  return mapa
}

const ORIGENS_PLACES = new Set(['manual', 'automatico'])

// Valor de cada coluna pra ordenação — mesma régua das tabelas de Aquisição.
function valorColuna(l: Lead, chave: string): number | string {
  switch (chave) {
    case 'entrou': return l.created_at || ''
    case 'nome': return (l.nome || '').toLowerCase()
    case 'username': return (l.instagram_handle || '').toLowerCase()
    case 'telefone': return l.telefone || ''
    case 'email': return l.email || ''
    case 'endereco': return (l.endereco || '').toLowerCase()
    case 'nicho': return `${l.nicho || l.categoria_perfil || ''} ${l.cidade || ''}`.toLowerCase()
    case 'seguidores': return l.seguidores ?? -1
    case 'aval': return l.avaliacoes ?? -1
    case 'nota': return l.rating ?? -1
    case 'horario': return l.json_apresentacao?.empresa?.horario_funcionamento ? 1 : 0
    case 'site': return l.tem_site || l.site ? 1 : 0
    case 'links': return (l.link_bio || l.site) ? 1 : 0
    case 'envio': return l.gerada_em || l.rodado_em || ''
    case 'pontos': return l.score_cadastro ?? 0
    case 'status': return l.status || ''
    default: return 0
  }
}

function ordenarLeads(lista: Lead[], ordem: Ordem, previsoes?: Map<string, PrevisaoEnvio>): Lead[] {
  return [...lista].sort((a, b) => {
    let cmp: number
    if (ordem.chave === 'envio') {
      // Ordena pela HORA ESTIMADA de envio (a mesma que aparece na célula), não pela
      // data de geração — assim clicar em "Envio" mostra a fila em ordem cronológica.
      const ta = previsoes?.get(a.id)?.ts ?? Infinity
      const tb = previsoes?.get(b.id)?.ts ?? Infinity
      cmp = ta === tb ? 0 : ta < tb ? -1 : 1
    } else {
      const va = valorColuna(a, ordem.chave)
      const vb = valorColuna(b, ordem.chave)
      cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
    }
    return ordem.dir === 'asc' ? cmp : -cmp
  })
}

// ─── Personalização da listagem (filtros/ordenação/colunas) ────────────────────
type Filtro3 = 'todos' | 'com' | 'sem'
type ViewConfig = {
  cols: Record<string, boolean>
  site: Filtro3; email: Filtro3; telefone: Filtro3
  envio: 'todos' | 'possivel' | 'impossivel'
  msgGerada: Filtro3
  disparo: 'todos' | 'disparado' | 'nao_disparado' | 'falha'
  agendamento: 'todos' | 'com' | 'sem' | 'hoje' | '7dias'
  regiao: string
  scoreMin: string; scoreMax: string
  notaMin: string; notaMax: string
  avalMin: string; avalMax: string
  dataDe: string; dataAte: string
  ordenacao: string
}

// Colunas que o usuário pode mostrar/ocultar (nome e JSON ficam fixos; ações vivem na conversa).
const COLUNAS_TOGGLE: { key: string; label: string }[] = [
  { key: 'entrou', label: 'Entrou em' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'envio_previsto', label: 'Envio' },
  { key: 'email', label: 'E-mail' },
  { key: 'endereco', label: 'Endereço' },
  { key: 'nicho', label: 'Nicho / Cidade' },
  { key: 'seguidores', label: 'Seguidores' },
  { key: 'aval', label: 'Avaliações' },
  { key: 'nota', label: 'Nota' },
  { key: 'horario', label: 'Horário' },
  { key: 'site', label: 'Site' },
  { key: 'links', label: 'Links' },
  { key: 'pontos', label: 'Pontos' },
  { key: 'status', label: 'Status' },
]

const ORDENACOES: { valor: string; label: string }[] = [
  { valor: 'padrao', label: 'Padrão (da aba / cabeçalho)' },
  { valor: 'pontos_desc', label: 'Maior pontuação primeiro' },
  { valor: 'pontos_asc', label: 'Menor pontuação primeiro' },
  { valor: 'entrou_desc', label: 'Mais recentes primeiro' },
  { valor: 'entrou_asc', label: 'Mais antigos primeiro' },
  { valor: 'nota_desc', label: 'Maior nota primeiro' },
  { valor: 'nota_asc', label: 'Menor nota primeiro' },
  { valor: 'aval_desc', label: 'Mais avaliações primeiro' },
  { valor: 'aval_asc', label: 'Menos avaliações primeiro' },
  { valor: 'agendamento_asc', label: 'Próximo agendamento primeiro' },
  { valor: 'contato_desc', label: 'Último contato (mais recente)' },
  { valor: 'contato_asc', label: 'Último contato (mais antigo)' },
]

const VIEW_PADRAO: ViewConfig = {
  cols: Object.fromEntries(COLUNAS_TOGGLE.map((c) => [c.key, true])),
  site: 'todos', email: 'todos', telefone: 'todos', envio: 'todos',
  msgGerada: 'todos', disparo: 'todos', agendamento: 'todos',
  regiao: '', scoreMin: '', scoreMax: '', notaMin: '', notaMax: '',
  avalMin: '', avalMax: '', dataDe: '', dataAte: '', ordenacao: 'padrao',
}

function numOuNull(s: string): number | null {
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Filtro client-side de um lead segundo a configuração de visualização.
function passaFiltrosView(l: Lead, v: ViewConfig): boolean {
  const temSite = !!(l.site || l.tem_site)
  if (v.site === 'com' && !temSite) return false
  if (v.site === 'sem' && temSite) return false
  const temEmail = !!String(l.email || '').trim()
  if (v.email === 'com' && !temEmail) return false
  if (v.email === 'sem' && temEmail) return false
  const temTel = !!String(l.telefone || '').trim()
  if (v.telefone === 'com' && !temTel) return false
  if (v.telefone === 'sem' && temTel) return false
  if (v.envio === 'possivel' && l.tem_whatsapp !== true) return false
  if (v.envio === 'impossivel' && l.tem_whatsapp !== false) return false
  if (v.msgGerada === 'com' && !l.mensagem_gerada) return false
  if (v.msgGerada === 'sem' && l.mensagem_gerada) return false
  const disparado = !!l.rodado_em || l.status === 'enviado' || l.status === 'respondeu'
  if (v.disparo === 'disparado' && !disparado) return false
  if (v.disparo === 'nao_disparado' && disparado) return false
  if (v.disparo === 'falha' && l.ultimo_status !== 'falhou') return false
  if (v.agendamento !== 'todos') {
    const agData = l.proximo_agendamento ? new Date(l.proximo_agendamento) : null
    if (v.agendamento === 'com' && !agData) return false
    if (v.agendamento === 'sem' && agData) return false
    if (v.agendamento === 'hoje' && (!agData || !mesmoDia(agData, new Date()))) return false
    if (v.agendamento === '7dias' && (!agData || agData.getTime() > Date.now() + 7 * 864e5)) return false
  }
  if (v.regiao.trim()) {
    const q = v.regiao.trim().toLowerCase()
    if (!`${l.endereco || ''} ${l.cidade || ''}`.toLowerCase().includes(q)) return false
  }
  const score = l.score_cadastro ?? null
  const sMin = numOuNull(v.scoreMin); const sMax = numOuNull(v.scoreMax)
  if (sMin != null && (score == null || score < sMin)) return false
  if (sMax != null && (score == null || score > sMax)) return false
  const nota = l.rating ?? null
  const nMin = numOuNull(v.notaMin); const nMax = numOuNull(v.notaMax)
  if (nMin != null && (nota == null || nota < nMin)) return false
  if (nMax != null && (nota == null || nota > nMax)) return false
  const aval = l.avaliacoes ?? null
  const aMin = numOuNull(v.avalMin); const aMax = numOuNull(v.avalMax)
  if (aMin != null && (aval == null || aval < aMin)) return false
  if (aMax != null && (aval == null || aval > aMax)) return false
  if (v.dataDe && l.created_at && new Date(l.created_at) < new Date(v.dataDe)) return false
  if (v.dataAte && l.created_at && new Date(l.created_at) > new Date(`${v.dataAte}T23:59:59`)) return false
  return true
}

// Ordenação global do modal (sobrescreve o clique no cabeçalho quando != 'padrao').
function ordenarPorView(lista: Lead[], ord: string): Lead[] {
  if (ord === 'padrao') return lista
  const [campo, dir] = ord.split('_')
  const val = (l: Lead): number => {
    switch (campo) {
      case 'pontos': return l.score_cadastro ?? -1
      case 'nota': return l.rating ?? -1
      case 'aval': return l.avaliacoes ?? -1
      case 'entrou': return l.created_at ? new Date(l.created_at).getTime() : 0
      case 'contato': return l.updated_at ? new Date(l.updated_at).getTime() : 0
      case 'agendamento': return l.proximo_agendamento ? new Date(l.proximo_agendamento).getTime() : Infinity
      default: return 0
    }
  }
  return [...lista].sort((a, b) => { const d = val(a) - val(b); return dir === 'asc' ? d : -d })
}

// Nº de filtros ativos + chips descritivos (para mostrar que a lista está filtrada).
function chipsDaView(v: ViewConfig): string[] {
  const c: string[] = []
  if (v.site !== 'todos') c.push(v.site === 'com' ? 'Com site' : 'Sem site')
  if (v.email !== 'todos') c.push(v.email === 'com' ? 'Com e-mail' : 'Sem e-mail')
  if (v.telefone !== 'todos') c.push(v.telefone === 'com' ? 'Com telefone' : 'Sem telefone')
  if (v.envio === 'possivel') c.push('Envio possível')
  if (v.envio === 'impossivel') c.push('Sem WhatsApp')
  if (v.msgGerada !== 'todos') c.push(v.msgGerada === 'com' ? 'Com mensagem' : 'Sem mensagem')
  if (v.disparo !== 'todos') c.push({ disparado: 'Disparado', nao_disparado: 'Não disparado', falha: 'Falha no envio' }[v.disparo] || '')
  if (v.agendamento !== 'todos') c.push({ com: 'Agendados', sem: 'Sem agendamento', hoje: 'Agendados hoje', '7dias': 'Agenda 7 dias' }[v.agendamento] || '')
  if (v.regiao.trim()) c.push(`Região: ${v.regiao.trim()}`)
  if (v.scoreMin || v.scoreMax) c.push(`Pontos ${v.scoreMin || '0'}–${v.scoreMax || '∞'}`)
  if (v.notaMin || v.notaMax) c.push(`Nota ${v.notaMin || '0'}–${v.notaMax || '∞'}`)
  if (v.avalMin || v.avalMax) c.push(`Aval. ${v.avalMin || '0'}–${v.avalMax || '∞'}`)
  if (v.dataDe) c.push(`Desde ${v.dataDe}`)
  if (v.dataAte) c.push(`Até ${v.dataAte}`)
  return c.filter(Boolean)
}

export default function BancoLeadsPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/banco-leads`

  const [aba, setAba] = useState('sem_contato')
  const [origem, setOrigem] = useState('')
  const [mercado, setMercado] = useState('')
  const [cidadeFiltro, setCidadeFiltro] = useState('')
  const [filtrosMercado, setFiltrosMercado] = useState<FiltrosMercado | null>(null)
  const [busca, setBusca] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [limpando, setLimpando] = useState(false)
  // Modo de disparo (config por empresa)
  const [config, setConfig] = useState<Config>({
    modo: 'manual', gerar_ia: true, instrucoes_ia: null,
    auto_ativo: false, auto_instancia_id: null, janela_inicio: '08:00', janela_fim: '18:00',
    teto_diario: 40, intervalo_min: 15, intervalo_max: 30,
  })
  const [salvandoAuto, setSalvandoAuto] = useState(false)
  // Rodar leads
  const [instancias, setInstancias] = useState<Instancia[]>([])
  const [instanciaId, setInstanciaId] = useState('')
  const [conexoes, setConexoes] = useState<Record<string, StatusConexaoInstancia>>({})
  const [verificandoConexao, setVerificandoConexao] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [gerando, setGerando] = useState(false)
  const [geracaoProgresso, setGeracaoProgresso] = useState<GeracaoProgresso | null>(null)
  const [geracaoProgressoErro, setGeracaoProgressoErro] = useState(false)
  const assinaturaGeracaoRef = useRef<string | null>(null)
  const ultimaRecargaGeracaoRef = useRef(0)
  // Cooldown do próximo envio (modo Semi): segundos restantes + estado visual do cronômetro.
  const [cooldownS, setCooldownS] = useState<number | null>(null)
  const [flashCron, setFlashCron] = useState(false)
  const cronRef = useRef<HTMLDivElement | null>(null)
  const [saudacaoOpen, setSaudacaoOpen] = useState(false)
  const [cadastroOpen, setCadastroOpen] = useState(false)
  // Ordenação independente por tabela — mesmos defaults da Aquisição:
  // Places = menos pontos no topo; Instagram = mais seguidores no topo.
  const [ordemPlaces, setOrdemPlaces] = useState<Ordem>({ chave: 'pontos', dir: 'asc' })
  const [ordemIg, setOrdemIg] = useState<Ordem>({ chave: 'seguidores', dir: 'desc' })
  const [jsonAberto, setJsonAberto] = useState<{ titulo: string; json: JsonApresLead } | null>(null)
  const [conversaAberta, setConversaAberta] = useState<{ numero: string; titulo: string; leadId: string; mensagemGerada: string | null; rodavel: boolean; status: string } | null>(null)
  const [enviandoConversa, setEnviandoConversa] = useState(false)
  const [gerandoConversa, setGerandoConversa] = useState(false)
  // Personalizar visualização (colunas + filtros + ordenação; persistida no localStorage)
  const [persAberto, setPersAberto] = useState(false)
  const [view, setView] = useState<ViewConfig>(VIEW_PADRAO)
  const patchView = useCallback((p: Partial<ViewConfig>) => setView((v) => ({ ...v, ...p })), [])
  const fb = useFeedback()

  // Abre o histórico de conversa do contato (reusa o modal/endpoint de Conversas) e leva
  // a mensagem gerada + elegibilidade para permitir o envio individual dali.
  function abrirConversa(l: Lead) {
    const digits = String(l.telefone || '').replace(/\D/g, '')
    if (!digits) { fb.toast('Este lead não tem telefone.', 'info'); return }
    setConversaAberta({ numero: `${digits}@s.whatsapp.net`, titulo: l.nome || '', leadId: l.id, mensagemGerada: l.mensagem_gerada, rodavel: isRodavel(l), status: l.status })
  }

  function query() {
    const p = new URLSearchParams({ aba })
    if (origem) p.set('origem', origem)
    if (mercado) p.set('mercado', mercado)
    if (cidadeFiltro) p.set('cidade', cidadeFiltro)
    if (busca.trim()) p.set('busca', busca.trim())
    return p.toString()
  }

  const carregarResumo = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Resumo>(`${base}/resumo`)
      setResumo(r.data)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar resumo.') }
  }, [base, empresaId])

  const carregarConfig = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Config>(`${base}/config`)
      setConfig(r.data)
      // No Semi/Automático, a barra reflete a instância configurada (fonte única).
      if ((r.data.modo === 'semi_automatico' || r.data.modo === 'automatico') && r.data.auto_instancia_id) {
        setInstanciaId(r.data.auto_instancia_id)
      }
    } catch { /* mantém default */ }
  }, [base, empresaId])

  const carregarLeads = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    try {
      const p = new URLSearchParams({ aba })
      if (origem) p.set('origem', origem)
      if (mercado) p.set('mercado', mercado)
      if (cidadeFiltro) p.set('cidade', cidadeFiltro)
      if (busca.trim()) p.set('busca', busca.trim())
      // Escopa a "Mensagem gerada" pela instância selecionada (modo Semi).
      if (instanciaId) p.set('instancia_id', instanciaId)
      const r = await apiFetch<Lead[]>(`${base}/leads?${p.toString()}`)
      setLeads(r.data || [])
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar leads.') }
    finally { setCarregando(false) }
  }, [base, empresaId, aba, origem, mercado, cidadeFiltro, busca, instanciaId])

  const carregarFiltrosMercado = useCallback(async () => {
    if (!empresaId) return
    try {
      const p = new URLSearchParams({ aba })
      if (origem) p.set('origem', origem)
      const r = await apiFetch<FiltrosMercado>(`${base}/filtros?${p.toString()}`)
      setFiltrosMercado(r.data || null)
    } catch { /* filtros sao apoio de UI; a listagem continua funcionando */ }
  }, [base, empresaId, aba, origem])

  const carregarInstancias = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Instancia[]>(`/api/empresas/${empresaId}/whatsapp`)
      const ativas = (r.data || []).filter((i) => i.ativo)
      setInstancias(ativas)
      setInstanciaId((cur) => cur || (ativas[0]?.id ?? ''))
    } catch { /* silencioso */ }
  }, [empresaId])

  const carregarConexoes = useCallback(async () => {
    if (!empresaId) return
    setVerificandoConexao(true)
    try {
      const r = await apiFetch<ResumoConexao>(`/api/empresas/${empresaId}/whatsapp/conexao-resumo`)
      const mapa: Record<string, StatusConexaoInstancia> = {}
      for (const status of r.data.instancias || []) {
        if (status.id) mapa[status.id] = status
      }
      setConexoes(mapa)
    } catch {
      setConexoes({})
    } finally {
      setVerificandoConexao(false)
    }
  }, [empresaId])

  // Busca o cooldown atual da instância (reusa o throttle do backend — sem regra nova).
  const carregarCooldown = useCallback(async () => {
    if (!empresaId || !instanciaId) { setCooldownS(null); return }
    try {
      const r = await apiFetch<{ cooldown_restante_s: number; cooldown_min: number }>(`${base}/cooldown?instancia_id=${instanciaId}`)
      setCooldownS(Math.max(0, Math.round(r.data.cooldown_restante_s || 0)))
    } catch { /* silencioso */ }
  }, [base, empresaId, instanciaId])

  useEffect(() => { carregarResumo() }, [carregarResumo])
  useEffect(() => { carregarConfig() }, [carregarConfig])
  useEffect(() => { carregarLeads() }, [carregarLeads])
  useEffect(() => { carregarFiltrosMercado() }, [carregarFiltrosMercado])
  useEffect(() => { carregarInstancias() }, [carregarInstancias])
  useEffect(() => {
    carregarConexoes()
    const t = setInterval(carregarConexoes, 30000)
    return () => clearInterval(t)
  }, [carregarConexoes])
  // Atualiza o cooldown ao trocar de instância (e no primeiro load).
  useEffect(() => { carregarCooldown() }, [carregarCooldown])
  // A tela apenas observa o progresso. A geração é feita pelo worker do backend e continua
  // mesmo com esta página fechada; ao voltar, o primeiro polling recupera o estado atual.
  useEffect(() => {
    if (!empresaId || !instanciaId || config.modo !== 'semi_automatico') {
      setGeracaoProgresso(null)
      setGeracaoProgressoErro(false)
      return
    }
    let cancelado = false
    async function atualizar() {
      try {
        const qs = new URLSearchParams({ instancia_id: instanciaId })
        const r = await apiFetch<GeracaoProgresso>(`${base}/geracao-progresso?${qs.toString()}`)
        if (!cancelado) {
          setGeracaoProgresso(r.data)
          setGeracaoProgressoErro(false)
          // Mantém a coluna "Mensagem gerada" atualizada sem refazer o GET pesado a cada
          // polling: no máximo uma recarga a cada 12s, e somente quando algo terminou.
          const assinatura = `${r.data.prontas}:${r.data.erros}`
          const agora = Date.now()
          if (assinaturaGeracaoRef.current != null
            && assinatura !== assinaturaGeracaoRef.current
            && agora - ultimaRecargaGeracaoRef.current >= 12000) {
            ultimaRecargaGeracaoRef.current = agora
            carregarLeads()
          }
          assinaturaGeracaoRef.current = assinatura
        }
      } catch {
        if (!cancelado) setGeracaoProgressoErro(true)
      }
    }
    setGeracaoProgresso(null)
    setGeracaoProgressoErro(false)
    assinaturaGeracaoRef.current = null
    ultimaRecargaGeracaoRef.current = 0
    atualizar()
    const t = setInterval(atualizar, 3000)
    return () => { cancelado = true; clearInterval(t) }
  }, [base, empresaId, instanciaId, config.modo, carregarLeads])
  // Tick de 1s: conta regressiva local (o servidor é a fonte da verdade nos re-fetches).
  useEffect(() => {
    const t = setInterval(() => setCooldownS((s) => (s && s > 0 ? s - 1 : s)), 1000)
    return () => clearInterval(t)
  }, [])
  // Limpa a seleção ao trocar de aba/filtro (os ids podem sair da lista).
  useEffect(() => { setSelecionados(new Set()) }, [aba, origem, mercado, cidadeFiltro, busca])
  // Personalização: carrega do localStorage (1x) e persiste a cada mudança.
  useEffect(() => {
    try {
      const s = localStorage.getItem('bancoLeadsView')
      if (s) { const p = JSON.parse(s); setView({ ...VIEW_PADRAO, ...p, cols: { ...VIEW_PADRAO.cols, ...(p.cols || {}) } }) }
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('bancoLeadsView', JSON.stringify(view)) } catch { /* ignore */ }
  }, [view])

  const cooldownAtivo = cooldownS != null && cooldownS > 0
  function fmtMMSS(s: number): string {
    const m = Math.floor(s / 60); const ss = s % 60
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  // Bloqueio de envio antes da hora: destaca/foca o cronômetro + toast discreto.
  function bloquearPorCooldown(): boolean {
    if (!cooldownAtivo) return false
    setFlashCron(true)
    cronRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setTimeout(() => setFlashCron(false), 1600)
    fb.toast(`Aguarde ${fmtMMSS(cooldownS as number)} para o próximo envio.`, 'info')
    return true
  }

  const instanciaSel = useMemo(() => instancias.find((i) => i.id === instanciaId) || null, [instancias, instanciaId])
  // Saudação (mensagem-base) ainda não configurada na instância selecionada → destaca o
  // botão "Testar envio" (pisca) e mostra um aviso simples no topo, antes de bloquear no disparo.
  const saudacaoFaltando = !!instanciaSel && !String(instanciaSel.config_json?.saudacao || '').trim()
  const statusConexao = instanciaId ? conexoes[instanciaId] || null : null
  const conexaoAindaVerificando = !!instanciaId && verificandoConexao && !statusConexao
  const motivoBloqueioConexao = !instanciaId
    ? 'Escolha uma instância para enviar.'
    : conexaoAindaVerificando
      ? 'Aguarde a verificação da conexão da instância.'
      : statusConexao?.connected === false
        ? 'A instância WhatsApp está desconectada. Reconecte-a antes de enviar.'
        : statusConexao?.connected !== true
          ? 'Não foi possível confirmar a conexão da instância. Verifique-a antes de enviar.'
          : null
  const rotuloConexao = !instanciaId
    ? 'Nenhuma selecionada'
    : conexaoAindaVerificando
      ? 'Verificando conexão...'
      : statusConexao?.connected === true
        ? 'Conectada'
        : statusConexao?.connected === false
          ? 'Desconectada'
          : 'Status indisponível'
  const classeConexao = statusConexao?.connected === true
    ? 'text-emerald-700'
    : statusConexao?.connected === false
      ? 'text-red-700'
      : 'text-amber-700'
  // Personalização (client-side, sobre os leads já carregados; fetch é único, ≤1000).
  const leadsCustom = useMemo(() => leads.filter((l) => passaFiltrosView(l, view)), [leads, view])
  const rodaveis = useMemo(() => leadsCustom.filter(isRodavel), [leadsCustom])
  // Leads com mensagem já gerada aguardando disparo (modo Semi).
  const gerados = useMemo(() => leadsCustom.filter((l) => !!l.mensagem_gerada && isRodavel(l)), [leadsCustom])
  const previsoesEnvio = useMemo(() => montarPrevisoesAutomaticas(leadsCustom, config), [leadsCustom, config])
  const totalGeracao = geracaoProgresso
    ? geracaoProgresso.eligiveis + geracaoProgresso.prontas + geracaoProgresso.gerando + geracaoProgresso.erros
    : 0
  const processadasGeracao = geracaoProgresso
    ? geracaoProgresso.prontas + geracaoProgresso.erros
    : 0
  const percentualGeracao = geracaoProgresso
    ? (totalGeracao === 0 ? 100 : Math.round((processadasGeracao / totalGeracao) * 100))
    : 0
  // Divisão por origem: Places × Instagram. Ordenação do modal sobrescreve o cabeçalho.
  const leadsPlaces = useMemo(() => {
    const f = leadsCustom.filter((l) => ORIGENS_PLACES.has(l.origem))
    return view.ordenacao !== 'padrao' ? ordenarPorView(f, view.ordenacao) : ordenarLeads(f, ordemPlaces, previsoesEnvio)
  }, [leadsCustom, ordemPlaces, view.ordenacao, previsoesEnvio])
  const leadsIg = useMemo(() => {
    const f = leadsCustom.filter((l) => !ORIGENS_PLACES.has(l.origem))
    return view.ordenacao !== 'padrao' ? ordenarPorView(f, view.ordenacao) : ordenarLeads(f, ordemIg, previsoesEnvio)
  }, [leadsCustom, ordemIg, view.ordenacao, previsoesEnvio])
  const totalFiltrado = leadsPlaces.length + leadsIg.length
  const chips = chipsDaView(view)
  const filtrosAtivos = chips.length + (view.ordenacao !== 'padrao' ? 1 : 0)
  const mercadoOpcoes = useMemo(() => opcoesMercado(filtrosMercado), [filtrosMercado])
  const cidadeOpcoes = filtrosMercado?.cidades || []

  function toggleSel(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); return next }
      if (next.size >= MAX_LOTE) { fb.toast(`Máximo de ${MAX_LOTE} leads por rodada.`, 'info'); return prev }
      next.add(id)
      return next
    })
  }
  function selecionarLote() {
    const ids = rodaveis.slice(0, MAX_LOTE).map((l) => l.id)
    setSelecionados(new Set(ids))
  }

  async function trocarModo(modo: string) {
    if (modo === config.modo) return
    const modoAnterior = config.modo
    // Trocar para Automático só SELECIONA o modo (fica parado); a rotina só liga no
    // botão "Ligar automático", que aí sim mostra o aviso.
    if (modo === 'automatico' && !instanciaId) {
      fb.toast('Escolha uma instância antes de usar o Automático.', 'error'); return
    }
    if (modo === 'semi_automatico' && !instanciaId) {
      fb.toast('Escolha uma instância antes de ativar o Semiautomático.', 'error')
      return
    }
    setConfig((c) => ({
      ...c,
      modo,
      // Trocar para Automático NÃO liga a rotina — o usuário liga no botão (com aviso).
      ...(modo === 'automatico' ? { auto_ativo: false, auto_instancia_id: instanciaId } : {}),
      ...(modo === 'semi_automatico' ? { auto_instancia_id: instanciaId } : {}),
    }))
    setSelecionados(new Set())
    try {
      // Ao entrar no Automático, a instância dos disparos é a MESMA já selecionada na barra
      // (sem pedir de novo). Sincroniza auto_instancia_id; a rotina começa DESLIGADA.
      const body = modo === 'automatico' && instanciaId
        ? { modo, auto_ativo: false, auto_instancia_id: instanciaId }
        : (modo === 'semi_automatico' && instanciaId ? { modo, auto_instancia_id: instanciaId } : { modo })
      const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify(body) })
      setConfig(r.data)
      if (modo === 'automatico') {
        setAba('sem_contato')
        setView((v) => ({ ...v, ordenacao: 'entrou_asc' }))
        fb.toast('Modo Automático selecionado. Clique em "Ligar automático" para iniciar a rotina.')
      }
      if (modo === 'semi_automatico') {
        setAba('sem_contato')
        setView((v) => ({ ...v, ordenacao: 'entrou_asc' }))
        fb.toast('Semiautomático ligado. As mensagens serão preparadas em segundo plano, inclusive para leads novos.')
      }
    } catch (e) {
      setConfig((c) => ({ ...c, modo: modoAnterior }))
      fb.toast(e instanceof Error ? e.message : 'Falha ao salvar o modo.', 'error')
    }
  }

  // Troca a instância da barra. No Semi/Automático, essa MESMA instância vira a
  // referência salva (auto_instancia_id) — sem campo duplicado.
  async function trocarInstancia(id: string) {
    setInstanciaId(id)
    if (config.modo === 'automatico' || config.modo === 'semi_automatico') {
      try {
        const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify({ auto_instancia_id: id || null }) })
        setConfig(r.data)
      } catch { /* silencioso */ }
    }
  }

  // Salva os parâmetros do modo Automático (janela, intervalo, liga/desliga).
  async function salvarAutoConfig(patch: Partial<Config>) {
    setSalvandoAuto(true)
    try {
      const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify(patch) })
      setConfig(r.data)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao salvar a configuração.', 'error') }
    finally { setSalvandoAuto(false) }
  }

  // Liga/desliga a rotina automática. Ao LIGAR, pede confirmação (vai disparar sozinho).
  async function toggleAutoAtivo() {
    if (config.auto_ativo) {
      await salvarAutoConfig({ auto_ativo: false })
      fb.toast('Rotina automática desligada.')
      return
    }
    if (!instanciaId) { fb.toast('Escolha uma instância antes de ligar o Automático.', 'error'); return }
    if (motivoBloqueioConexao) { fb.toast(motivoBloqueioConexao, 'error'); return }
    const ok = window.confirm(
      '⚠️ Ligar o modo AUTOMÁTICO fará o sistema DISPARAR mensagens de WhatsApp sozinho — '
      + 'na janela e no intervalo configurados, usando a instância selecionada.\n\n'
      + 'Confirma ligar a rotina automática?'
    )
    if (!ok) return
    await salvarAutoConfig({ auto_ativo: true, auto_instancia_id: instanciaId })
    fb.toast('Rotina automática ligada. A rotina começa no próximo tick.')
  }

  // SEMI — gera as mensagens (IA/fallback) e deixa prontas aguardando disparo.
  async function gerar() {
    if (!instanciaId) { fb.toast('Escolha uma instância.', 'error'); return }
    const ids = [...selecionados]
    if (!ids.length) { fb.toast('Selecione ao menos um lead.', 'error'); return }
    setGerando(true)
    try {
      const r = await apiFetch<GerarResumo>(`${base}/gerar`, {
        method: 'POST',
        body: JSON.stringify({ instancia_id: instanciaId, prospect_ids: ids }),
      })
      const d = r.data
      const okCount = d.gerados.filter((g) => !g.erro_ia).length
      const erroCount = d.gerados.filter((g) => g.erro_ia).length
      const puladosTxt = d.pulados.length ? ` · ${d.pulados.length} pulado(s)` : ''
      const erroTxt = erroCount ? ` · ${erroCount} com erro de IA (veja "↻ Gerar de novo")` : ''
      fb.sucessoModal('Mensagens geradas', `${okCount} pronta(s) aguardando disparo${erroTxt}${puladosTxt}.`)
      setSelecionados(new Set())
      await carregarLeads()
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Falha ao gerar mensagens.', 'error')
    } finally { setGerando(false) }
  }

  // SEMI — re-gera a mensagem de um único lead (após erro de IA).
  async function gerarUm(id: string): Promise<string | null> {
    if (!instanciaId) { fb.toast('Escolha uma instância.', 'error'); return null }
    try {
      const r = await apiFetch<GerarResumo>(`${base}/gerar`, {
        method: 'POST', body: JSON.stringify({ instancia_id: instanciaId, prospect_ids: [id] }),
      })
      const g = r.data.gerados?.[0]
      if (g && !g.erro_ia) fb.toast('Mensagem gerada.')
      else fb.toast('A IA falhou de novo. Tente mais tarde.', 'info')
      await carregarLeads()
      return g && !g.erro_ia ? (g.mensagem || null) : null
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao gerar.', 'error') }
    return null
  }

  async function gerarMensagemConversa() {
    if (!conversaAberta || !instanciaId) return
    if (!conversaAberta.rodavel) { fb.toast('Este lead nao esta elegivel para gerar mensagem.', 'info'); return }
    if (config.modo === 'automatico') { fb.toast('No Automatico, a geracao acontece pela rotina configurada.', 'info'); return }
    setGerandoConversa(true)
    try {
      const texto = await gerarUm(conversaAberta.leadId)
      if (texto) setConversaAberta((cur) => cur ? { ...cur, mensagemGerada: texto } : cur)
    } finally {
      setGerandoConversa(false)
    }
  }

  // ENVIO INDIVIDUAL pelo modal de conversa (manual e semi). Sem disparo em massa —
  // 1 lead por vez, respeitando o cooldown. Semi usa a mensagem já gerada
  // (/disparar-gerados); manual gera na hora (/rodar).
  async function enviarLeadConversa() {
    if (!conversaAberta || !instanciaId) return
    if (!conversaAberta.rodavel) { fb.toast('Este lead nao esta elegivel para envio.', 'info'); return }
    if (config.modo === 'automatico') { fb.toast('No Automatico, os envios saem pela rotina configurada.', 'info'); return }
    if (motivoBloqueioConexao) { fb.toast(motivoBloqueioConexao, 'error'); return }
    if (bloquearPorCooldown()) return
    const { leadId, mensagemGerada } = conversaAberta
    setEnviandoConversa(true)
    try {
      const endpoint = mensagemGerada ? `${base}/disparar-gerados` : `${base}/rodar`
      const r = await apiFetch<RodarResumo>(endpoint, {
        method: 'POST', body: JSON.stringify({ instancia_id: instanciaId, prospect_ids: [leadId] }),
      })
      const envio = r.data.envios?.find((e) => e.prospect_id === leadId) || r.data.envios?.[0]
      if (envio?.status === 'enviado') {
        fb.toast('Mensagem enviada.')
        carregarCooldown()
        setConversaAberta(null)
        setTimeout(() => { carregarLeads(); carregarResumo() }, 800)
        return
      }
      if (envio?.status === 'falhou') {
        const ERROS: Record<string, string> = {
          message_error: 'A Evolution/WhatsApp rejeitou este envio. A mensagem nao chegou.',
          sem_whatsapp: 'Este numero nao tem WhatsApp - nao da pra enviar.',
          ia_falhou: 'A IA falhou ao gerar a mensagem. Gere de novo antes de enviar.',
          instance_disconnected: 'A instancia WhatsApp nao esta conectada.',
        }
        fb.toast(ERROS[envio.erro || ''] || `Envio falhou (${envio.erro || 'erro desconhecido'}).`, 'error')
        setTimeout(() => { carregarLeads(); carregarResumo() }, 800)
        return
      }
      if (r.data.rodada && r.data.aceitos.length) {
        fb.toast('Mensagem na fila de envio.')
        carregarCooldown()
        setConversaAberta(null)
        setTimeout(() => { carregarLeads(); carregarResumo() }, 2500)
      } else {
        const motivo = r.data.pulados?.[0]?.motivo
        const MOTIVOS: Record<string, string> = {
          sem_whatsapp: 'Este número não tem WhatsApp — não dá pra enviar.',
          bloqueado: 'Lead bloqueado (trava anti-ban).',
          sem_telefone: 'Lead sem telefone.',
          telefone_ja_contatado: 'Esse telefone já recebeu contato por outro cadastro (duplicado).',
        }
        fb.toast(motivo ? (MOTIVOS[motivo] || `Não enviado (${motivo}).`) : 'Nada para enviar.', motivo === 'sem_whatsapp' ? 'error' : 'info')
        if (motivo === 'sem_whatsapp') { setConversaAberta(null); setTimeout(() => { carregarLeads(); carregarResumo() }, 1200) }
      }
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao enviar.', 'error') }
    finally { setEnviandoConversa(false) }
  }

  // SEMI — abre o próximo lead com mensagem gerada pendente (fila visual; envio 1 a 1).
  function abrirProximoParaEnviar() {
    const prox = gerados[0]
    if (!prox) { fb.toast('Nenhuma mensagem pendente para enviar.', 'info'); return }
    abrirConversa(prox)
  }

  async function fechar(id: string) {
    try {
      await fb.runTask(() => apiFetch(`${base}/leads/${id}/fechar`, { method: 'POST' }),
        { sucesso: 'Lead marcado como fechado. 🎉' })
      setLeads((prev) => prev.filter((l) => l.id !== id))
      carregarResumo()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function reabrir(id: string) {
    try {
      await fb.runTask(() => apiFetch(`${base}/leads/${id}/reabrir`, { method: 'POST' }),
        { sucesso: 'Lead reaberto.' })
      setLeads((prev) => prev.filter((l) => l.id !== id))
      carregarResumo()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function fecharConversa() {
    if (!conversaAberta) return
    await fechar(conversaAberta.leadId)
    setConversaAberta(null)
  }

  async function reabrirConversa() {
    if (!conversaAberta) return
    await reabrir(conversaAberta.leadId)
    setConversaAberta(null)
  }

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`${base}/leads/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, email: email || null } : l)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  async function limpar() {
    if (!confirm('Apagar TODOS os leads sem e-mail E sem telefone?\n\nIsso remove os leads sem nenhuma forma de contato (negócios fechados são preservados). Ação irreversível.')) return
    setLimpando(true)
    try {
      const r = await apiFetch<{ removidos: number }>(`${base}/limpar`, { method: 'POST' })
      fb.sucessoModal('Limpeza concluída', `${r.data.removidos} lead(s) sem contato removido(s).`)
      await carregarLeads()
      await carregarResumo()
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Falha na limpeza.', 'error')
    } finally { setLimpando(false) }
  }

  async function exportar() {
    setExportando(true)
    try {
      const nome = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}.csv`
      await fb.runTask(() => apiDownload(`${base}/export.csv?${query()}`, nome), { sucesso: 'CSV exportado.' })
    } catch { /* erro já exibido pelo feedback */ }
    finally { setExportando(false) }
  }

  const mostrarRodar = aba === 'sem_contato'
  // Sem seleção em lote: envio é 1 a 1 pelo telefone/modal (manual e semi). Sem checkbox.
  const mostrarSelecao = false
  const modoAtual = MODOS.find((m) => m.valor === config.modo) || MODOS[0]
  // Enviar fica liberado em Manual e Semi: se não houver mensagem gerada, o backend gera na hora.
  const podeEnviarConversa = !!conversaAberta && !!instanciaId && conversaAberta.rodavel
    && config.modo !== 'automatico' && !motivoBloqueioConexao
  const podeGerarConversa = !!conversaAberta && !!instanciaId && conversaAberta.rodavel
    && config.modo !== 'automatico'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Banco de Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            Central de disparo dos leads das duas origens. Escolha o modo (Manual, Semiautomático
            ou Automático), selecione os leads e dispare a saudação pela instância escolhida.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setCadastroOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark">
            <IconPlus /> Adicionar cadastro
          </button>
          <button onClick={limpar} disabled={limpando}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            title="Apaga todos os leads sem e-mail e sem telefone (negócios fechados são preservados)">
            {limpando && <Spinner />}
            {limpando ? 'Limpando…' : <span className="inline-flex items-center gap-1.5"><IconBroom /> Limpeza</span>}
          </button>
          <button onClick={exportar} disabled={exportando || !leads.length}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {exportando && <Spinner />}
            {exportando ? 'Gerando…' : <span className="inline-flex items-center gap-1.5"><IconDownload /> Exportar CSV</span>}
          </button>
        </div>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {msg && <p className="text-emerald-600 text-sm">{msg}</p>}

      {/* Abas do funil */}
      <div className="flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <button key={a.valor} onClick={() => setAba(a.valor)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
              aba === a.valor ? 'bg-brand text-white border-brand' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}>
            {a.label}
            {resumo && <span className="ml-2 opacity-70">{resumo.abas[a.valor] ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* Barra "Rodar leads" — adapta ao modo. Só na aba Sem contato. */}
      {mostrarRodar && (
        <div className="bg-white border rounded-2xl shadow-sm p-4 space-y-3">
          {saudacaoFaltando && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <IconAlert className="h-4 w-4 shrink-0" />
              <span>Você precisa configurar a saudação primeiro — clique em <b>Testar envio</b>.</span>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Modo de disparo</label>
                <select value={config.modo} onChange={(e) => trocarModo(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {MODOS.map((m) => <option key={m.valor} value={m.valor} disabled={m.disabled}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Instância</label>
                <select value={instanciaId} onChange={(e) => trocarInstancia(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {!instancias.length && <option value="">Nenhuma instância ativa</option>}
                  {instancias.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome || i.evolution_instance}
                    </option>
                  ))}
                </select>
                <div className={`mt-1 flex items-center gap-1.5 text-[11px] font-medium ${classeConexao}`}>
                  <span className={`h-2 w-2 rounded-full ${statusConexao?.connected === true ? 'bg-emerald-500' : statusConexao?.connected === false ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <span>{rotuloConexao}</span>
                  <button
                    type="button"
                    onClick={carregarConexoes}
                    disabled={!instanciaId || verificandoConexao}
                    className="ml-0.5 text-slate-400 hover:text-brand disabled:opacity-40"
                    title="Atualizar status da conexão"
                    aria-label="Atualizar status da conexão"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                {config.modo !== 'automatico' ? (
                  <div ref={cronRef}
                    className={`flex min-w-0 items-start gap-2 transition-all ${flashCron ? 'rounded-lg bg-amber-50 p-2 ring-2 ring-amber-400' : ''}`}
                    title={motivoBloqueioConexao || 'Tempo até o próximo envio ficar liberado (cooldown anti-bloqueio)'}>
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      motivoBloqueioConexao ? 'bg-red-500' : cooldownAtivo ? 'bg-amber-400' : 'bg-emerald-500'
                    }`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${
                        motivoBloqueioConexao ? 'text-red-700' : cooldownAtivo ? 'text-amber-700' : 'text-emerald-700'
                      }`}>
                        {motivoBloqueioConexao
                          ? 'Envio indisponível'
                          : cooldownAtivo
                          ? <>Próximo envio em <span className="tabular-nums">{fmtMMSS(cooldownS as number)}</span></>
                          : 'Envio liberado'}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        {motivoBloqueioConexao
                          || (cooldownAtivo
                            ? 'Aguarde o intervalo de segurança antes do próximo envio.'
                            : config.modo === 'semi_automatico'
                            ? 'Clique no telefone do lead para revisar a mensagem e enviar.'
                            : 'Clique no telefone do lead para gerar e enviar a saudação.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">Automático</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                      Envia 1 lead por vez na janela configurada.
                    </p>
                  </div>
                )}

                <button onClick={() => setSaudacaoOpen(true)} disabled={!instanciaId}
                  className={`shrink-0 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${
                    saudacaoFaltando
                      ? 'border-red-500 text-red-600 ring-2 ring-red-400 ring-offset-1 animate-pulse hover:bg-red-50'
                      : 'hover:bg-slate-50'
                  }`}
                  title={saudacaoFaltando
                    ? 'Configure a saudação (mensagem-base) desta instância antes de disparar'
                    : 'Envia uma mensagem de teste pro seu número e ajusta a saudação/IA'}>
                  <span className="inline-flex items-center gap-1.5"><IconFlask /> Testar envio</span>
                </button>
              </div>

              {config.modo !== 'automatico' && (
                <p className="border-t pt-2 text-xs leading-relaxed text-slate-500">{modoAtual.hint}</p>
              )}
            </div>
          </div>

          {/* Progresso do worker Semiautomático — observação apenas; não dispara geração no browser. */}
          {config.modo === 'semi_automatico' && (
            <div className="mt-2 rounded-xl border bg-slate-50/60 p-3 space-y-2" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Preparando mensagens em segundo plano</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Pode sair desta tela. O sistema continua trabalhando e inclui automaticamente os leads novos.
                  </p>
                </div>
                <span className="text-sm font-bold tabular-nums text-slate-700">
                  {geracaoProgresso ? `${percentualGeracao}%` : geracaoProgressoErro ? 'Indisponível' : 'Lendo…'}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar"
                aria-label="Progresso da geração das mensagens" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={geracaoProgresso ? percentualGeracao : undefined}>
                <div className={`h-full rounded-full transition-[width] duration-500 ${geracaoProgresso?.erros ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${percentualGeracao}%` }} />
              </div>
              {geracaoProgresso && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span><b className="text-emerald-700">{geracaoProgresso.prontas}</b> pronta(s)</span>
                  <span><b className="text-blue-700">{geracaoProgresso.gerando}</b> gerando agora</span>
                  <span><b className="text-slate-700">{geracaoProgresso.eligiveis}</b> pendente(s)</span>
                  {geracaoProgresso.erros > 0 && <span className="text-amber-700"><b>{geracaoProgresso.erros}</b> com erro de IA</span>}
                </div>
              )}
              {!geracaoProgresso && geracaoProgressoErro && (
                <p className="text-xs text-amber-700">Não foi possível atualizar o progresso agora. Tentando novamente…</p>
              )}
            </div>
          )}

          {/* Config do modo Automático */}
          {config.modo === 'automatico' && (
            <div className="mt-2 rounded-xl border bg-slate-50/60 p-3 space-y-2">
              {/* Status claro + botão Ligar/Desligar (com aviso ao ligar). */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-2 text-sm font-bold ${config.auto_ativo ? (motivoBloqueioConexao ? 'text-red-700' : 'text-emerald-700') : 'text-slate-500'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${config.auto_ativo ? (motivoBloqueioConexao ? 'bg-red-500' : 'bg-emerald-500 animate-pulse') : 'bg-slate-300'}`}></span>
                  {config.auto_ativo ? (motivoBloqueioConexao ? 'Aguardando conexão' : 'Rodando') : 'Parado'}
                </span>
                <div className="flex items-center gap-2">
                  {salvandoAuto && <span className="text-xs text-slate-400">salvando...</span>}
                  <button onClick={toggleAutoAtivo}
                    disabled={salvandoAuto || !instanciaId || (!config.auto_ativo && !!motivoBloqueioConexao)}
                    title={!config.auto_ativo && motivoBloqueioConexao ? motivoBloqueioConexao : undefined}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${config.auto_ativo ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                    {salvandoAuto && <Spinner />}
                    {config.auto_ativo ? '■ Desligar' : '▶ Ligar'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Início</label>
                  <input type="time" value={config.janela_inicio} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, janela_inicio: e.target.value }))}
                    onBlur={(e) => salvarAutoConfig({ janela_inicio: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Fim</label>
                  <input type="time" value={config.janela_fim} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, janela_fim: e.target.value }))}
                    onBlur={(e) => salvarAutoConfig({ janela_fim: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Mín. (min)</label>
                  <input type="number" min={15} max={30} value={config.intervalo_min} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, intervalo_min: Number(e.target.value) }))}
                    onBlur={(e) => salvarAutoConfig({ intervalo_min: Number(e.target.value) })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Máx. (min)</label>
                  <input type="number" min={15} max={30} value={config.intervalo_max} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, intervalo_max: Number(e.target.value) }))}
                    onBlur={(e) => salvarAutoConfig({ intervalo_max: Number(e.target.value) })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Teto/dia</label>
                  <input type="text" value={`${config.teto_diario} (fixo)`} disabled readOnly
                    className="w-full border rounded-lg px-2 py-1.5 text-sm bg-slate-100 text-slate-500"
                    title="Limite de segurança anti-ban. O volume real é limitado pelo intervalo × janela." />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Origem</label>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            {ORIGENS.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">Buscar (nome, telefone, email, @)</label>
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="digite para filtrar…" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Nicho/Categoria</label>
          <select value={mercado} onChange={(e) => setMercado(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm min-w-[180px]">
            <option value="">Todos os nichos</option>
            {mercadoOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Cidade</label>
          <select value={cidadeFiltro} onChange={(e) => setCidadeFiltro(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm min-w-[150px]">
            <option value="">Todas</option>
            {cidadeOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
          </select>
        </div>
        {(mercado || cidadeFiltro) && (
          <div>
            <label className="block text-xs text-slate-500 mb-1">&nbsp;</label>
            <button onClick={() => { setMercado(''); setCidadeFiltro('') }}
              className="border rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Limpar mercado
            </button>
          </div>
        )}
        <div>
          <label className="block text-xs text-slate-500 mb-1">&nbsp;</label>
          <button onClick={() => setPersAberto(true)}
            className={`inline-flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${filtrosAtivos ? 'border-brand text-brand' : ''}`}>
            <span className="inline-flex items-center gap-1.5"><IconGear /> Personalizar</span>
            {filtrosAtivos > 0 && <span className="text-[10px] bg-brand text-white rounded-full px-1.5 py-0.5">{filtrosAtivos}</span>}
          </button>
        </div>
      </div>

      {/* Chips de filtros ativos + contagem de resultados */}
      {filtrosAtivos > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">{totalFiltrado} lead(s) encontrado(s)</span>
          {chips.map((ch) => <span key={ch} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border">{ch}</span>)}
          {view.ordenacao !== 'padrao' && (
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-brand border border-blue-100">↕ {ORDENACOES.find((o) => o.valor === view.ordenacao)?.label}</span>
          )}
          <button onClick={() => setView(VIEW_PADRAO)} className="text-brand hover:underline">Limpar tudo</button>
        </div>
      )}

      {/* Tabelas por origem — mesmas colunas/pontuação/ordenação/JSON da Aquisição */}
      {carregando && !leads.length ? (
        <p className="text-sm text-slate-400 text-center py-8">Carregando…</p>
      ) : !leads.length ? (
        <p className="text-sm text-slate-400 text-center py-8">
          {aba === 'agendados' ? 'Nenhum contato agendado no momento.'
            : aba === 'descartados' ? 'Nenhum lead descartado.'
            : 'Nenhum lead nesta aba.'}
        </p>
      ) : totalFiltrado === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">
          Nenhum lead encontrado com esses filtros. Tente remover algum filtro ou{' '}
          <button onClick={() => setView(VIEW_PADRAO)} className="text-brand hover:underline">restaurar a visualização padrão</button>.
        </p>
      ) : (
        <>
          {leadsPlaces.length > 0 && (
            <TabelaPlacesBanco
              leads={leadsPlaces}
              ordem={ordemPlaces}
              onOrdenar={(chave) => setOrdemPlaces((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))}
              mostrarRodar={mostrarSelecao}
              cols={view.cols}
              previsoesEnvio={previsoesEnvio}
              selecionados={selecionados}
              onToggleSel={toggleSel}
              onAbrirConversa={abrirConversa}
              onSalvarEmail={salvarEmail}
              onAbrirJson={(l) => l.json_apresentacao && setJsonAberto({ titulo: l.nome, json: l.json_apresentacao })}
            />
          )}
          {leadsIg.length > 0 && (
            <TabelaInstagramBanco
              leads={leadsIg}
              ordem={ordemIg}
              onOrdenar={(chave) => setOrdemIg((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))}
              mostrarRodar={mostrarSelecao}
              cols={view.cols}
              previsoesEnvio={previsoesEnvio}
              selecionados={selecionados}
              onToggleSel={toggleSel}
              onAbrirConversa={abrirConversa}
              onSalvarEmail={salvarEmail}
              onAbrirJson={(l) => l.json_apresentacao && setJsonAberto({ titulo: l.nome, json: l.json_apresentacao })}
            />
          )}
        </>
      )}

      {jsonAberto && (
        <JsonLeadModal titulo={`JSON de apresentação — ${jsonAberto.titulo}`} json={jsonAberto.json} onFechar={() => setJsonAberto(null)} />
      )}

      {conversaAberta && (
        <ConversaHistoricoModal
          empresaId={empresaId}
          numero={conversaAberta.numero}
          titulo={conversaAberta.titulo}
          status={conversaAberta.status}
          mensagemGerada={conversaAberta.mensagemGerada}
          podeEnviar={podeEnviarConversa}
          podeGerar={podeGerarConversa}
          motivoEnvioIndisponivel={config.modo === 'automatico'
            ? 'No modo Automático, o envio é controlado pela rotina configurada.'
            : motivoBloqueioConexao}
          cooldownS={cooldownS}
          enviando={enviandoConversa}
          gerando={gerandoConversa}
          onEnviar={enviarLeadConversa}
          onGerar={gerarMensagemConversa}
          onFechar={fecharConversa}
          onReabrir={reabrirConversa}
          onClose={() => setConversaAberta(null)}
        />
      )}

      {persAberto && (
        <PersonalizarModal
          view={view}
          onPatch={patchView}
          onReset={() => setView(VIEW_PADRAO)}
          onPreset={(patch, novaAba) => { setView({ ...VIEW_PADRAO, ...patch }); if (novaAba) setAba(novaAba); setPersAberto(false) }}
          onClose={() => setPersAberto(false)}
        />
      )}

      {cadastroOpen && (
        <CadastroModal
          base={base}
          onClose={() => setCadastroOpen(false)}
          onSaved={() => { setCadastroOpen(false); carregarLeads(); carregarResumo() }}
        />
      )}

      {saudacaoOpen && instanciaSel && (
        <TestarEnvioModal
          empresaId={empresaId}
          base={base}
          instancia={instanciaSel}
          config={config}
          motivoTesteIndisponivel={motivoBloqueioConexao}
          onClose={() => setSaudacaoOpen(false)}
          onSavedTemplate={(texto) => {
            setInstancias((prev) => prev.map((i) => (i.id === instanciaSel.id ? { ...i, config_json: { ...(i.config_json || {}), saudacao: texto } } : i)))
          }}
          onSavedConfig={(c) => setConfig(c)}
        />
      )}
    </div>
  )
}

// ─── Tabelas por origem (mesmo layout da Aquisição) ────────────────────────────
type TabelaProps = {
  leads: Lead[]
  ordem: Ordem
  onOrdenar: (chave: string) => void
  mostrarRodar: boolean
  cols: Record<string, boolean>
  previsoesEnvio: Map<string, PrevisaoEnvio>
  selecionados: Set<string>
  onToggleSel: (id: string) => void
  onAbrirConversa: (l: Lead) => void
  onSalvarEmail: (id: string, email: string) => Promise<void>
  onAbrirJson: (l: Lead) => void
}

// Célula de status compartilhada (badge + trava + último disparo).
function StatusCelula({ l }: { l: Lead }) {
  const locked = isLocked(l)
  return (
    <td className="px-3 py-2">
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[l.status] || 'bg-slate-100 text-slate-600'}`}>
        {STATUS_LABEL[l.status] || l.status}
      </span>
      {locked && (
        <div className="inline-flex items-center gap-1 text-[11px] text-red-600 mt-1">
          <IconLock className="h-3 w-3" /> travado até {fmtData(l.bloqueado_ate)}{l.bloqueio_motivo ? ` (${MOTIVO_LABEL[l.bloqueio_motivo] || l.bloqueio_motivo})` : ''}
        </div>
      )}
      {l.rodado_em && (
        <div className="text-[11px] text-slate-400 mt-0.5">
          Disparado{l.rodado_por ? ` por ${l.rodado_por}` : ''} em {fmtData(l.rodado_em)}
        </div>
      )}
      {falhaEnvio(l) && (
        <div className="inline-flex items-center gap-1 text-[11px] text-red-600 mt-1 font-medium">
          <IconAlert className="h-3 w-3" /> Falha no envio: {falhaEnvio(l)}{isRodavel(l) ? ' — vai tentar de novo' : ''}
        </div>
      )}
      {motivoDescarte(l) && (
        <div className="inline-flex items-center gap-1 text-[11px] text-red-600 mt-1 font-medium"><IconTrash className="h-3 w-3" /> Descartado: {motivoDescarte(l)}</div>
      )}
      {temErroIa(l) && (
        <div className="inline-flex items-center gap-1 text-[11px] text-amber-600 mt-1"><IconAlert className="h-3 w-3" /> Erro ao gerar a mensagem (IA)</div>
      )}
      {l.proximo_agendamento && (
        <div className="inline-flex items-center gap-1 text-[11px] text-sky-700 mt-1 font-medium"><IconCalendar className="h-3 w-3" /> Agendado: {fmtDataHora(l.proximo_agendamento)}</div>
      )}
    </td>
  )
}

function EnvioCelula({ l, previsoesEnvio }: { l: Lead; previsoesEnvio: Map<string, PrevisaoEnvio> }) {
  const auto = previsoesEnvio.get(l.id)
  const info: PrevisaoEnvio = auto || (
    l.ultimo_status === 'enviando' ? { titulo: 'Na fila', detalhe: 'Enviando agora', tom: 'pronto' }
      : l.ultimo_status === 'pendente_confirmacao' ? { titulo: 'Confirmando', detalhe: 'Aguardando entrega do WhatsApp', tom: 'pronto' }
      : l.ultimo_status === 'gerando' ? { titulo: 'Gerando', detalhe: 'Preparando mensagem', tom: 'pronto' }
      : l.ultimo_status === 'enviado' ? { titulo: 'Enviado', detalhe: fmtDataHora(l.rodado_em), tom: 'enviado' }
      : temErroIa(l) ? { titulo: 'Erro IA', detalhe: 'Gerar de novo na conversa', tom: 'erro' }
      : falhaEnvio(l) ? { titulo: 'Falhou', detalhe: `${falhaEnvio(l)}${isRodavel(l) ? ' — tentará de novo' : ''}`, tom: 'erro' }
      : l.mensagem_gerada ? { titulo: 'Pronta', detalhe: `Gerada em ${fmtDataHora(l.gerada_em)}`, tom: 'pronto' }
      : isRodavel(l) ? { titulo: 'Aguardando geração', detalhe: 'Semi gera automaticamente', tom: 'neutro' }
      : { titulo: 'Sem previsão', detalhe: motivoDescarte(l) || STATUS_LABEL[l.status] || l.status, tom: 'neutro' }
  )
  const cls = {
    auto: 'bg-sky-50 text-sky-700 border-sky-200',
    pronto: 'bg-amber-50 text-amber-700 border-amber-200',
    enviado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    erro: 'bg-red-50 text-red-700 border-red-200',
    neutro: 'bg-slate-50 text-slate-600 border-slate-200',
  }[info.tom]
  return (
    <td className="px-3 py-2 min-w-[150px]">
      <div className={`inline-flex flex-col rounded-lg border px-2 py-1 ${cls}`}>
        <span className="text-xs font-semibold leading-tight">{info.titulo}</span>
        {info.detalhe && <span className="text-[11px] leading-tight opacity-80">{info.detalhe}</span>}
      </div>
    </td>
  )
}

// Glifo do WhatsApp (SVG inline — sem depender de asset externo).
function IconeWhatsapp({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.78 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2z"/>
    </svg>
  )
}

// Coluna Telefone: número CLICÁVEL (abre a conversa) + indicadores discretos:
//  ícone de envelope dentro do botão = mensagem gerada aguardando envio;
//  selo verde = WhatsApp verificado; aviso = sem conta WhatsApp (disparo não chegou).
function TelefoneCelula({ l, onAbrirConversa }: { l: Lead; onAbrirConversa: (l: Lead) => void }) {
  const msgPronta = !!l.mensagem_gerada
  return (
    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
      {l.telefone ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAbrirConversa(l)}
            className={`group -mx-1 inline-flex cursor-pointer flex-col items-start rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${msgPronta ? 'text-amber-700 font-semibold' : 'text-brand'}`}
            title={msgPronta ? 'Mensagem pronta - clique para abrir a conversa e enviar' : 'Clique para abrir a conversa'}
            aria-label={`Abrir conversa com ${l.nome} pelo numero ${l.telefone}`}>
            <span className="inline-flex items-center gap-1">
              <span className="underline decoration-current underline-offset-2 group-hover:decoration-2">{l.telefone}</span>
              {msgPronta && <IconSend className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />}
            </span>
            <span className="font-sans text-[10px] font-medium leading-3 text-slate-500 group-hover:text-brand">
              Abrir conversa →
            </span>
          </button>
          {l.tem_whatsapp === true && (
            <IconeWhatsapp className="text-emerald-500 shrink-0" />
          )}
          {l.tem_whatsapp === false && (
            <span className="text-[10px] text-slate-400 whitespace-nowrap" title="Disparo não chegou — número sem conta WhatsApp">sem WhatsApp</span>
          )}
        </span>
      ) : '—'}
    </td>
  )
}

function JsonCelula({ l, onAbrirJson }: { l: Lead; onAbrirJson: (l: Lead) => void }) {
  return (
    <td className="px-3 py-2">
      {l.json_apresentacao && (
        <button onClick={() => onAbrirJson(l)}
          className="text-xs px-2 py-1 rounded-lg border text-brand hover:bg-blue-50"
          title="Dados unificados + prompt único pro bot gerar a saudação de análise">
          {'{ }'}
        </button>
      )}
    </td>
  )
}

function SelCelula({ l, selecionados, onToggleSel }: { l: Lead; selecionados: Set<string>; onToggleSel: (id: string) => void }) {
  return (
    <td className="px-3 py-2">
      <input type="checkbox" checked={selecionados.has(l.id)} disabled={!isRodavel(l)}
        onChange={() => onToggleSel(l.id)} aria-label={`Selecionar ${l.nome}`} />
    </td>
  )
}

function TabelaPlacesBanco({ leads, ordem, onOrdenar, mostrarRodar, cols, previsoesEnvio, selecionados, onToggleSel, onAbrirConversa, onSalvarEmail, onAbrirJson }: TabelaProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <h2 className="text-sm font-semibold">Google Places</h2>
        <span className="text-xs text-slate-400">{leads.length} lead{leads.length === 1 ? '' : 's'}</span>
      </div>
      <DataTableFrame>
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {mostrarRodar && <th className="px-3 py-2 w-8" />}
              {cols.entrou && <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={onOrdenar} />}
              <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={onOrdenar} />
              {cols.telefone && <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.envio_previsto && <ThOrdenavel label="Envio" chave="envio" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.pontos && <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.status && <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.email && <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.endereco && <ThOrdenavel label="Endereço" chave="endereco" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.nicho && <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.aval && <ThOrdenavel label="Aval." chave="aval" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.nota && <ThOrdenavel label="Nota" chave="nota" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.horario && <ThOrdenavel label="Horário" chave="horario" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.site && <ThOrdenavel label="Site" chave="site" ordem={ordem} onOrdenar={onOrdenar} />}
              <th className="text-left px-3 py-2">JSON</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => {
              const horario = !!l.json_apresentacao?.empresa?.horario_funcionamento
              return (
                <tr key={l.id} className="hover:bg-slate-50/60 align-top">
                  {mostrarRodar && <SelCelula l={l} selecionados={selecionados} onToggleSel={onToggleSel} />}
                  {cols.entrou && <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDataHora(l.created_at)}</td>}
                  <td className="px-3 py-2 font-medium">
                    {l.maps_url ? (
                      <a href={l.maps_url} target="_blank" rel="noreferrer"
                        className="text-brand hover:underline inline-flex items-center gap-1" title="Ver ficha no Google Maps">
                        {l.nome} <span className="text-xs text-slate-400">↗</span>
                      </a>
                    ) : (l.nome || '—')}
                  </td>
                  {cols.telefone && <TelefoneCelula l={l} onAbrirConversa={onAbrirConversa} />}
                  {cols.envio_previsto && <EnvioCelula l={l} previsoesEnvio={previsoesEnvio} />}
                  {cols.pontos && (
                    <td className="px-3 py-2 text-right">
                      <span className={`font-semibold ${((l.score_cadastro ?? 0) <= 40) ? 'text-red-600' : (l.score_cadastro ?? 0) <= 70 ? 'text-amber-600' : 'text-emerald-600'}`}
                        title="Pontuação do cadastro (0-100): site 20 · fotos, endereço, telefone, e-mail, horário, links extras, avaliações e nota>4 valem 10 cada">
                        {l.score_cadastro ?? 0}
                      </span>
                      <span className="text-[10px] text-slate-400">/100</span>
                    </td>
                  )}
                  {cols.status && <StatusCelula l={l} />}
                  {cols.email && <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => onSalvarEmail(l.id, email)} /></td>}
                  {cols.endereco && <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate" title={l.endereco || ''}>{l.endereco || '—'}</td>}
                  {cols.nicho && <td className="px-3 py-2 text-slate-600 text-xs">{[l.nicho, l.cidade].filter(Boolean).join(' · ') || '—'}</td>}
                  {cols.aval && <td className="px-3 py-2 text-right text-xs">{l.avaliacoes ?? '—'}</td>}
                  {cols.nota && <td className="px-3 py-2 text-right text-xs">{l.rating != null ? Number(l.rating).toFixed(1) : '—'}</td>}
                  {cols.horario && <td className="px-3 py-2 text-center">{horario ? '✅' : '❌'}</td>}
                  {cols.site && (
                    <td className="px-3 py-2">
                      {l.site ? (
                        <a href={l.site} target="_blank" rel="noreferrer" className="hover:underline" title={l.site}>✅ <span className="text-xs text-brand">site</span></a>
                      ) : l.tem_site ? '✅' : '❌'}
                    </td>
                  )}
                  <JsonCelula l={l} onAbrirJson={onAbrirJson} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}

function TabelaInstagramBanco({ leads, ordem, onOrdenar, mostrarRodar, cols, previsoesEnvio, selecionados, onToggleSel, onAbrirConversa, onSalvarEmail, onAbrirJson }: TabelaProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <h2 className="text-sm font-semibold">Instagram</h2>
        <span className="text-xs text-slate-400">{leads.length} lead{leads.length === 1 ? '' : 's'}</span>
      </div>
      <DataTableFrame>
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {mostrarRodar && <th className="px-3 py-2 w-8" />}
              {cols.entrou && <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={onOrdenar} />}
              <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="@username" chave="username" ordem={ordem} onOrdenar={onOrdenar} />
              {cols.nicho && <ThOrdenavel label="Nicho" chave="nicho" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.seguidores && <ThOrdenavel label="Seguidores" chave="seguidores" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.telefone && <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.envio_previsto && <ThOrdenavel label="Envio" chave="envio" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.pontos && <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.status && <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.email && <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.links && <ThOrdenavel label="Links" chave="links" ordem={ordem} onOrdenar={onOrdenar} />}
              <th className="text-left px-3 py-2">JSON</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60 align-top">
                {mostrarRodar && <SelCelula l={l} selecionados={selecionados} onToggleSel={onToggleSel} />}
                {cols.entrou && <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDataHora(l.created_at)}</td>}
                <td className="px-3 py-2 font-medium text-slate-900 max-w-[200px] truncate" title={l.bio || l.nome}>{l.nome || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {l.instagram_handle ? (
                    <a href={`https://instagram.com/${l.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                      className="text-brand hover:underline">@{l.instagram_handle.replace(/^@/, '')}</a>
                  ) : '—'}
                </td>
                {cols.nicho && (
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={[l.nicho, l.categoria_perfil, l.cidade].filter(Boolean).join(' · ')}>
                    {l.nicho || l.categoria_perfil || '—'}
                  </td>
                )}
                {cols.seguidores && <td className="px-3 py-2 text-right text-xs font-semibold">{l.seguidores != null ? l.seguidores.toLocaleString('pt-BR') : '—'}</td>}
                {cols.telefone && <TelefoneCelula l={l} onAbrirConversa={onAbrirConversa} />}
                {cols.envio_previsto && <EnvioCelula l={l} previsoesEnvio={previsoesEnvio} />}
                {cols.pontos && (
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${((l.score_cadastro ?? 0) <= 20) ? 'text-red-600' : (l.score_cadastro ?? 0) <= 40 ? 'text-amber-600' : 'text-emerald-600'}`}
                      title="Pontuação do cadastro: 10 pontos por coluna (nicho, seguidores, telefone, e-mail, links, @username)">
                      {l.score_cadastro ?? 0}
                    </span>
                    <span className="text-[10px] text-slate-400">/{l.score_cadastro_max ?? 60}</span>
                  </td>
                )}
                {cols.status && <StatusCelula l={l} />}
                {cols.email && <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => onSalvarEmail(l.id, email)} /></td>}
                {cols.links && (
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-slate-500 underline mr-2">bio</a>}
                    {l.site && <a href={l.site} target="_blank" rel="noreferrer" className="text-slate-500 underline">site</a>}
                    {!l.link_bio && !l.site && '—'}
                  </td>
                )}
                <JsonCelula l={l} onAbrirJson={onAbrirJson} />
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}

// ─── Modal Personalizar visualização (colunas + filtros + ordenação + presets) ──
const PRESETS: { nome: string; dica: string; patch: Partial<ViewConfig>; aba?: string }[] = [
  { nome: 'Oportunidades fortes', dica: 'Boa pontuação, com telefone, sem disparo', patch: { scoreMin: '70', telefone: 'com', disparo: 'nao_disparado', ordenacao: 'pontos_desc' } },
  { nome: 'Sem presença digital', dica: 'Sem site, com telefone', patch: { site: 'sem', telefone: 'com', disparo: 'nao_disparado' }, aba: 'sem_contato' },
  { nome: 'Baixa autoridade', dica: 'Poucas avaliações', patch: { avalMax: '10', ordenacao: 'aval_asc' } },
  { nome: 'Prontos para disparo', dica: 'Com telefone e mensagem gerada', patch: { telefone: 'com', msgGerada: 'com' } },
  { nome: 'Agendados próximos', dica: 'Agendamento futuro primeiro', patch: { agendamento: 'com', ordenacao: 'agendamento_asc' }, aba: 'agendados' },
  { nome: 'Pendentes de mensagem', dica: 'Sem mensagem gerada', patch: { msgGerada: 'sem' } },
  { nome: 'Pendentes de envio', dica: 'Mensagem gerada, sem disparo', patch: { msgGerada: 'com', disparo: 'nao_disparado' } },
  { nome: 'Follow-up', dica: 'Já conversaram, não fecharam', patch: {}, aba: 'conversou' },
]

function SelFiltro({ label, value, onChange, opcoes }: { label: string; value: string; onChange: (v: string) => void; opcoes: [string, string][] }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
        {opcoes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function PersonalizarModal({ view, onPatch, onReset, onPreset, onClose }: {
  view: ViewConfig
  onPatch: (p: Partial<ViewConfig>) => void
  onReset: () => void
  onPreset: (patch: Partial<ViewConfig>, aba?: string) => void
  onClose: () => void
}) {
  const num = (v: string, on: (s: string) => void, ph: string) => (
    <input type="number" value={v} onChange={(e) => on(e.target.value)} placeholder={ph}
      className="w-full border rounded-lg px-2 py-1.5 text-sm" />
  )
  // Modal FLUTUANTE e ARRASTÁVEL (sem backdrop escuro) — dá pra ver a listagem mudando
  // atrás enquanto ajusta os filtros. Arrasta pelo cabeçalho.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ ox: number; oy: number } | null>(null)
  function startDrag(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return // não arrasta ao clicar no ×
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ x: rect.left, y: rect.top })
    setDrag({ ox: e.clientX - rect.left, oy: e.clientY - rect.top })
    e.preventDefault()
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => setPos({
      x: Math.max(0, Math.min(e.clientX - drag.ox, window.innerWidth - 260)),
      y: Math.max(0, Math.min(e.clientY - drag.oy, window.innerHeight - 48)),
    })
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [drag])

  return (
    <div ref={panelRef}
      style={pos ? { position: 'fixed', left: pos.x, top: pos.y } : undefined}
      className={`z-50 bg-white rounded-2xl shadow-2xl border flex flex-col max-h-[85vh] w-[640px] max-w-[95vw] ${pos ? '' : 'fixed left-1/2 top-12 -translate-x-1/2'}`}>
        <div onMouseDown={startDrag}
          className="flex items-center justify-between px-5 py-3 border-b cursor-move select-none bg-slate-50 rounded-t-2xl">
          <h3 className="font-semibold text-lg">⠿ Personalizar visualização</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" aria-label="Fechar">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Presets rápidos</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.nome} onClick={() => onPreset(p.patch, p.aba)} title={p.dica}
                  className="px-2.5 py-1.5 rounded-lg border text-xs hover:bg-blue-50 hover:border-brand hover:text-brand">
                  {p.nome}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Ordenação e priorização</p>
            <select value={view.ordenacao} onChange={(e) => onPatch({ ordenacao: e.target.value })}
              className="w-full md:w-2/3 border rounded-lg px-2 py-1.5 text-sm">
              {ORDENACOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
            </select>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Filtros</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SelFiltro label="Site" value={view.site} onChange={(v) => onPatch({ site: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com site'], ['sem', 'Sem site']]} />
              <SelFiltro label="E-mail" value={view.email} onChange={(v) => onPatch({ email: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com e-mail'], ['sem', 'Sem e-mail']]} />
              <SelFiltro label="Telefone" value={view.telefone} onChange={(v) => onPatch({ telefone: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com telefone'], ['sem', 'Sem telefone']]} />
              <SelFiltro label="Envio (WhatsApp)" value={view.envio} onChange={(v) => onPatch({ envio: v as ViewConfig['envio'] })} opcoes={[['todos', 'Todos'], ['possivel', 'Envio possível'], ['impossivel', 'Sem WhatsApp']]} />
              <SelFiltro label="Mensagem gerada" value={view.msgGerada} onChange={(v) => onPatch({ msgGerada: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com mensagem'], ['sem', 'Sem mensagem']]} />
              <SelFiltro label="Disparo" value={view.disparo} onChange={(v) => onPatch({ disparo: v as ViewConfig['disparo'] })} opcoes={[['todos', 'Todos'], ['disparado', 'Disparado'], ['nao_disparado', 'Não disparado'], ['falha', 'Falha no envio']]} />
              <SelFiltro label="Agendamento" value={view.agendamento} onChange={(v) => onPatch({ agendamento: v as ViewConfig['agendamento'] })} opcoes={[['todos', 'Todos'], ['com', 'Com agendamento'], ['sem', 'Sem agendamento'], ['hoje', 'Hoje'], ['7dias', 'Próx. 7 dias']]} />
              <div className="col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1">Região (endereço/cidade contém)</label>
                <input value={view.regiao} onChange={(e) => onPatch({ regiao: e.target.value })} placeholder="ex: São Bernardo, Centro" className="w-full border rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div><label className="block text-[11px] text-slate-500 mb-1">Pontos ≥</label>{num(view.scoreMin, (s) => onPatch({ scoreMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-slate-500 mb-1">Pontos ≤</label>{num(view.scoreMax, (s) => onPatch({ scoreMax: s }), '100')}</div>
              <div />
              <div><label className="block text-[11px] text-slate-500 mb-1">Nota ≥</label>{num(view.notaMin, (s) => onPatch({ notaMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-slate-500 mb-1">Nota ≤</label>{num(view.notaMax, (s) => onPatch({ notaMax: s }), '5')}</div>
              <div />
              <div><label className="block text-[11px] text-slate-500 mb-1">Avaliações ≥</label>{num(view.avalMin, (s) => onPatch({ avalMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-slate-500 mb-1">Avaliações ≤</label>{num(view.avalMax, (s) => onPatch({ avalMax: s }), '∞')}</div>
              <div />
              <div><label className="block text-[11px] text-slate-500 mb-1">Entrou de</label><input type="date" value={view.dataDe} onChange={(e) => onPatch({ dataDe: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-[11px] text-slate-500 mb-1">Entrou até</label><input type="date" value={view.dataAte} onChange={(e) => onPatch({ dataAte: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Colunas visíveis</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {COLUNAS_TOGGLE.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={view.cols[c.key] !== false}
                    onChange={(e) => onPatch({ cols: { ...view.cols, [c.key]: e.target.checked } })} />
                  {c.label}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Nome e JSON ficam sempre visíveis. Ações ficam dentro da conversa.</p>
          </section>
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3">
          <button onClick={onReset} className="text-sm text-slate-500 hover:text-slate-800">↺ Restaurar padrão</button>
          <span className="hidden md:inline text-xs text-slate-400">Aplica em tempo real · salvo neste navegador · arraste pelo topo</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark">Concluir</button>
        </div>
    </div>
  )
}

// ─── Modal Adicionar cadastro — cria um lead manualmente no banco ──────────────
const ORIGENS_CADASTRO: { valor: string; label: string }[] = [
  { valor: 'manual', label: 'Manual' },
  { valor: 'google', label: 'Google' },
  { valor: 'instagram', label: 'Instagram' },
]
function CadastroModal({ base, onClose, onSaved }: {
  base: string
  onClose: () => void
  onSaved: () => void
}) {
  const [origem, setOrigem] = useState('manual')
  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [instagram, setInstagram] = useState('')
  const [salvando, setSalvando] = useState(false)
  const fb = useFeedback()

  async function salvar() {
    if (!nome.trim()) { fb.toast('Informe o nome do lead.', 'error'); return }
    const tel = whatsapp.replace(/\D/g, '')
    if (!tel && !instagram.trim()) { fb.toast('Informe WhatsApp ou Instagram.', 'error'); return }
    if (tel && tel.length < 10) { fb.toast('WhatsApp inválido — informe DDD + número.', 'error'); return }
    setSalvando(true)
    try {
      await fb.runTask(() => apiFetch(`${base}/leads`, {
        method: 'POST',
        body: JSON.stringify({ origem, nome: nome.trim(), whatsapp: tel, instagram: instagram.trim() }),
      }), { sucesso: 'Cadastro adicionado ao banco.' })
      onSaved()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Adicionar cadastro</h3>
            <p className="text-xs text-slate-500 mt-0.5">Cria um lead manualmente no banco. Informe ao menos WhatsApp ou Instagram.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Origem</label>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm">
            {ORIGENS_CADASTRO.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do lead ou empresa" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="ex: 5521999998888" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Instagram</label>
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)}
            placeholder="@usuario" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50">
            {salvando && <Spinner size={13} />}
            {salvando ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Testar envio & ajustes — verifica o canal + ajusta saudação/IA ──────
function TestarEnvioModal({ empresaId, base, instancia, config, motivoTesteIndisponivel, onClose, onSavedTemplate, onSavedConfig }: {
  empresaId: string
  base: string
  instancia: Instancia
  config: Config
  motivoTesteIndisponivel?: string | null
  onClose: () => void
  onSavedTemplate: (texto: string) => void
  onSavedConfig: (c: Config) => void
}) {
  const [numeroTeste, setNumeroTeste] = useState('')
  const [testando, setTestando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [texto, setTexto] = useState(instancia.config_json?.saudacao || '')
  const [gerarIa, setGerarIa] = useState(config.gerar_ia)
  const [instrucoes, setInstrucoes] = useState(config.instrucoes_ia || '')
  const fb = useFeedback()
  const baseInst = `/api/empresas/${empresaId}/whatsapp/${instancia.id}`

  async function testar() {
    if (motivoTesteIndisponivel) { fb.toast(motivoTesteIndisponivel, 'error'); return }
    if (numeroTeste.replace(/\D/g, '').length < 10) { fb.toast('Informe um número de teste com DDD.', 'error'); return }
    setTestando(true)
    try {
      await fb.runTask(() => apiFetch(`${baseInst}/saudacao/testar`, {
        method: 'POST', body: JSON.stringify({ numero_teste: numeroTeste, saudacao: texto }),
      }), { sucesso: 'Mensagem de teste enviada pro seu WhatsApp.' })
    } catch { /* erro já exibido pelo feedback */ }
    finally { setTestando(false) }
  }

  async function salvarAjustes() {
    setSalvando(true)
    try {
      await apiFetch(baseInst, { method: 'PATCH', body: JSON.stringify({ saudacao: texto }) })
      const r = await apiFetch<Config>(`${base}/config`, {
        method: 'PUT', body: JSON.stringify({ gerar_ia: gerarIa, instrucoes_ia: instrucoes }),
      })
      onSavedTemplate(texto)
      onSavedConfig(r.data)
      fb.toast('Ajustes salvos.')
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Falha ao salvar ajustes.', 'error')
    } finally { setSalvando(false) }
  }

  const preview = texto
    .replace(/\{nome\}/gi, 'Padaria Exemplo').replace(/\{empresa\}/gi, 'Padaria Exemplo')
    .replace(/\{cidade\}/gi, 'São Paulo').replace(/\{nicho\}/gi, 'padaria').trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Testar envio — {instancia.nome || instancia.evolution_instance}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Mande uma mensagem de teste pro seu número pra confirmar que a instância envia normalmente.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        {/* Teste de envio — ação principal */}
        <div className="flex items-end gap-2 rounded-lg bg-slate-50 border p-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Seu número (teste)</label>
            <input value={numeroTeste} onChange={(e) => setNumeroTeste(e.target.value)}
              placeholder="ex: 5511999998888" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={testar} disabled={testando || !!motivoTesteIndisponivel}
            title={motivoTesteIndisponivel || undefined}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50">
            {testando && <Spinner size={13} />}
            {testando ? 'Enviando…' : <span className="inline-flex items-center gap-1.5"><IconFlask /> Enviar teste</span>}
          </button>
        </div>
        {motivoTesteIndisponivel && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Teste indisponível: {motivoTesteIndisponivel}
          </p>
        )}

        {/* Ajustes de geração (IA) — usados nos modos Semi e Automático */}
        <div className="border-t pt-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ajustes de geração</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gerarIa} onChange={(e) => setGerarIa(e.target.checked)} />
            Gerar a mensagem por IA com análise do lead
          </label>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Instruções extras para a IA (tom, oferta, CTA)</label>
            <textarea value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} rows={3}
              placeholder="Ex.: tom informal, oferta de site profissional, sempre convidar para uma conversa rápida."
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Saudação de fallback (usada se a IA falhar ou estiver desligada)</label>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
              placeholder="Oi {nome}, tudo bem? Vi a {empresa} aqui em {cidade}…"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">
              Variáveis: <code>{'{nome}'}</code> <code>{'{empresa}'}</code> <code>{'{cidade}'}</code> <code>{'{nicho}'}</code>
            </p>
          </div>
          {preview && (
            <div className="rounded-lg bg-slate-50 border px-3 py-2 text-xs text-slate-600">
              <span className="text-slate-400">Preview do fallback: </span>{preview}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm">Fechar</button>
          <button onClick={salvarAjustes} disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-brand text-brand text-sm font-semibold hover:bg-blue-50 disabled:opacity-50">
            {salvando && <Spinner size={13} />}
            {salvando ? 'Salvando…' : 'Salvar ajustes'}
          </button>
        </div>
      </div>
    </div>
  )
}
