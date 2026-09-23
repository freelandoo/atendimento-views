'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { apiFetch, apiDownload, getEmpresaId } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { EmailEditavel } from '@/components/EmailEditavel'
import { ContatoEditavel } from '@/components/ContatoEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'
import { BolinhaIcp, criteriosDoLead, maximoDoLead } from '@/components/LeadDetalhesModal'
// UMA ficha por lead, com quatro seções. Ela não reimplementa nada: `LeadDetalhesModal` e
// `ConversaHistoricoModal` continuam donos do que fazem e viram o conteúdo de duas seções.
import FichaLead from '@/components/FichaLead'
import { secaoDoGatilho, type SecaoFicha } from '@/lib/ficha-lead'
// O QUADRO DO DIA vive DENTRO do Banco de Leads, como segunda vista da mesma carteira — sem
// item novo no menu lateral. Ele nao faz uma segunda listagem: recebe os leads que a Lista ja
// carregou e guarda o planejamento no servidor (migration 095).
import QuadroDoDia from '@/components/QuadroDoDia'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import { classesEntrada } from '@/lib/ui-primitivos'
import DataTableFrame from '@/components/ui/DataTableFrame'
import TextoTruncado from '@/components/ui/TextoTruncado'
import NichoCidade from '@/components/ui/NichoCidade'
import { rotuloLink } from '@/lib/site-rotulos'
// A ORIGEM do lead chega pronta do backend (`prospects.origem`, vocabulario travado em
// services/lead-origem.js). Este modulo so TRADUZ — a tela nao deduz procedencia.
import { celulaOrigem, OPCOES_FILTRO_ORIGEM, rotuloFiltroOrigem } from '@/lib/lead-origem'
import { acessosDoLead, type AcessoRapido } from '@/lib/lead-acessos'
import { ordemIcp, prioridadeComercialLead, qualificacaoDoLead, resumoIcpDoLead, resumoIcpOperacional, seloIcp, seloValidacaoLead } from '@/lib/lead-icp'
import { leituraCadastro } from '@/lib/pontuacao-indicador'
import { paginar, resumoIntervalo, mostrarPaginacao, POR_PAGINA_PADRAO, type PaginaLista } from '@/lib/paginacao'
import { aplicarRecorte, gravarFiltros, lerFiltros } from '@/lib/filtros-sessao'
// A ORDEM DE TRABALHO chega pronta do backend (services/lead-fila-trabalho.js): a lista ja vem
// ordenada e cada lead traz `faixa_trabalho`. Este modulo so TRADUZ o nome da faixa.
import { seloFaixa, avisoDeJanela } from '@/lib/lead-fila-trabalho'
// A ACAO PRINCIPAL do lead (qual botao, com que rotulo). O modulo RECEBE os vereditos que a
// tela ja tem (`isRodavel`, `isLocked`) — ele nao recalcula elegibilidade.
import { ACOES, acaoPrincipalDoLead } from '@/lib/banco-leads-acao'
import {
  opcoesEscopo,
  donoDoLead, acoesDeResponsavel,
  avisoDeEquipe, vazioDaCarteira,
} from '@/lib/lead-operacao'
import type { Qualificacao, EquipeRecorte } from '@/lib/lead-operacao'
import { temCapacidade } from '@/lib/capacidades'
// Apresentacao do painel (cartoes do funil, menu de acoes secundarias, pedido de exportacao e
// o texto do que a limpeza REALMENTE faz). PURO e testado — a tela so desenha.
import {
  cartoesDeFunil, leadPermaneceNaAbaBanco, itensMaisAcoes, validarExportacao, escopoDaSelecao, faixaDeEnvio,
  COLUNAS_CSV, COLUNAS_CSV_PADRAO, LIMPEZA,
} from '@/lib/banco-leads-painel'
import { IconPlus, IconBroom, IconDownload, IconFlask, IconGear, IconLock, IconTrash, IconCalendar, IconSend, IconAlert, IconChevron, IconCheck } from '@/components/ui/icons'
import type { PayloadProximaAcao } from '@/lib/follow-up-acao'

// Banco de Leads — central de disparo com Modo Manual / Semiautomático / Automático.
// UMA lista, com a ORIGEM como coluna e como filtro. Eram duas tabelas (Places x "o resto"),
// e o "resto" tinha titulo fixo "Instagram": lead de anuncio da Meta aparecia sob a fonte
// errada, e a fila de trabalho que o servidor ordena chegava partida em duas paginacoes
// independentes — a prioridade global se perdia entre elas.
// Consome /api/empresas/:id/banco-leads.
type JsonApresLead = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}
type Lead = {
  id: string; origem: string; status: string; nome: string
  /** Faixa da fila de trabalho, decidida pelo BACKEND. A tela nao reclassifica. */
  faixa_trabalho?: string | null
  telefone: string | null; email: string | null; instagram_handle: string | null
  nicho: string | null; cidade: string | null; site: string | null
  seguidores: number | null; categoria_perfil: string | null
  endereco: string | null; rating: number | null; avaliacoes: number | null
  // `tem_site`/`site` chegam CANONICOS do backend (services/site-classificacao.js):
  // `site` so' vem preenchido quando e' site PROPRIO. O link cru (Instagram, Linktree,
  // ficha do Maps) vem em `link_original` — exibi-lo e' certo, chama-lo de site nao.
  tem_site: boolean | null; maps_url: string | null; link_bio: string | null; bio: string | null
  link_original: string | null
  classificacao_url: string | null
  situacao_site: 'tem_site' | 'sem_site' | 'nao_identificado' | null
  situacao_site_label: string | null
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
  ultimo_status_acao?: string | null
  ultimo_status_estado?: string | null
  ultimo_status_em?: string | null
  // CRM em equipe. Etapa 3: a PORTA da operação comercial. Etapa 4: de quem é o lead.
  // Os dois chegam prontos do backend — a tela só traduz (lib/lead-operacao.js).
  qualificacao: Qualificacao | null
  qualificado_em: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  responsavel_desde: string | null
  icp_modelo_id?: string | null
  icp_score?: number | null
  icp_faixa?: 'A' | 'B' | 'C' | 'fora' | null
  icp_avaliado_em?: string | null
  icp_avaliado_por?: string | null
  icp_resumo_json?: {
    score?: number
    score_maximo?: number
    faixa?: string
    criterios?: { id: string; rotulo: string; pontos: number; marcado?: boolean; pontos_obtidos?: number }[]
    sinais_auto?: Record<string, { sugerido?: boolean; motivo?: string }>
    motivos?: string[]
  } | null
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
type StatusPayload = {
  reuniao?: { data: string; horario: string; duracao_minutos: number; observacoes?: string }
  ligacao?: { resultado: string; duracao_minutos: number; observacoes?: string; follow_up?: PayloadProximaAcao | null }
  descarte?: { motivo: string; observacoes?: string }
}
type AlterarStatusLeadResp = {
  id: string
  status: string
  qualificacao?: Qualificacao | null
  responsavel_id?: string | null
  responsavel_desde?: string | null
  assumido_automaticamente?: boolean
  agenda_evento?: { id: string; data_inicio?: string; data_fim?: string } | null
  ligacao?: { id: string; resultado?: string; duracao_seg?: number } | null
  follow_up?: { id: string; canal?: string; proxima_acao?: string } | null
}
type RodarResumo = {
  rodada: boolean
  aceitos: { id: string; nome: string }[]
  pulados: { id: string; motivo: string }[]
  teto_restante: number | null
  total_dia?: number
  envios?: { prospect_id: string; disparo_id: string; status: string; erro: string | null }[] | null
}
type FalhaSistemicaGeracao = {
  motivo: string
  mensagem: string
  nao_processados: number
  falhas_consecutivas?: number | null
}
type GerarResumo = {
  gerados: { prospect_id: string; nome: string; mensagem?: string; gerada_por_ia?: boolean; erro_ia?: boolean }[]
  pulados: { id: string; motivo: string }[]
  falha_sistemica?: FalhaSistemicaGeracao | null
}
type PrevisaoEnvio = {
  titulo: string
  detalhe?: string
  tom: 'auto' | 'pronto' | 'enviado' | 'erro' | 'neutro'
  ts?: number   // hora estimada de envio (ms) — usada para ORDENAR a coluna Envio
}
// Progresso da preparação das mensagens (barra). A geração roda no worker de fundo.
type GeracaoProgresso = { eligiveis: number; prontas: number; gerando: number; enviados: number; erros: number }
// Progresso da geração em massa disparada no modo Manual (seleção de leads, sem worker
// dedicado): contadores REAIS, acumulados a cada lote de MAX_LOTE devolvido pelo backend.
type ProgressoLoteManual = { total: number; processados: number; prontas: number; erros: number; pulados: number }

const MAX_LOTE = 15
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])

// Modos de disparo do Banco de Leads.
// `resumo` é a linha que cabe dentro do cartão de escolha; `hint` continua sendo a explicação
// completa do modo ATIVO, logo abaixo. São textos diferentes de propósito: o primeiro ajuda a
// escolher, o segundo diz o que passa a valer depois de escolhido.
const MODOS: { valor: string; label: string; resumo: string; hint: string; disabled?: boolean }[] = [
  { valor: 'manual', label: 'Manual', resumo: 'Você envia quando quiser', hint: 'Você seleciona os leads e envia. Clicar em Enviar já é a aprovação.' },
  { valor: 'semi_automatico', label: 'Semiautomático', resumo: 'O sistema prepara, você revisa', hint: 'A IA gera a mensagem e deixa pronta; você dispara quando quiser (sem aprovação).' },
  { valor: 'automatico', label: 'Automático', resumo: 'Envia 1 lead por vez', hint: 'O sistema dispara sozinho na janela e intervalo abaixo. O botão manual continua disponível.' },
]

const ABAS: { valor: string; label: string }[] = [
  { valor: 'sem_contato', label: 'Sem contato ainda' },
  { valor: 'conversou', label: 'Já conversou' },
  { valor: 'fecharam', label: 'Fecharam' },
  { valor: 'agendados', label: 'Agendados' },
  { valor: 'descartados', label: 'Descartados' },
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
// Rótulos amigáveis em PT (o operador nunca vê os códigos internos crus). A coluna usa a ação
// operacional mais recente quando ela existe, porque "ligação feita" e "contatado" compartilham
// o mesmo `prospects.status` técnico.
const STATUS_LEAD_VISUAL: Record<string, { rotulo: string; detalhe: string; classe: string; ordem: number }> = {
  sem_contato: {
    rotulo: 'Sem contato',
    detalhe: 'Ainda sem abordagem registrada.',
    classe: 'border-line bg-surface-2 text-ink-2',
    ordem: 10,
  },
  marcado: {
    rotulo: 'Marcado',
    detalhe: 'Lead liberado para o Comercial trabalhar.',
    classe: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    ordem: 20,
  },
  contatado: {
    rotulo: 'Contatado',
    detalhe: 'Primeiro contato registrado.',
    classe: 'border-blue-200 bg-blue-50 text-blue-700',
    ordem: 30,
  },
  ligacao_feita: {
    rotulo: 'Ligação feita',
    detalhe: 'Ligação comercial registrada no lead.',
    classe: 'border-sky-200 bg-sky-50 text-sky-700',
    ordem: 40,
  },
  respondido: {
    rotulo: 'Respondido',
    detalhe: 'Lead respondeu ou avançou na conversa.',
    classe: 'border-orange-200 bg-orange-50 text-orange-700',
    ordem: 50,
  },
  reuniao: {
    rotulo: 'Reunião marcada',
    detalhe: 'Há reunião vinculada a este lead.',
    classe: 'border-violet-200 bg-violet-50 text-violet-700',
    ordem: 60,
  },
  fechado: {
    rotulo: 'Fechado',
    detalhe: 'Negócio marcado como fechado por gestão/triagem.',
    classe: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    ordem: 70,
  },
  descartado: {
    rotulo: 'Descartado',
    detalhe: 'Lead descartado ou marcado para não contatar.',
    classe: 'border-red-200 bg-red-50 text-red-700',
    ordem: 80,
  },
}
const FILTROS_STATUS_LEAD: { valor: string; label: string }[] = [
  { valor: 'todos', label: 'Todos' },
  { valor: 'sem_contato', label: 'Sem contato' },
  { valor: 'marcado', label: 'Marcado' },
  { valor: 'contatado', label: 'Contatado' },
  { valor: 'ligacao_feita', label: 'Ligação feita' },
  { valor: 'respondido', label: 'Respondido' },
  { valor: 'reuniao', label: 'Reunião marcada' },
  { valor: 'descartado', label: 'Descartado' },
]
function statusOperacionalDoLead(l: Lead): { chave: string; rotulo: string; detalhe: string; classe: string; ordem: number } {
  let chave = 'sem_contato'
  if (l.status === 'fechado') chave = 'fechado'
  else if (l.status === 'rejeitado' || l.status === 'nao_contatar' || l.ultimo_status_acao === 'lead_descartado') chave = 'descartado'
  else if (l.proximo_agendamento || l.ultimo_status_acao === 'lead_reuniao_agendada') chave = 'reuniao'
  else if (l.ultimo_status_acao === 'lead_ligacao_realizada') chave = 'ligacao_feita'
  else if (l.status === 'respondeu') chave = 'respondido'
  else if (l.status === 'enviado' || l.ultimo_status_acao === 'abordagem_manual_declarada') chave = 'contatado'
  else if (l.status === 'aprovado') chave = 'marcado'
  const info = STATUS_LEAD_VISUAL[chave] || STATUS_LEAD_VISUAL.sem_contato
  return { chave, ...info }
}
function acaoOperacionalAuditavel(statusOperacional: string): string {
  switch (statusOperacional) {
    case 'ligacao_realizada': return 'lead_ligacao_realizada'
    case 'reuniao_agendada': return 'lead_reuniao_agendada'
    case 'descartado': return 'lead_descartado'
    default: return 'lead_status_alterado'
  }
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
    case 'links': return (l.link_bio || l.site || l.link_original) ? 1 : 0
    case 'envio': return l.gerada_em || l.rodado_em || ''
    case 'icp': return ordemIcp(l)
    case 'prioridade': return prioridadeComercialLead(l)
    case 'pontos': return l.score_cadastro ?? 0
    case 'status': return statusOperacionalDoLead(l).ordem
    default: return 0
  }
}

function ordenarLeads(lista: Lead[], ordem: Ordem, previsoes?: Map<string, PrevisaoEnvio>): Lead[] {
  // 'trabalho' = a ordem que o servidor já mandou. A tela NÃO reclassifica a fila: fazer isso
  // aqui a faria divergir da ordem (e da janela) que o backend usou para escolher os leads.
  if (ordem.chave === 'trabalho') return lista
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
  versao?: number
  cols: Record<string, boolean>
  site: Filtro3; social: Filtro3; email: Filtro3; telefone: Filtro3
  envio: 'todos' | 'possivel' | 'impossivel'
  statusLead: string
  msgGerada: Filtro3
  icp: 'todos' | 'A' | 'B' | 'C' | 'sem_icp'
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
  { key: 'username', label: '@username' },
  { key: 'seguidores', label: 'Seguidores' },
  { key: 'aval', label: 'Avaliações' },
  { key: 'nota', label: 'Nota' },
  { key: 'horario', label: 'Horário' },
  { key: 'links', label: 'Links' },
  { key: 'qualidade', label: 'Resumo ICP' },
  { key: 'status', label: 'Status' },
  // CRM em equipe: continua disponível em "Personalizar", mas desligado por padrão para a
  // listagem ficar focada na próxima ação. A regra de carteira segue no backend.
  { key: 'responsavel', label: 'Responsável' },
]

const ORDENACOES: { valor: string; label: string }[] = [
  { valor: 'padrao', label: 'Ordem de trabalho (padrão)' },
  { valor: 'prioridade_desc', label: 'Melhores leads primeiro' },
  { valor: 'prioridade_asc', label: 'Piores leads primeiro' },
  { valor: 'icp_desc', label: 'Maior qualidade ICP primeiro' },
  { valor: 'pontos_desc', label: 'Cadastro mais completo primeiro' },
  { valor: 'pontos_asc', label: 'Cadastro menos completo primeiro' },
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

// Visualização PADRÃO enxuta: nome, contato, operação (envio/status), mercado, site e a
// completude do cadastro. Avaliações, nota, horário, endereço e links entram desligados —
// continuam a um clique em "⚙ Personalizar", e os valores estão em "Detalhes" e no tooltip da
// bolinha. Trocar o padrão (em vez de remover a coluna do código) mantém a mudança reversível
// pelo próprio operador.
// `username` e `seguidores` entram DESLIGADOS: numa lista unica eles so' tem valor para uma das
// fontes, e ligados por padrao virariam uma coluna majoritariamente "—". O @ do Instagram nao se
// perde — ele aparece como detalhe DENTRO da coluna Origem, que e' onde identifica a fonte.
const COLUNAS_PADRAO_DESLIGADAS = new Set(['qualidade', 'aval', 'nota', 'horario', 'endereco', 'links', 'responsavel', 'username', 'seguidores'])

const VIEW_PADRAO: ViewConfig = {
  cols: Object.fromEntries(COLUNAS_TOGGLE.map((c) => [c.key, !COLUNAS_PADRAO_DESLIGADAS.has(c.key)])),
  site: 'todos', social: 'todos', email: 'todos', telefone: 'todos', envio: 'todos',
  statusLead: 'todos', msgGerada: 'todos', icp: 'todos', disparo: 'todos', agendamento: 'todos',
  regiao: '', scoreMin: '', scoreMax: '', notaMin: '', notaMax: '',
  avalMin: '', avalMax: '', dataDe: '', dataAte: '', ordenacao: 'padrao',
}

// Recorte de TRABALHO: onde a pessoa estava agora. Vive em `sessionStorage` por 30 min
// (lib/filtros-sessao), morre com a aba e não vai a banco. É deliberadamente SEPARADO de
// `bancoLeadsView`, logo abaixo: colunas e filtros do "⚙ Personalizar" são PREFERÊNCIA do
// operador e continuam permanentes no localStorage, por decisão já documentada. Misturar os
// dois faria a preferência evaporar em 30 min ou o recorte de hoje reaparecer amanhã.
const TELA_RECORTE = 'banco-leads'
const RECORTE_PADRAO = { aba: 'sem_contato', origem: '', mercado: '', cidadeFiltro: '', busca: '', escopo: '' }

// Versão da view salva no localStorage. A v1 gravava TODAS as colunas ligadas (era o padrão
// da época), então um merge simples com o novo padrão faria todo operador existente continuar
// vendo a tabela larga — a redução não chegaria a ninguém. A v6 é a lista UNIFICADA: `seguidores`
// sai do padrão porque, com as fontes na mesma tabela, ela ficaria vazia na maioria das linhas. A migração aplica o novo conjunto
// de colunas UMA vez e **preserva todos os filtros e a ordenação**, que são trabalho do
// operador; coluna é layout e volta em um clique.
const VIEW_VERSAO = 6
const CHAVE_VIEW = 'bancoLeadsView'

function migrarView(salvo: Partial<ViewConfig> & { versao?: number }): ViewConfig {
  const base = { ...VIEW_PADRAO, ...salvo }
  const cols = salvo.versao === VIEW_VERSAO
    ? { ...VIEW_PADRAO.cols, ...(salvo.cols || {}) }
    : VIEW_PADRAO.cols
  return { ...base, cols }
}

function numOuNull(s: string): number | null {
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) ? n : null
}
function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function temRedeSocialLead(l: Lead): boolean {
  const origem = String(l.origem || '').toLowerCase()
  return l.classificacao_url === 'rede_social'
    || !!String(l.instagram_handle || '').trim()
    || origem === 'instagram'
    || origem === 'linkedin'
}

// Filtro client-side de um lead segundo a configuração de visualização.
function passaFiltrosView(l: Lead, v: ViewConfig): boolean {
  // Veredito canônico do backend: um lead cujo único link é Instagram/Linktree responde
  // `tem_site=false` e passa a aparecer em "Sem site", não em "Com site".
  const temSite = !!l.tem_site
  if (v.site === 'com' && !temSite) return false
  if (v.site === 'sem' && temSite) return false
  const temSocial = temRedeSocialLead(l)
  if (v.social === 'com' && !temSocial) return false
  if (v.social === 'sem' && temSocial) return false
  const temEmail = !!String(l.email || '').trim()
  if (v.email === 'com' && !temEmail) return false
  if (v.email === 'sem' && temEmail) return false
  const temTel = !!String(l.telefone || '').trim()
  if (v.telefone === 'com' && !temTel) return false
  if (v.telefone === 'sem' && temTel) return false
  if (v.envio === 'possivel' && l.tem_whatsapp !== true) return false
  if (v.envio === 'impossivel' && l.tem_whatsapp !== false) return false
  if (v.statusLead !== 'todos' && statusOperacionalDoLead(l).chave !== v.statusLead) return false
  if (v.msgGerada === 'com' && !l.mensagem_gerada) return false
  if (v.msgGerada === 'sem' && l.mensagem_gerada) return false
  const faixaIcp = resumoIcpDoLead(l).faixa
  if (v.icp !== 'todos' && v.icp !== faixaIcp) return false
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
      case 'prioridade': return prioridadeComercialLead(l)
      case 'icp': return ordemIcp(l)
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
  if (v.site !== 'todos') c.push(v.site === 'com' ? 'Com site próprio' : 'Sem site próprio')
  if (v.social !== 'todos') c.push(v.social === 'com' ? 'Com rede social' : 'Sem rede social')
  if (v.email !== 'todos') c.push(v.email === 'com' ? 'Com e-mail' : 'Sem e-mail')
  if (v.telefone !== 'todos') c.push(v.telefone === 'com' ? 'Com telefone' : 'Sem telefone')
  if (v.envio === 'possivel') c.push('Envio possível')
  if (v.envio === 'impossivel') c.push('Sem WhatsApp')
  if (v.statusLead !== 'todos') c.push(`Status: ${STATUS_LEAD_VISUAL[v.statusLead]?.rotulo || v.statusLead}`)
  if (v.msgGerada !== 'todos') c.push(v.msgGerada === 'com' ? 'Com mensagem' : 'Sem mensagem')
  if (v.icp !== 'todos') c.push(v.icp === 'sem_icp' ? 'Sem ICP' : `Lead ${v.icp}`)
  if (v.disparo !== 'todos') c.push({ disparado: 'Disparado', nao_disparado: 'Não disparado', falha: 'Falha no envio' }[v.disparo] || '')
  if (v.agendamento !== 'todos') c.push({ com: 'Agendados', sem: 'Sem agendamento', hoje: 'Agendados hoje', '7dias': 'Agenda 7 dias' }[v.agendamento] || '')
  if (v.regiao.trim()) c.push(`Região: ${v.regiao.trim()}`)
  if (v.scoreMin || v.scoreMax) c.push(`Cadastro ${v.scoreMin || '0'}–${v.scoreMax || '∞'}`)
  if (v.notaMin || v.notaMax) c.push(`Nota ${v.notaMin || '0'}–${v.notaMax || '∞'}`)
  if (v.avalMin || v.avalMax) c.push(`Aval. ${v.avalMin || '0'}–${v.avalMax || '∞'}`)
  if (v.dataDe) c.push(`Desde ${v.dataDe}`)
  if (v.dataAte) c.push(`Até ${v.dataAte}`)
  return c.filter(Boolean)
}

export default function BancoLeadsPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  // CRM em equipe: as capacidades chegam RESOLVIDAS pelo backend (/api/auth/me). A tela não
  // recalcula nada — quem decide é services/acesso-capacidades.js.
  const { usuario, capacidades } = useSession()
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
  // Etapa 4: recorte por RESPONSÁVEL. `escopo` é o que a tela pede; quem decide o que este
  // pedido pode ver é o backend.
  const [escopo, setEscopo] = useState<string>('')
  // Falso até o recorte guardado ser lido. Sem isto a tela buscaria com o filtro padrão e logo
  // depois com o restaurado — duas consultas e um piscar de lista errada.
  const [recortePronto, setRecortePronto] = useState(false)
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
  // Geração em massa (Manual): lote processado em batches de MAX_LOTE via /gerar — os
  // contadores vêm das respostas REAIS do backend, nunca de uma % simulada. Roda até o fim
  // mesmo se o operador trocar de tela dentro do sistema (a promessa é só essa: fechar a aba
  // ou recarregar interrompe, já que não existe worker de fundo para uma SELEÇÃO manual).
  const [gerandoLote, setGerandoLote] = useState(false)
  const [progressoLoteManual, setProgressoLoteManual] = useState<ProgressoLoteManual | null>(null)
  const [confirmarLoteGrande, setConfirmarLoteGrande] = useState(false)
  const montadoRef = useRef(true)
  useEffect(() => () => { montadoRef.current = false }, [])
  const [geracaoProgresso, setGeracaoProgresso] = useState<GeracaoProgresso | null>(null)
  const [geracaoProgressoErro, setGeracaoProgressoErro] = useState(false)
  const assinaturaGeracaoRef = useRef<string | null>(null)
  const ultimaRecargaGeracaoRef = useRef(0)
  // Cooldown do próximo envio (modo Semi): segundos restantes + estado visual do cronômetro.
  const [cooldownS, setCooldownS] = useState<number | null>(null)
  const [flashCron, setFlashCron] = useState(false)
  const cronRef = useRef<HTMLDivElement | null>(null)
  const [metaLista, setMetaLista] = useState<{ total?: number; total_carteira?: number; limite?: number; equipe?: EquipeRecorte | null } | null>(null)
  const [saudacaoOpen, setSaudacaoOpen] = useState(false)
  const [cadastroOpen, setCadastroOpen] = useState(false)
  // Ações SECUNDÁRIAS do cabeçalho. Exportar e limpar viraram itens de "Mais ações": as duas
  // disputavam espaço com "Adicionar cadastro", que é a ação primária da tela.
  const [exportOpen, setExportOpen] = useState(false)
  const [confirmarLimpeza, setConfirmarLimpeza] = useState(false)
  const [ajudaOpen, setAjudaOpen] = useState(false)
  // UMA ordenação, porque agora é UMA lista. O padrão é 'trabalho' = NÃO reordenar: a lista já
  // vem do servidor na ordem da fila (respondeu → pronto para enviar → não trabalhado → …).
  //
  // Duas ordenações independentes eram a consequência de duas tabelas: a fila que o servidor
  // calcula é GLOBAL, e parti-la em duas fazia o 1º lead de cada metade disputar o topo sem que
  // nada dissesse qual dos dois era o mais urgente.
  //
  // O default anterior era 'pontos ASC' (cadastro MENOS completo primeiro), herdado da Aquisição,
  // onde cadastro fraco é oportunidade. Aqui ele punha na PRIMEIRA linha o lead que não dá para
  // contatar — "sem telefone" vale -10 pontos. Clicar num cabeçalho continua reordenando a
  // página; o botão "Ordem de trabalho" devolve a ordem da fila.
  const [ordem, setOrdem] = useState<Ordem>({ chave: 'trabalho', dir: 'asc' })
  // Detalhes do lead: destino dos campos que saíram das colunas padrão e do JSON, que deixou
  // de ocupar uma coluna da tela de trabalho.
  /**
   * A ficha ABERTA, e em que seção. Eram DOIS estados (`detalheAberto` e `ficha`) para
   * o mesmo lead, abertos por gatilhos diferentes da mesma linha — dois modais, dois resumos e
   * a posição na lista perdida a cada troca.
   *
   * `secao` é do estado da TELA (e não interno da ficha) porque é ela que decide qual seção
   * cada gatilho abre: o nome abre o Resumo, a pontuação abre a Qualificação, a origem abre as
   * Fontes e o telefone continua abrindo a Conversa.
   */
  const [ficha, setFicha] = useState<{
    secao: SecaoFicha
    numero: string; titulo: string; leadId: string; mensagemGerada: string | null
    rodavel: boolean; status: string; acessos: AcessoRapido[]
    /** Fotografia do lead no instante da abertura. Ver `leadDaFicha`. */
    leadAberto: Lead
  } | null>(null)
  /**
   * O lead vivo da ficha sai da lista carregada — assim ele acompanha o que o autosave do ICP e
   * a edição de telefone já devolveram para `leads`, em vez de congelar no clique.
   *
   * ⚠️ Com fallback para a FOTOGRAFIA da abertura, e isso não é preciosismo: marcar o status
   * ("respondeu", "descartado") move o lead para outra aba, ele sai de `leads` no `carregarLeads`
   * seguinte e a ficha sumiria da tela no meio do trabalho — justamente depois da ação que o
   * operador acabou de registrar.
   */
  const leadDaFicha = useMemo(
    () => (ficha ? leads.find((l) => l.id === ficha.leadId) || ficha.leadAberto : null),
    [ficha, leads]
  )
  const [enviandoConversa, setEnviandoConversa] = useState(false)
  const [gerandoConversa, setGerandoConversa] = useState(false)
  // Colunas e filtros da visualizacao (colunas + filtros + ordenação; persistida no localStorage)
  const [persAberto, setPersAberto] = useState(false)
  /** Folha de filtros do CELULAR. No computador os mesmos campos ficam na barra. */
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  /**
   * O painel de CONFIGURACAO do disparo (modos, instancia, janela do automatico) nasce
   * recolhido. Ele ocupava ~260px da primeira dobra para responder a uma pergunta que o
   * operador faz uma vez por dia — "em que modo eu estou?" —, enquanto o trabalho dele, que e'
   * a lista, comecava abaixo da tela. O que NAO foi recolhido: o estado do envio e o motivo de
   * um bloqueio, que continuam na faixa sempre visivel.
   */
  const [painelEnvioAberto, setPainelEnvioAberto] = useState(false)
  /**
   * Lista x Quadro do dia. É a MESMA carteira, vista de dois jeitos: a Lista é o acervo
   * ordenado pela fila de trabalho; o Quadro é o recorte que a pessoa escolheu para HOJE.
   *
   * Trocar de vista é só apresentação: não dispara busca, não move card, não salva nada e não
   * altera filtro (mesma regra dos dois modos da Aquisição). O valor vive em `sessionStorage`
   * + `?vista=`, para um F5 não jogar a pessoa de volta na vista que ela não estava usando.
   */
  const [vista, setVista] = useState<'lista' | 'quadro'>('lista')
  useEffect(() => {
    const daUrl = new URLSearchParams(window.location.search).get('vista')
    const salvo = (() => { try { return sessionStorage.getItem('bancoLeadsVista') } catch { return null } })()
    const alvo = daUrl === 'quadro' || daUrl === 'lista' ? daUrl : (salvo === 'quadro' ? 'quadro' : 'lista')
    setVista(alvo as 'lista' | 'quadro')
  }, [])
  const trocarVista = useCallback((v: 'lista' | 'quadro') => {
    setVista(v)
    try { sessionStorage.setItem('bancoLeadsVista', v) } catch { /* aba anônima */ }
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('vista', v)
      window.history.replaceState(null, '', url.toString())
    } catch { /* sem history */ }
  }, [])
  const [view, setView] = useState<ViewConfig>(VIEW_PADRAO)
  const patchView = useCallback((p: Partial<ViewConfig>) => setView((v) => ({ ...v, ...p })), [])
  const fb = useFeedback()
  // Paginação client-side da lista, sobre o conjunto já carregado e já filtrado — mesmo módulo
  // puro (`lib/paginacao.js`) usado por Follow-ups e Central de Ligações. UMA página, porque a
  // ordem de trabalho é uma só: duas paginações independentes deixavam metade da fila numa
  // página 1 e metade em outra.
  const [pagina, setPagina] = useState(1)
  const capacidadesCarregadas = Array.isArray(capacidades)
  const podeDispararSemi = temCapacidade(capacidades, 'lead_disparar_semi') || temCapacidade(capacidades, 'lead_disparar_lote')
  const podeDispararAutomatico = temCapacidade(capacidades, 'lead_disparar_lote')
  const podeEscolherInstancia = temCapacidade(capacidades, 'instancia_gerenciar_empresa')
  const podeLimparBanco = temCapacidade(capacidades, 'lead_disparar_lote')
  const podeExportarCsv = temCapacidade(capacidades, 'lead_ver_brutos')
  const podeTriarLead = temCapacidade(capacidades, 'lead_triar')
  const modosDisponiveis = useMemo(() => MODOS.filter((m) => {
    if (m.valor === 'automatico') return podeDispararAutomatico
    if (m.valor === 'semi_automatico') return podeDispararSemi
    return true
  }), [podeDispararAutomatico, podeDispararSemi])

  useEffect(() => {
    if (!capacidadesCarregadas || podeDispararAutomatico || config.modo !== 'automatico') return
    setConfig((c) => ({ ...c, modo: podeDispararSemi ? 'semi_automatico' : 'manual', auto_ativo: false }))
  }, [capacidadesCarregadas, podeDispararAutomatico, podeDispararSemi, config.modo])

  // Abre o histórico de conversa do contato (reusa o modal/endpoint de Conversas) e leva
  // a mensagem gerada + elegibilidade para permitir o envio individual dali.
  //
  // Lead SEM telefone abre do mesmo jeito, com `numero` vazio: ele continua tendo links,
  // status e histórico para trabalhar. O modal declara a pendência do telefone em vez de
  // recusar a abertura — recusar não dizia nada sobre o lead, só travava a porta. O envio
  // não corre risco: `isRodavel` já exige telefone, então Gerar/Enviar nascem indisponíveis.
  /**
   * Abre a ficha a partir de um id — o caminho do Quadro do Dia, onde o card pode ser de um lead
   * que NÃO está na janela carregada pela Lista (ele mudou de aba desde que foi planejado, ou o
   * filtro em vigor é outro).
   *
   * Busca primeiro no que já está em memória; só então pede ao servidor. A rota devolve o lead
   * hidratado pela MESMA função da listagem — montar um lead parcial aqui faria a ficha mostrar
   * pontuação de cadastro e ICP diferentes das da mesma ficha aberta pela Lista.
   */
  async function abrirLeadPorId(prospectId: string, gatilho: string) {
    const emMemoria = leads.find((l) => l.id === prospectId)
    if (emMemoria) { abrirFicha(emMemoria, gatilho); return }
    try {
      const r = await apiFetch<Lead>(`${base}/leads/${prospectId}`)
      abrirFicha(r.data, gatilho)
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível abrir este lead.', 'error')
    }
  }

  /**
   * Abre a ficha do lead na seção que o GATILHO promete (`lib/ficha-lead.js` é o dono desse
   * mapa). Substitui `abrirConversa` + `setDetalheAberto`: era o mesmo lead em dois modais.
   */
  function abrirFicha(l: Lead, gatilho: string) {
    const digits = String(l.telefone || '').replace(/\D/g, '')
    setFicha({
      secao: secaoDoGatilho(gatilho),
      numero: digits ? `${digits}@s.whatsapp.net` : '', titulo: l.nome || '', leadId: l.id,
      mensagemGerada: l.mensagem_gerada, rodavel: isRodavel(l), status: l.status,
      // Acessos rápidos (rede social / site / ficha no Maps) — a regra é pura e vive em
      // lib/lead-acessos.js; aqui só se passa o veredito que o backend já mandou no lead.
      acessos: acessosDoLead(l),
      leadAberto: l,
    })
  }

  function aplicarLeadAtualizado(leadAtualizado: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === leadAtualizado.id ? { ...l, ...leadAtualizado } : l)))
    // O lead da ficha sai de `leads` (ver `leadDaFicha`), então ele já acompanha esta
    // atualização. Aqui só o que a ficha guarda por conta própria: o status usado pelas ações.
    setFicha((cur) => (cur && cur.leadId === leadAtualizado.id ? { ...cur, status: leadAtualizado.status } : cur))
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
    if (!empresaId || !recortePronto) return
    setCarregando(true)
    try {
      const p = new URLSearchParams({ aba })
      if (origem) p.set('origem', origem)
      if (mercado) p.set('mercado', mercado)
      if (cidadeFiltro) p.set('cidade', cidadeFiltro)
      if (busca.trim()) p.set('busca', busca.trim())
      // Recorte por RESPONSÁVEL (Etapa 4). Quem decide o que este pedido pode ver é o backend:
      // pedir `todos` sem poder devolve "meus + livres", e o `meta.escopo` diz o que veio.
      if (escopo) p.set('escopo', escopo)
      const r = await apiFetch<Lead[], { escopo?: string; pode_ver_todos?: boolean; total?: number; total_carteira?: number; limite?: number; equipe?: EquipeRecorte | null }>(`${base}/leads?${p.toString()}`)
      setLeads(r.data || [])
      // `total_carteira` é o total REAL do recorte, contado no banco. A listagem devolve uma
      // janela; sem este número o operador acharia que a carteira tem o tamanho do que veio.
      setMetaLista(r.meta || null)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar leads.') }
    finally { setCarregando(false) }
  }, [base, empresaId, recortePronto, aba, origem, mercado, cidadeFiltro, busca, escopo])

  const carregarFiltrosMercado = useCallback(async () => {
    if (!empresaId || !recortePronto) return
    try {
      const p = new URLSearchParams({ aba })
      if (origem) p.set('origem', origem)
      const r = await apiFetch<FiltrosMercado>(`${base}/filtros?${p.toString()}`)
      setFiltrosMercado(r.data || null)
    } catch { /* filtros sao apoio de UI; a listagem continua funcionando */ }
  }, [base, empresaId, recortePronto, aba, origem])

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
  // Limpa a seleção ao trocar de aba/filtro/modo (os ids podem sair da lista, ou a seleção
  // deixa de fazer sentido fora do Manual — os checkboxes somem junto).
  useEffect(() => { setSelecionados(new Set()) }, [aba, origem, mercado, cidadeFiltro, busca, config.modo])
  // Qualquer mudança no recorte volta a paginação para a 1ª página — senão o operador pode
  // cair numa página vazia depois de filtrar ou trocar de aba (mesmo padrão de Follow-ups e
  // Central de Ligações).
  useEffect(() => { setPagina(1) }, [aba, origem, mercado, cidadeFiltro, busca, view])
  // Recorte de trabalho: hidrata UMA vez e só então libera a busca de leads. A hidratação
  // acontece em efeito (nunca no valor inicial do estado) porque este componente também
  // renderiza no servidor, onde não existe sessionStorage — semear ali faria o HTML do servidor
  // divergir do cliente. O preço é a primeira leva ficar esperando um ciclo; `recortePronto` é
  // o que impede a tela de buscar com o filtro padrão e depois buscar de novo com o restaurado.
  useEffect(() => {
    const salvo = lerFiltros(TELA_RECORTE, empresaId)
    if (salvo) {
      const r = aplicarRecorte(RECORTE_PADRAO, salvo)
      setAba(r.aba)
      setOrigem(r.origem)
      setMercado(r.mercado)
      setCidadeFiltro(r.cidadeFiltro)
      setBusca(r.busca)
      setEscopo(r.escopo)
    }
    setRecortePronto(true)
  }, [empresaId])
  useEffect(() => {
    if (!recortePronto) return
    gravarFiltros(TELA_RECORTE, empresaId, { aba, origem, mercado, cidadeFiltro, busca, escopo })
  }, [recortePronto, empresaId, aba, origem, mercado, cidadeFiltro, busca, escopo])

  // Personalização: carrega do localStorage (1x) e persiste a cada mudança.
  useEffect(() => {
    try {
      const s = localStorage.getItem(CHAVE_VIEW)
      if (s) setView(migrarView(JSON.parse(s)))
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(CHAVE_VIEW, JSON.stringify({ ...view, versao: VIEW_VERSAO })) } catch { /* ignore */ }
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
  // UMA lista, na ordem que o servidor decidiu. A origem virou COLUNA e FILTRO — ela identifica
  // a linha, não a separa em tabelas. Ordenação do "Personalizar" sobrescreve a do cabeçalho.
  const leadsOrdenados = useMemo(() => (
    view.ordenacao !== 'padrao'
      ? ordenarPorView(leadsCustom, view.ordenacao)
      : ordenarLeads(leadsCustom, ordem, previsoesEnvio)
  ), [leadsCustom, ordem, view.ordenacao, previsoesEnvio])
  const totalFiltrado = leadsOrdenados.length
  const avisoJanela = useMemo(() => avisoDeJanela(metaLista), [metaLista])
  const avisoEquipe = useMemo(() => avisoDeEquipe(metaLista?.equipe || null), [metaLista])
  // A ordem da fila só vale enquanto ninguém reordenou por cabeçalho ou pelo Personalizar.
  const ordemManual = view.ordenacao !== 'padrao' || ordem.chave !== 'trabalho'
  // Recorte de apresentação: pagina DEPOIS de filtrar/ordenar (conjunto completo já pronto).
  const pgLeads = useMemo(() => paginar(leadsOrdenados, pagina, POR_PAGINA_PADRAO), [leadsOrdenados, pagina])
  const chips = chipsDaView(view)
  const chipOrigem = origem ? `Origem: ${rotuloFiltroOrigem(origem) || origem}` : ''
  const chipsLista = chipOrigem ? [chipOrigem, ...chips] : chips
  const filtrosAtivos = chips.length + (origem ? 1 : 0) + (view.ordenacao !== 'padrao' ? 1 : 0)
  const mercadoOpcoes = useMemo(() => opcoesMercado(filtrosMercado), [filtrosMercado])
  const cidadeOpcoes = filtrosMercado?.cidades || []

  // Sem teto de 15 aqui: a seleção pode cobrir a página inteira ou todo o filtrado — o
  // envio pra API é que quebra em lotes de MAX_LOTE (ver gerarSelecionadosEmMassa).
  function toggleSel(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // "Página atual" = os leads rodáveis visíveis AGORA. Soma à seleção existente — não
  // substitui, para dar pra somar páginas.
  function idsPaginaAtual(): string[] {
    return pgLeads.itens.filter(isRodavel).map((l) => l.id)
  }
  function selecionarPaginaAtual() {
    setSelecionados((prev) => new Set([...prev, ...idsPaginaAtual()]))
  }
  // Amplia a seleção para todo o conjunto já CARREGADO que respeita os filtros/abas atuais
  // (mesmo universo de `rodaveis`, sem fetch novo). O rótulo do botão diz exatamente isso —
  // "todos os filtrados" prometia a carteira inteira e entregava a janela da listagem, e a
  // barra de seleção declara a diferença quando ela existe (`escopoDaSelecao`).
  function selecionarTodosFiltrados() {
    setSelecionados(new Set(rodaveis.map((l) => l.id)))
  }
  function limparSelecao() {
    setSelecionados(new Set())
  }

  async function trocarModo(modo: string) {
    if (modo === config.modo) return
    const modoAnterior = config.modo
    if (modo === 'automatico' && !podeDispararAutomatico) {
      fb.toast('O modo automático é restrito à administração.', 'error')
      return
    }
    if (modo === 'semi_automatico' && !podeDispararSemi) {
      fb.toast('Você não tem acesso ao modo semiautomático.', 'error')
      return
    }
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

  // MANUAL — gera em massa as mensagens da seleção (IA c/ fallback), sem enviar e sem exigir
  // instância conectada (mesma regra do /gerar de sempre — só empacota em lotes de MAX_LOTE,
  // que é o teto por chamada no backend). Os contadores do progresso vêm das respostas REAIS
  // de cada lote, nunca de uma porcentagem simulada. A mensagem gerada é a MESMA usada por
  // Semi/Automático (grava em prospectador.lead_disparos) — reaproveitada, não duplicada.
  //
  // Reaproveitamento: quem já tem `mensagem_gerada` (rascunho pronto por Manual/Semi/
  // Automático, na MESMA instância — lead sem mensagem pronta NÃO entra
  // no lote enviado ao backend. Sem este filtro, clicar "Gerar mensagens" sobre uma seleção
  // que já tem rascunhos prontos regeneraria tudo (`gerarMensagensSemi` sempre regera, nunca
  // reaproveita) — pagando IA de novo e descartando texto que já podia estar revisado.
  async function gerarSelecionadosEmMassa() {
    if (!instanciaId) { fb.toast('Escolha uma instância.', 'error'); return }
    const ids = [...selecionados]
    if (!ids.length) { fb.toast('Selecione ao menos um lead.', 'error'); return }
    setGerandoLote(true)
    const total = ids.length
    const jaProntos = ids.filter((id) => !!leads.find((l) => l.id === id)?.mensagem_gerada)
    const jaProntosSet = new Set(jaProntos)
    const paraGerar = ids.filter((id) => !jaProntosSet.has(id))
    let prontas = jaProntos.length, erros = 0, pulados = 0, falhasLote = 0
    let falhaSistemica: FalhaSistemicaGeracao | null = null
    if (montadoRef.current) setProgressoLoteManual({ total, processados: jaProntos.length, prontas, erros, pulados })
    try {
      for (let i = 0; i < paraGerar.length; i += MAX_LOTE) {
        const parte = paraGerar.slice(i, i + MAX_LOTE)
        try {
          const r = await apiFetch<GerarResumo>(`${base}/gerar`, {
            method: 'POST',
            body: JSON.stringify({ instancia_id: instanciaId, prospect_ids: parte }),
          })
          prontas += r.data.gerados.filter((g) => !g.erro_ia).length
          erros += r.data.gerados.filter((g) => g.erro_ia).length
          pulados += r.data.pulados.length
          if (r.data.falha_sistemica) {
            // Falha GERAL da ação (IA fora do ar/quota/config): não adianta insistir nos
            // próximos lotes — todos tenderiam a falhar pelo mesmo motivo. O que já foi
            // gerado com sucesso neste e nos lotes anteriores é preservado.
            falhaSistemica = r.data.falha_sistemica
            break
          }
        } catch {
          falhasLote += parte.length
        }
        if (montadoRef.current) {
          setProgressoLoteManual({ total, processados: Math.min(jaProntos.length + i + parte.length, total), prontas, erros, pulados })
        }
      }
      const reaproveitadasTxt = jaProntos.length ? ` (${jaProntos.length} já pronta(s), reaproveitada(s))` : ''
      if (falhaSistemica) {
        const prontasTxt = prontas ? ` ${prontas} mensagem(ns) já gerada(s) foram preservada(s)${reaproveitadasTxt}.` : ''
        fb.toast(`${falhaSistemica.mensagem}${prontasTxt}`, 'error')
      } else {
        const erroTxt = erros ? ` · ${erros} com erro de IA` : ''
        const puladosTxt = pulados ? ` · ${pulados} pulado(s)` : ''
        const falhasTxt = falhasLote ? ` · ${falhasLote} não processado(s) por falha de conexão` : ''
        fb.sucessoModal('Mensagens geradas', `${prontas} pronta(s) aguardando disparo${reaproveitadasTxt}${erroTxt}${puladosTxt}${falhasTxt}.`)
      }
      setSelecionados(new Set())
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Falha ao gerar mensagens em massa.', 'error')
    } finally {
      if (montadoRef.current) {
        setGerandoLote(false)
        setProgressoLoteManual(null)
        await carregarLeads()
      }
    }
  }
  // Abaixo de MAX_LOTE roda direto; acima disso confirma antes (várias chamadas, algumas
  // usando IA — vale avisar antes de disparar um lote grande).
  function pedirGeracaoEmMassa() {
    if (!instanciaId) { fb.toast('Escolha uma instância.', 'error'); return }
    if (!selecionados.size) { fb.toast('Selecione ao menos um lead.', 'error'); return }
    if (selecionados.size > MAX_LOTE) { setConfirmarLoteGrande(true); return }
    gerarSelecionadosEmMassa()
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
    if (!ficha || !instanciaId) return
    if (!ficha.rodavel) { fb.toast('Este lead nao esta elegivel para gerar mensagem.', 'info'); return }
    if (config.modo === 'automatico') { fb.toast('No Automatico, a geracao acontece pela rotina configurada.', 'info'); return }
    setGerandoConversa(true)
    try {
      const texto = await gerarUm(ficha.leadId)
      if (texto) setFicha((cur) => cur ? { ...cur, mensagemGerada: texto } : cur)
    } finally {
      setGerandoConversa(false)
    }
  }

  // ENVIO INDIVIDUAL pelo modal de conversa (manual e semi). Sem disparo em massa —
  // 1 lead por vez, respeitando o cooldown. Semi usa a mensagem já gerada
  // (/disparar-gerados); manual gera na hora (/rodar).
  async function enviarLeadConversa() {
    if (!ficha || !instanciaId) return
    if (!ficha.rodavel) { fb.toast('Este lead nao esta elegivel para envio.', 'info'); return }
    if (config.modo === 'automatico') { fb.toast('No Automatico, os envios saem pela rotina configurada.', 'info'); return }
    if (motivoBloqueioConexao) { fb.toast(motivoBloqueioConexao, 'error'); return }
    if (bloquearPorCooldown()) return
    const { leadId, mensagemGerada } = ficha
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
        setFicha(null)
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
        setFicha(null)
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
        if (motivo === 'sem_whatsapp') { setFicha(null); setTimeout(() => { carregarLeads(); carregarResumo() }, 1200) }
      }
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao enviar.', 'error') }
    finally { setEnviandoConversa(false) }
  }

  // SEMI — abre o próximo lead com mensagem gerada pendente (fila visual; envio 1 a 1).
  function abrirProximoParaEnviar() {
    const prox = gerados[0]
    if (!prox) { fb.toast('Nenhuma mensagem pendente para enviar.', 'info'); return }
    // Aqui o trabalho É a conversa (revisar a mensagem e enviar): abre direto nela.
    abrirFicha(prox, 'conversa')
  }

  async function alterarStatusLead(id: string, statusOperacional: string, sucesso?: string, payload?: StatusPayload) {
    const r = await fb.runTask(
      () => apiFetch<AlterarStatusLeadResp>(`${base}/leads/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusOperacional, ...(payload || {}) }),
      }),
      { sucesso: sucesso || 'Status do lead atualizado.' }
    )
    const novo = r.data
    const statusEm = new Date().toISOString()
    const atualizarLeadNaLista = (l: Lead): Lead => ({
      ...l,
      status: novo.status,
      qualificacao: novo.qualificacao ?? l.qualificacao,
      responsavel_id: novo.responsavel_id ?? l.responsavel_id,
      responsavel_desde: novo.responsavel_desde ?? l.responsavel_desde,
      ultimo_status_acao: acaoOperacionalAuditavel(statusOperacional),
      ultimo_status_estado: novo.status,
      ultimo_status_em: statusEm,
      proximo_agendamento: novo.agenda_evento?.data_inicio ?? l.proximo_agendamento,
    })
    setLeads((prev) => prev.flatMap((l) => {
      if (l.id !== id) return [l]
      const atualizado = atualizarLeadNaLista(l)
      return leadPermaneceNaAbaBanco(atualizado, aba) ? [atualizado] : []
    }))
    setSelecionados((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setFicha((cur) => {
      if (!cur || cur.leadId !== id) return cur
      const leadAberto = atualizarLeadNaLista(cur.leadAberto)
      if (!leadPermaneceNaAbaBanco(leadAberto, aba)) return null
      return { ...cur, status: novo.status, leadAberto }
    })
    carregarResumo()
    return novo
  }

  async function fechar(id: string) {
    try {
      await alterarStatusLead(id, 'fechado', 'Lead marcado como fechado. 🎉')
      setLeads((prev) => prev.filter((l) => l.id !== id))
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function reabrir(id: string) {
    try {
      await alterarStatusLead(id, 'respondido', 'Lead reaberto como respondido.')
      setLeads((prev) => prev.filter((l) => l.id !== id))
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function alterarStatusConversa(statusOperacional: string, payload?: StatusPayload) {
    if (!ficha) return
    const rotulos: Record<string, string> = {
      marcado: 'Lead marcado.',
      contatado: 'Lead marcado como contatado.',
      respondido: 'Lead marcado como respondido.',
      ligacao_realizada: 'Ligação registrada e lead marcado como contatado.',
      reuniao_agendada: 'Reunião agendada para este lead.',
      fechado: 'Lead marcado como fechado.',
      descartado: 'Lead descartado.',
    }
    await alterarStatusLead(ficha.leadId, statusOperacional, rotulos[statusOperacional] || 'Status do lead atualizado.', payload)
  }

  // ─── CRM em equipe: ownership do lead (Etapa 4) ──────────────────────────────────────────
  //
  // As capacidades chegam resolvidas pelo backend; a tela só as consulta para não oferecer um
  // botão que vai responder 403/422. O servidor continua sendo a autoridade.
  const podeAssumir = temCapacidade(capacidades, 'lead_assumir')
  const podeTransferir = temCapacidade(capacidades, 'lead_transferir')
  const podeVerTodos = temCapacidade(capacidades, 'lead_ver_brutos')

  /**
   * Assume um lead LIVRE. A corrida entre dois vendedores é resolvida pelo BANCO (claim atômico):
   * quem perde recebe 409 com o nome de quem ganhou, e é isso que a mensagem mostra.
   */
  async function assumirLead(l: Lead) {
    try {
      await fb.runTask(
        () => apiFetch(`${base}/leads/${l.id}/assumir`, { method: 'POST' }),
        { sucesso: `${l.nome} agora é seu.` }
      )
      carregarLeads()
    } catch { /* o 409 já explica quem ganhou — o feedback exibe a mensagem do servidor */ }
  }

  /** Devolve o PRÓPRIO lead para a fila de livres. Não exige capacidade de transferir. */
  async function devolverLead(l: Lead) {
    try {
      await fb.runTask(
        () => apiFetch(`${base}/leads/${l.id}/responsavel`, {
          method: 'PUT', body: JSON.stringify({ usuario_id: null }),
        }),
        { sucesso: `${l.nome} voltou para a fila de livres.` }
      )
      carregarLeads()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`${base}/leads/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, email: email || null } : l)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  // "+ telefone" / "editar": quem valida é o backend (formato, duplicidade na empresa) — a
  // resposta traz o que MUDOU junto (status promovido, `tem_whatsapp` zerado), e o estado local
  // recebe os três. Atualizar só o telefone deixaria o lead na tela com o selo "sem WhatsApp"
  // do número ANTIGO, que é justamente o que faz o operador achar que a correção não pegou.
  async function salvarTelefone(id: string, telefone: string) {
    const r = await apiFetch<{ id: string; telefone: string | null; status: string; tem_whatsapp: boolean | null }>(
      `${base}/leads/${id}/telefone`, { method: 'PATCH', body: JSON.stringify({ telefone }) })
    setLeads((prev) => prev.map((l) => (l.id === id
      ? { ...l, telefone: r.data.telefone, status: r.data.status, tem_whatsapp: r.data.tem_whatsapp }
      : l)))
    // O modal aberto é a outra porta desta mesma edição: sem atualizar o `numero` dele, ele
    // continuaria dizendo "Telefone pendente" depois de o número ter sido salvo.
    setFicha((c) => {
      if (!c || c.leadId !== id) return c
      const digitos = String(r.data.telefone || '').replace(/\D/g, '')
      return { ...c, numero: digitos ? `${digitos}@s.whatsapp.net` : '', status: r.data.status }
    })
    fb.toast(r.data.telefone ? 'Telefone salvo.' : 'Telefone removido.')
  }

  // A confirmação vive em `ModalConfirmar` (o `window.confirm` é proibido pelo guia visual: não
  // separa aviso de corpo, não rotula o botão com o verbo da ação e some do fluxo de foco do
  // teclado). O texto do que ela apaga vem do módulo puro — é o que impede a tela de prometer
  // uma exclusão em massa por filtro/seleção, que o backend não faz.
  async function limpar() {
    setConfirmarLimpeza(false)
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

  // O ESCOPO da exportação continua sendo o conjunto FILTRADO (o mesmo `query()` da listagem) —
  // o modal escolhe quais COLUNAS entram, nunca quais leads. Selecionados e "página atual"
  // exigiriam o servidor aceitar lista de ids, o que ele não faz; prometer isso na tela daria
  // um arquivo diferente do que a pessoa pediu.
  async function exportar(colunas: string[], nomeArquivo: string) {
    const padrao = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}`
    const pedido = validarExportacao({ colunas, nomeArquivo, padrao })
    if (!pedido.ok) { fb.toast(pedido.motivo, 'error'); return }
    setExportando(true)
    try {
      const url = `${base}/export.csv?${query()}&colunas=${encodeURIComponent(pedido.colunas.join(','))}`
      await fb.runTask(() => apiDownload(url, pedido.nome), { sucesso: 'CSV exportado.' })
      setExportOpen(false)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setExportando(false) }
  }

  const mostrarRodar = aba === 'sem_contato'
  // Checkbox de seleção em lote só no Manual: Semi/Automático já geram sozinhos em segundo
  // plano (worker), então "selecionar e gerar" não se aplica — o envio ali continua 1 a 1
  // pelo telefone/modal.
  const mostrarSelecao = mostrarRodar && config.modo === 'manual'
  const modoAtual = modosDisponiveis.find((m) => m.valor === config.modo) || modosDisponiveis[0] || MODOS[0]
  // Qual cartão aparece marcado. Modo salvo que a pessoa não pode operar (capacidade) cai no
  // primeiro disponível — a mesma regra que o <select> aplicava.
  const modoSelecionado = modosDisponiveis.some((m) => m.valor === config.modo)
    ? config.modo
    : (modosDisponiveis[0]?.valor || 'manual')
  // Enviar fica liberado em Manual e Semi: se não houver mensagem gerada, o backend gera na hora.
  const podeEnviarConversa = !!ficha && !!instanciaId && ficha.rodavel
    && config.modo !== 'automatico' && !motivoBloqueioConexao
  const podeGerarConversa = !!ficha && !!instanciaId && ficha.rodavel
    && config.modo !== 'automatico'

  // Por que o disparo esta indisponivel AGORA — a mesma pergunta que o cronometro ja responde
  // no topo, dita tambem no botao de cada lead. No celular o topo sai da tela assim que a
  // fila rola, e um botao apagado sem motivo faz o operador clicar de novo achando que falhou.
  const motivoEnvioBloqueado = config.modo === 'automatico'
    ? 'No modo Automático o envio é controlado pela rotina configurada.'
    : motivoBloqueioConexao
      || (cooldownAtivo ? `Próximo envio em ${fmtMMSS(cooldownS as number)}` : '')
  const envioBloqueado = Boolean(motivoEnvioBloqueado)

  /**
   * A ação principal do lead ABERTO na ficha. É a MESMA função que decide o botão de cada linha
   * (`lib/banco-leads-acao.js`) — uma segunda régua aqui faria a lista prometer "Enviar" e a
   * ficha oferecer outra coisa para o mesmo lead.
   */
  const acaoDaFicha = useMemo(() => {
    if (!leadDaFicha) return null
    return acaoPrincipalDoLead({
      temTelefone: Boolean(leadDaFicha.telefone),
      rodavel: isRodavel(leadDaFicha),
      travado: isLocked(leadDaFicha),
      motivoTravado: leadDaFicha.bloqueio_motivo ? (MOTIVO_LABEL[leadDaFicha.bloqueio_motivo] || leadDaFicha.bloqueio_motivo) : '',
      mensagemPronta: Boolean(leadDaFicha.mensagem_gerada),
      respondeu: leadDaFicha.status === 'respondeu',
      erroIa: temErroIa(leadDaFicha),
      envioBloqueado,
      motivoEnvioBloqueado,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadDaFicha, envioBloqueado, motivoEnvioBloqueado])

  /**
   * O RESUMO da ficha: o que a tela sabe e a ficha não — faixa de trabalho, contato e dono.
   * Nada aqui é recalculado: `faixa_trabalho` vem do servidor e `donoDoLead` é o módulo puro
   * que a listagem já usa na coluna Responsável.
   */
  const resumoDaFicha = useMemo(() => {
    if (!leadDaFicha) return null
    const faixa = seloFaixa(leadDaFicha.faixa_trabalho)
    const dono = donoDoLead(leadDaFicha, usuario?.id)
    const contatos = [
      leadDaFicha.telefone ? `Telefone ${leadDaFicha.telefone}` : 'Sem telefone',
      leadDaFicha.email ? `E-mail ${leadDaFicha.email}` : 'Sem e-mail',
    ]
    return (
      <div className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Próxima ação</p>
        {faixa ? (
          <>
            <p className="mt-1 text-sm font-semibold text-ink">{faixa.rotulo}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{faixa.dica}</p>
          </>
        ) : (
          /* Faixa desconhecida não vira rótulo inventado — o mesmo contrato de `seloFaixa`. */
          <p className="mt-1 text-sm text-ink-3">A fila de trabalho ainda não classificou este lead.</p>
        )}
        <dl className="mt-3 grid gap-1.5 border-t border-line pt-3 text-xs">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-ink-3">Contato</dt>
            <dd className="min-w-0 text-ink-2">{contatos.join(' · ')}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-ink-3">Responsável</dt>
            <dd className="min-w-0 text-ink-2">{dono.rotulo}</dd>
          </div>
          {leadDaFicha.bloqueio_motivo && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-ink-3">Trava</dt>
              <dd className="min-w-0 text-amber-800">
                {MOTIVO_LABEL[leadDaFicha.bloqueio_motivo] || leadDaFicha.bloqueio_motivo}
                {leadDaFicha.bloqueado_ate ? ` · até ${fmtData(leadDaFicha.bloqueado_ate)}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </div>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadDaFicha, usuario?.id])
  // O ESCOPO REAL da selecao, em texto — inclusive o aviso de que ela alcanca so' a janela
  // carregada. A regra vive no modulo puro; a tela nao pode prometer alem do que o servidor
  // devolveu.
  const escopoSelecao = escopoDaSelecao({
    selecionados: selecionados.size,
    naPagina: idsPaginaAtual().length,
    carregados: rodaveis.length,
    totalCarteira: metaLista?.total_carteira ?? null,
  })
  // O resumo de UMA LINHA que fica sempre visivel. A regra de qual estado mostrar vive no
  // modulo puro — a tela so desenha (mesmo contrato de `lib/site-rotulos.js`).
  const faixaEnvio = useMemo(() => faixaDeEnvio({
    modoLabel: modoAtual.label,
    instanciaLabel: instanciaSel ? (instanciaSel.nome || instanciaSel.evolution_instance) : '',
    conexao: podeEscolherInstancia || instanciaSel ? rotuloConexao : '',
    motivoBloqueio: motivoBloqueioConexao || '',
    cooldown: cooldownAtivo ? fmtMMSS(cooldownS as number) : '',
    automatico: config.modo === 'automatico',
    autoAtivo: !!config.auto_ativo,
  }), [modoAtual.label, instanciaSel, podeEscolherInstancia, rotuloConexao, motivoBloqueioConexao, cooldownAtivo, cooldownS, config.modo, config.auto_ativo])

  // Quantos recortes de CARTEIRA estao ligados. Origem saiu daqui de proposito: ela agora vive
  // no modal "Colunas", junto dos filtros de visualizacao da lista.
  const filtrosDeCarteira = [escopo, mercado, cidadeFiltro].filter(Boolean).length
  // UM so' reset de carteira, usado pela barra do computador e pela folha do celular: duas
  // listas divergiriam e um dos dois botoes deixaria um filtro ligado em silencio.
  const limparCarteira = () => { setMercado(''); setCidadeFiltro(''); setEscopo(''); setBusca('') }

  /**
   * Os campos de recorte da carteira. Renderizados em DOIS lugares — a barra do computador e a
   * folha do celular — e por isso recebem um prefixo de id: a barra fica `hidden`, não
   * desmontada, então os dois existem no DOM ao mesmo tempo e um `htmlFor` repetido faria o
   * rótulo de um apontar para o campo do outro.
   */
  const camposFiltro = (p: string) => (
    <>
      {/* Recorte por RESPONSÁVEL (CRM em equipe, Etapa 4).
          Quem não pode ver a carteira inteira não recebe a opção "Todos" — oferecer uma opção
          que o servidor rebaixa faria a tela mostrar menos do que prometeu. */}
      {podeVerTodos && (
        <div>
          <label htmlFor={`${p}-carteira`} className="mb-1 block text-xs text-ink-3">Carteira</label>
          <select id={`${p}-carteira`} value={escopo} onChange={(e) => setEscopo(e.target.value)}
            className={classesEntrada({ extra: 'min-h-11 md:min-h-0 md:w-auto md:min-w-[140px]' })}>
            {/* A 1ª opção é o padrão do servidor (valor ''), e ela precisa existir na lista:
                sem ela o controle exibia uma coisa e o estado enviava outra, e não havia como
                voltar ao padrão depois de filtrar. */}
            {opcoesEscopo(podeVerTodos).map((o) => (
              <option key={o.valor || 'padrao'} value={o.valor}>{o.rotulo}</option>
            ))}
          </select>
        </div>
      )}
      <div className="md:min-w-[200px] md:flex-1">
        <label htmlFor={`${p}-busca`} className="mb-1 block text-xs text-ink-3">Buscar (nome, telefone, email, @)</label>
        <input id={`${p}-busca`} type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="digite para filtrar…" className={classesEntrada({ extra: 'min-h-11 md:min-h-0' })} />
      </div>
      <div>
        <label htmlFor={`${p}-nicho`} className="mb-1 block text-xs text-ink-3">Nicho/Categoria</label>
        <select id={`${p}-nicho`} value={mercado} onChange={(e) => setMercado(e.target.value)}
          className={classesEntrada({ extra: 'min-h-11 md:min-h-0 md:w-auto md:min-w-[180px]' })}>
          <option value="">Todos os nichos</option>
          {mercadoOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${p}-cidade`} className="mb-1 block text-xs text-ink-3">Cidade</label>
        <select id={`${p}-cidade`} value={cidadeFiltro} onChange={(e) => setCidadeFiltro(e.target.value)}
          className={classesEntrada({ extra: 'min-h-11 md:min-h-0 md:w-auto md:min-w-[150px]' })}>
          <option value="">Todas</option>
          {cidadeOpcoes.map((o) => <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>)}
        </select>
      </div>
      {(mercado || cidadeFiltro) && (
        <div>
          <label className="mb-1 hidden text-xs text-ink-3 md:block">&nbsp;</label>
          <Botao variante="secundaria" onClick={() => { setMercado(''); setCidadeFiltro('') }} className="min-h-11 md:min-h-0">
            Limpar mercado
          </Botao>
        </div>
      )}
    </>
  )

  /** Atalhos de 1 clique. Não são filtros novos: escrevem os mesmos valores de `view`. */
  const chipsRapidos = ([
    { chave: 'com_whatsapp', label: 'Com WhatsApp', ativo: view.envio === 'possivel', onClick: () => patchView({ envio: view.envio === 'possivel' ? 'todos' : 'possivel' }) },
    { chave: 'sem_site', label: 'Sem site próprio', ativo: view.site === 'sem', onClick: () => patchView({ site: view.site === 'sem' ? 'todos' : 'sem' }) },
    { chave: 'com_social', label: 'Com rede social', ativo: view.social === 'com', onClick: () => patchView({ social: view.social === 'com' ? 'todos' : 'com' }) },
    { chave: 'sem_social', label: 'Sem rede social', ativo: view.social === 'sem', onClick: () => patchView({ social: view.social === 'sem' ? 'todos' : 'sem' }) },
    { chave: 'falha_envio', label: 'Falha no envio', ativo: view.disparo === 'falha', onClick: () => patchView({ disparo: view.disparo === 'falha' ? 'todos' : 'falha' }) },
  ] as const).map((f) => (
    <button key={f.chave} type="button" onClick={f.onClick} aria-pressed={f.ativo}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${f.ativo ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:bg-surface-3'}`}>
      {f.label}
    </button>
  ))

  const propsCartao = {
    mostrarRodar: mostrarSelecao,
    selecionados,
    onToggleSel: toggleSel,
    onAbrirFicha: abrirFicha,
    onAbrirDetalhes: (l: Lead) => abrirFicha(l, 'detalhes'),
    envioBloqueado,
    motivoEnvioBloqueado,
    usuarioId: usuario?.id,
    podeAssumir,
    podeTransferir,
    onAssumir: assumirLead,
    onDevolver: devolverLead,
  }

  return (
    <div className="space-y-6">
      {/* CABEÇALHO — uma ação primária ("Adicionar cadastro"), o resto recolhido. As três ações
          soltas lado a lado davam o mesmo peso visual a cadastrar, exportar e APAGAR. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Banco de Leads</h1>
          <p className="text-sm text-ink-3 mt-1">
            Gerencie, filtre e trabalhe seus leads das duas origens em um único lugar.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Botao variante="secundaria" onClick={() => setAjudaOpen(true)} className="min-h-11 sm:min-h-0">
            Como funciona?
          </Botao>
          <Botao variante="primaria" onClick={() => setCadastroOpen(true)} iconeInicio={<IconPlus />}
            className="min-h-11 sm:min-h-0">
            Adicionar cadastro
          </Botao>
          {/* O menu não nasce quando a pessoa não tem nenhuma das duas capacidades — o módulo
              puro decide, e botão inerte só convida ao clique. */}
          <MenuMaisAcoes
            itens={itensMaisAcoes({ podeExportar: podeExportarCsv, podeLimpar: podeLimparBanco })}
            ocupado={exportando || limpando}
            onEscolher={(chave) => {
              if (chave === 'exportar') setExportOpen(true)
              if (chave === 'limpar') setConfirmarLimpeza(true)
            }}
          />
        </div>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {msg && <p className="text-emerald-600 text-sm">{msg}</p>}

      {/* LISTA × QUADRO DO DIA — duas vistas da MESMA carteira, sem item novo no menu lateral.
          `radiogroup` e não `tablist`: aqui não se troca um painel de conteúdo equivalente, se
          escolhe entre o acervo inteiro e o recorte de hoje. O estado vai no rótulo, não só na
          cor. */}
      <div role="radiogroup" aria-label="Como ver a carteira" className="inline-flex gap-1 rounded-lg border border-line bg-surface-2 p-1">
        {([['lista', 'Lista', 'Toda a carteira, na ordem de trabalho.'],
           ['quadro', 'Quadro do dia', 'Só os leads que você escolheu trabalhar nesta data.']] as const).map(([v, rotulo, dica]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vista === v}
            title={dica}
            onClick={() => trocarVista(v)}
            className={`inline-flex h-9 items-center rounded-md px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              vista === v ? 'bg-surface font-semibold text-brand shadow-card' : 'text-ink-2 hover:bg-surface-3'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {vista === 'lista' && (
      <>
      {/* O FUNIL — seletor de aba, agora em UMA linha. Eram cinco cartoes de ~110px de altura
          que, junto do cabecalho e da barra de envio, empurravam o primeiro lead para fora da
          primeira dobra em 1366x768: a pessoa abria a carteira e via painel, nao lead.
          O que cada cartao dizia continua dito — a contagem no proprio botao e a participacao
          do estagio no `title`, que e' informacao de leitura, nao de decisao. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Estágio do funil">
        {cartoesDeFunil(ABAS, resumo).map((c) => (
          <AbaFunil key={c.valor} cartao={c} ativo={aba === c.valor} onEscolher={() => setAba(c.valor)} />
        ))}
      </div>

      {/* ENVIO — uma faixa sempre visivel + a CONFIGURACAO recolhida. Só na aba Sem contato.
          O painel inteiro (tres cartoes de modo + instancia + cronometro + janela do
          automatico) ocupava ~260px acima da lista o tempo todo. O que dele e' decisao do dia
          ficou na faixa; o que e' ajuste ficou atras de "Configurar envio".
          NADA que bloqueia o envio foi recolhido: o motivo do bloqueio e o aviso de saudacao
          faltando continuam fora do painel. */}
      {mostrarRodar && (
        <div className="space-y-2">
          <FaixaEnvio
            faixa={faixaEnvio}
            aberto={painelEnvioAberto}
            onAlternar={() => setPainelEnvioAberto((v) => !v)}
            onTestar={() => setSaudacaoOpen(true)}
            podeTestar={!!instanciaId}
            saudacaoFaltando={saudacaoFaltando}
          />
          {saudacaoFaltando && (
            <div className="flex items-center gap-2 rounded-lg border border-estado-danger/30 bg-red-50 px-3 py-2 text-sm text-red-700">
              <IconAlert className="h-4 w-4 shrink-0" />
              <span>Você precisa configurar a saudação primeiro — clique em <b>Testar envio</b>.</span>
            </div>
          )}
          {painelEnvioAberto && (
          <div className="rounded-lg border border-line bg-surface p-4 shadow-card space-y-3">
          <div className="space-y-4">
            <div className={`grid gap-3 ${podeEscolherInstancia ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,240px)]' : ''}`}>
              <div>
                {/* Os três modos deixaram de ser um <select>: a escolha muda o que o sistema faz
                    com o lead (quem envia, quando e com que aprovação), e uma lista fechada
                    escondia as outras duas opções e a diferença entre elas. */}
                <p id="modo-disparo-rotulo" className="mb-1.5 text-xs text-ink-3">Modo de disparo</p>
                <div role="radiogroup" aria-labelledby="modo-disparo-rotulo" className="grid gap-2 sm:grid-cols-3">
                  {modosDisponiveis.map((m) => (
                    <CartaoModo key={m.valor} modo={m} ativo={modoSelecionado === m.valor}
                      onEscolher={() => trocarModo(m.valor)} />
                  ))}
                </div>
              </div>
              {podeEscolherInstancia && (
                <div>
                  <label className="block text-xs text-ink-3 mb-1">Instância</label>
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
              )}
            </div>

            <div className="space-y-2 border-t border-line pt-3">
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
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
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
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                      Envia 1 lead por vez na janela configurada.
                    </p>
                  </div>
                )}

                <button onClick={() => setSaudacaoOpen(true)} disabled={!instanciaId}
                  className={`shrink-0 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 ${
                    saudacaoFaltando
                      ? 'border-red-500 text-red-600 ring-2 ring-red-400 ring-offset-1 animate-pulse hover:bg-red-50'
                      : 'hover:bg-surface-2'
                  }`}
                  title={saudacaoFaltando
                    ? 'Configure a saudação (mensagem-base) desta instância antes de disparar'
                    : 'Envia uma mensagem de teste pro seu número e ajusta a saudação/IA'}>
                  <span className="inline-flex items-center gap-1.5"><IconFlask /> Testar envio</span>
                </button>
              </div>

              {config.modo !== 'automatico' && (
                <p className="border-t pt-2 text-xs leading-relaxed text-ink-3">{modoAtual.hint}</p>
              )}
            </div>
          </div>

          {/* Config do modo Automático */}
          {podeDispararAutomatico && config.modo === 'automatico' && (
            <div className="mt-2 rounded-lg border bg-surface-2/60 p-3 space-y-2">
              {/* Status claro + botão Ligar/Desligar (com aviso ao ligar). */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-2 text-sm font-bold ${config.auto_ativo ? (motivoBloqueioConexao ? 'text-red-700' : 'text-emerald-700') : 'text-ink-3'}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${config.auto_ativo ? (motivoBloqueioConexao ? 'bg-red-500' : 'bg-emerald-500 animate-pulse') : 'bg-line-strong'}`}></span>
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
                  <label className="block text-xs text-ink-3 mb-1">Início</label>
                  <input type="time" value={config.janela_inicio} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, janela_inicio: e.target.value }))}
                    onBlur={(e) => salvarAutoConfig({ janela_inicio: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-3 mb-1">Fim</label>
                  <input type="time" value={config.janela_fim} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, janela_fim: e.target.value }))}
                    onBlur={(e) => salvarAutoConfig({ janela_fim: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-3 mb-1">Mín. (min)</label>
                  <input type="number" min={15} max={30} value={config.intervalo_min} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, intervalo_min: Number(e.target.value) }))}
                    onBlur={(e) => salvarAutoConfig({ intervalo_min: Number(e.target.value) })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-3 mb-1">Máx. (min)</label>
                  <input type="number" min={15} max={30} value={config.intervalo_max} disabled={salvandoAuto}
                    onChange={(e) => setConfig((c) => ({ ...c, intervalo_max: Number(e.target.value) }))}
                    onBlur={(e) => salvarAutoConfig({ intervalo_max: Number(e.target.value) })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-ink-3 mb-1">Teto/dia</label>
                  <input type="text" value={`${config.teto_diario} (fixo)`} disabled readOnly
                    className="w-full border rounded-lg px-2 py-1.5 text-sm bg-surface-3 text-ink-3"
                    title="Limite de segurança anti-ban. O volume real é limitado pelo intervalo × janela." />
                </div>
              </div>
            </div>
          )}
          </div>
          )}
        </div>
      )}

      {/* CELULAR — busca sempre visivel e o resto atras de "Filtros". Os seis controles lado a
          lado empilhavam no telefone e empurravam o primeiro lead para fora da tela: a pessoa
          abria a carteira e via formulario, nao lead. */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="min-w-0 flex-1">
          {/* Id próprio: `camposFiltro('m')` também tem um campo de busca dentro da folha, e
              dois `id` iguais fariam o rótulo de um apontar para o campo do outro. */}
          <label htmlFor="busca-topo" className="sr-only">Buscar (nome, telefone, email, @)</label>
          <input id="busca-topo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, telefone, e-mail, @perfil"
            className={classesEntrada({ extra: 'min-h-11' })} />
        </div>
        <Botao variante={filtrosDeCarteira > 0 ? 'primaria' : 'secundaria'}
          onClick={() => setFiltrosAbertos(true)}
          className="min-h-11 shrink-0"
          iconeInicio={<IconGear />}>
          {filtrosDeCarteira > 0 ? `Filtros · ${filtrosDeCarteira}` : 'Filtros'}
        </Botao>
      </div>

      {/* A folha de filtros do CELULAR. A ação primária ("Ver N leads") fica presa no rodapé,
          ao alcance do polegar — não no topo, onde o X dos modais centrados morava. */}
      <FolhaModal
        aberto={filtrosAbertos}
        titulo="Filtros"
        descricao="Recorte da carteira. Origem, colunas e presets continuam em “Colunas”, no computador."
        onFechar={() => setFiltrosAbertos(false)}
        tamanho="sm"
        rodape={
          <>
            <Botao variante="neutra" onClick={limparCarteira}
              className="min-h-11">
              Limpar
            </Botao>
            <Botao variante="primaria" onClick={() => setFiltrosAbertos(false)} className="min-h-11 flex-1 sm:flex-none">
              Ver {totalFiltrado} lead{totalFiltrado === 1 ? '' : 's'}
            </Botao>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Atalhos</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
              {chipsRapidos}
            </div>
          </div>
          <div className="space-y-3">{camposFiltro('m')}</div>
        </div>
      </FolhaModal>

      {/* ⚠️ O aviso de EQUIPE fica AQUI, e nao na barra da lista: o recorte por nicho e'
          obrigatorio e a tela e' obrigada a declara-lo (AGENTS.md, Etapa 3) — inclusive quando
          a lista esta VAZIA e no CELULAR, dois casos em que a barra da lista nao aparece.
          Movê-lo para la' faria o vendedor achar que a carteira encolheu sem motivo. */}
      {avisoEquipe && (
        <p className="flex items-center gap-1.5 text-xs text-cyan-800">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" aria-hidden="true" />
          {avisoEquipe}
        </p>
      )}

      {/* As outras duas faixas (janela da listagem, ordem em vigor e chips de filtro) foram
          para a BARRA DA LISTA. Eram tarjas empilhadas entre o filtro e a tabela falando da
          MESMA lista, e juntas comiam a primeira dobra. Nada foi removido: cada uma virou um
          selo na barra, e o `title` carrega a frase inteira. */}

      {/* PROGRESSO DO SEMIAUTOMÁTICO — uma linha, não um card. É observação (o worker prepara
          as mensagens em segundo plano), não decisão: o card de 3 blocos ocupava primeira dobra
          para dizer um número. Continua com `aria-live` e continua distinguindo "lendo",
          "indisponível" e o progresso real. */}
      {mostrarRodar && config.modo === 'semi_automatico' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card" aria-live="polite">
          <span className="font-semibold text-ink-2">Preparando mensagens em segundo plano</span>
          <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-surface-3" role="progressbar"
            aria-label="Progresso da geração das mensagens" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={geracaoProgresso ? percentualGeracao : undefined}>
            <span className={`block h-full rounded-full transition-[width] duration-500 ${geracaoProgresso?.erros ? 'bg-estado-warn' : 'bg-estado-ok'}`}
              style={{ width: `${percentualGeracao}%` }} />
          </span>
          <span className="font-bold tabular-nums text-ink-2">
            {geracaoProgresso ? `${percentualGeracao}%` : geracaoProgressoErro ? 'Indisponível' : 'Lendo…'}
          </span>
          {geracaoProgresso && (
            <span className="flex flex-wrap gap-x-3 text-ink-3">
              <span><b className="text-emerald-700">{geracaoProgresso.prontas}</b> pronta(s)</span>
              <span><b className="text-brand">{geracaoProgresso.gerando}</b> gerando</span>
              <span><b className="text-ink-2">{geracaoProgresso.eligiveis}</b> pendente(s)</span>
              {geracaoProgresso.erros > 0 && <span className="text-amber-700"><b>{geracaoProgresso.erros}</b> com erro de IA</span>}
            </span>
          )}
          {!geracaoProgresso && geracaoProgressoErro && (
            <span className="text-amber-700">Não foi possível atualizar o progresso agora. Tentando novamente…</span>
          )}
          <span className="basis-full text-[11px] text-slate-400">
            Pode sair desta tela — o sistema continua trabalhando e inclui os leads novos sozinho.
          </span>
        </div>
      )}

      {/* BARRA CONTEXTUAL DE SELEÇÃO — só existe quando há algo selecionado.
          Era um bloco PERMANENTE ("Seleção em massa"), acima da lista, com dois atalhos de
          texto e uma explicação de três linhas, ocupando primeira dobra para uma ação
          eventual. A seleção agora começa no checkbox do cabeçalho da tabela, e esta barra
          aparece como CONSEQUÊNCIA dela (padrão de barra contextual de data table).

          O texto do escopo vem do módulo puro: o atalho se chamava "Selecionar todos os
          filtrados" e selecionava apenas o conjunto CARREGADO — quem tem 1.240 leads no filtro
          lia aquilo e concluía que mandara gerar mensagem para os 1.240. */}
      {mostrarSelecao && escopoSelecao.ativo && (
        <div className="sticky top-2 z-30 space-y-2 rounded-lg border border-brand bg-brand/5 px-3 py-2 shadow-card" aria-live="polite">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-bold tabular-nums text-brand">{escopoSelecao.rotulo}</span>
            {escopoSelecao.podeAmpliar && (
              <button type="button" onClick={selecionarTodosFiltrados} disabled={gerandoLote}
                className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
                {escopoSelecao.rotuloAmpliar}
              </button>
            )}
            <button type="button" onClick={limparSelecao} disabled={gerandoLote}
              className="h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
              Limpar seleção
            </button>
            <button type="button" onClick={pedirGeracaoEmMassa}
              disabled={gerandoLote || !instanciaId}
              title={!instanciaId ? 'Escolha uma instância em "Configurar envio" antes de gerar.' : undefined}
              className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:opacity-50">
              {gerandoLote && <Spinner />}
              {gerandoLote ? 'Gerando…' : 'Gerar mensagens (sem enviar)'}
            </button>
          </div>
          {/* A diferença entre a janela carregada e a carteira filtrada é DITA, não escondida. */}
          {escopoSelecao.aviso && <p className="text-[11px] text-ink-3">{escopoSelecao.aviso}</p>}
          {progressoLoteManual && (
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar"
                aria-label="Progresso da geração em massa" aria-valuemin={0} aria-valuemax={progressoLoteManual.total}
                aria-valuenow={progressoLoteManual.processados}>
                <div className={`h-full rounded-full transition-[width] duration-300 ${progressoLoteManual.erros ? 'bg-estado-warn' : 'bg-estado-ok'}`}
                  style={{ width: `${progressoLoteManual.total ? Math.round((progressoLoteManual.processados / progressoLoteManual.total) * 100) : 0}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
                <span><b className="text-ink-2">{progressoLoteManual.processados}</b> de {progressoLoteManual.total} processado(s)</span>
                <span><b className="text-emerald-700">{progressoLoteManual.prontas}</b> pronta(s)</span>
                {progressoLoteManual.erros > 0 && <span className="text-amber-700"><b>{progressoLoteManual.erros}</b> com erro de IA</span>}
                {progressoLoteManual.pulados > 0 && <span><b>{progressoLoteManual.pulados}</b> pulado(s)</span>}
                <span className="text-slate-400">Continua rodando se você trocar de aba — só fechar ou recarregar a página interrompe.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* A LISTA — uma só, com a origem identificando cada linha. */}
      {carregando && !leads.length ? (
        <p className="text-sm text-slate-400 text-center py-8">Carregando…</p>
      ) : (
        <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {/* COMPUTADOR — recorte da carteira dentro da propria area da lista. Origem ficou no
              modal "Colunas": ela e' uma preferencia de visualizacao/fonte, nao um atalho solto
              na linha. */}
          <div className="hidden border-b border-line bg-surface px-3 py-3 md:block">
            <div className="flex flex-wrap items-end gap-3">
              {camposFiltro('d')}
              {(filtrosDeCarteira > 0 || busca.trim()) && (
                <div>
                  <label className="mb-1 block text-xs text-ink-3">&nbsp;</label>
                  <Botao variante="neutra" onClick={limparCarteira}>
                    Limpar filtros
                  </Botao>
                </div>
              )}
            </div>
          </div>

          {/* A BARRA DA LISTA (computador) — o que está na tela, em que ordem, e como mudar as
              duas coisas. A ordenação global já existia dentro do "Personalizar"; aqui ela fica
              onde a pessoa olha a lista, sem abrir modal para trocar de ordem. */}
          <div className="hidden flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-surface-2 px-3 py-2 md:flex">
            {/* ESQUERDA — o que esta na tela. Contagem, recorte da janela e filtros em vigor
                na MESMA linha: sao tres frases sobre a mesma lista, e empilhadas viravam tres
                tarjas coloridas na primeira dobra. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-semibold text-ink">Lista de leads</h2>
              <span className="text-xs text-ink-3" aria-live="polite">
                <span className="tabular-nums">{totalFiltrado}</span> lead{totalFiltrado === 1 ? '' : 's'} nesta visualização
              </span>

              {/* A janela vira SELO, com a frase inteira no `title`: o numero cabe na barra,
                  a orientacao ("use a busca ou os filtros") continua alcancavel. */}
              {avisoJanela && (
                <span title={avisoJanela.texto}
                  className="cursor-help rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                  janela: {avisoJanela.curto}
                </span>
              )}

              {/* Ordem manual e filtros do Personalizar: selos, nao tarjas. */}
              {ordemManual && (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] text-brand">
                  ordem manual
                </span>
              )}
              {chipsLista.map((ch) => (
                <span key={ch} className="rounded-full border border-line bg-surface-3 px-2 py-0.5 text-[11px] text-ink-2">{ch}</span>
              ))}
            </div>

            {/* DIREITA — como mudar as duas coisas. */}
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="ordenar-lista" className="text-xs text-ink-3">Ordenar por</label>
              <select id="ordenar-lista" value={view.ordenacao}
                onChange={(e) => patchView({ ordenacao: e.target.value })}
                className={classesEntrada({ extra: 'w-auto min-w-[180px]' })}>
                {ORDENACOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
              <Botao variante="secundaria" onClick={() => setPersAberto(true)} iconeInicio={<IconGear />}
                className={filtrosAtivos ? 'border-brand text-brand' : ''}>
                Colunas
                {filtrosAtivos > 0 && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{filtrosAtivos}</span>}
              </Botao>

              {/* UM reset so'. Eram dois botoes ("↕ Voltar a ordem de trabalho" e "Limpar
                  tudo") desfazendo pedacos diferentes do mesmo estado, e cada um aparecia por
                  um motivo. Aqui ele desfaz ordem E filtros de visualizacao de uma vez — o
                  `title` diz para onde a lista volta, porque "restaurar" sozinho nao diz. */}
              {(ordemManual || filtrosAtivos > 0) && (
                <Botao variante="neutra"
                  onClick={() => { setOrdem({ chave: 'trabalho', dir: 'asc' }); setView(VIEW_PADRAO); setOrigem('') }}
                  title="Volta para a fila de trabalho (respondeu → pronto para enviar → não trabalhado → sem resposta → falta contato) e desfaz os filtros de visualização">
                  Restaurar padrão
                </Botao>
              )}
            </div>
          </div>

          {!leads.length ? (
            // Etapa 3: carteira vazia POR RECORTE DE EQUIPE nao pode parecer defeito nem falta
            // de permissao. O texto vem do modulo puro, que distingue os tres motivos.
            (() => {
              const v = vazioDaCarteira(metaLista?.equipe || null, aba)
              return (
                <div className="text-center py-8">
                  <p className="text-sm text-ink-3">{v.titulo}</p>
                  {v.ajuda && <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">{v.ajuda}</p>}
                </div>
              )
            })()
          ) : totalFiltrado === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              Nenhum lead encontrado com esses filtros. Tente remover algum filtro ou{' '}
              <button
                onClick={() => { setOrigem(''); setView(VIEW_PADRAO) }}
                className="text-brand hover:underline"
              >
                restaurar a visualização padrão
              </button>.
            </p>
          ) : (
          <>
          {/* CELULAR — a fila em cartoes. A tabela nao encolhe bem: sao ate 16 colunas com
              `min-w-max` e nenhuma congelada, entao no telefone ela vira rolagem lateral sem
              fim e o nome do lead sai da tela. */}
          <div className="space-y-3 p-3 md:hidden">
            <ListaCartoesBanco leads={pgLeads.itens} {...propsCartao} />
          </div>

          {/* COMPUTADOR — a tabela continua sendo a forma certa para COMPARAR leads. */}
          <div className="hidden md:block">
          <TabelaBanco
            leads={pgLeads.itens}
            total={totalFiltrado}
            ordem={ordem}
            onOrdenar={(chave) => setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))}
            mostrarRodar={mostrarSelecao}
            cols={view.cols}
            previsoesEnvio={previsoesEnvio}
            selecionados={selecionados}
            onToggleSel={toggleSel}
            onSelecionarPagina={selecionarPaginaAtual}
            onLimparSelecao={limparSelecao}
            idsPagina={idsPaginaAtual()}
            onAbrirFicha={abrirFicha}
            onSalvarEmail={salvarEmail}
            onSalvarTelefone={salvarTelefone}
            onAbrirDetalhes={(l) => abrirFicha(l, 'detalhes')}
            usuarioId={usuario?.id}
            podeAssumir={podeAssumir}
            podeTransferir={podeTransferir}
            onAssumir={assumirLead}
            onDevolver={devolverLead}
          />
          </div>

          {mostrarPaginacao(pgLeads.total, pgLeads.porPagina) && (
            <div className="border-t border-line px-3 py-2">
              <RodapePaginacaoBanco pg={pgLeads} onPagina={setPagina} />
            </div>
          )}
          </>
          )}

          {/* Filtros rápidos: atalhos para os recortes mais usados do modal "Colunas".
              Ficam no rodape da lista para nao disputar espaco com o recorte de carteira. */}
          <div className="hidden flex-wrap gap-1.5 border-t border-line bg-surface-2 px-3 py-2 md:flex" role="group" aria-label="Filtros rápidos">
            {chipsRapidos}
          </div>
        </section>
      )}
      </>
      )}

      {/* O QUADRO DO DIA. Ele NÃO faz uma segunda listagem: recebe a carteira que a Lista já
          carregou (na ordem de trabalho do servidor) e guarda o planejamento no banco. Abrir um
          card usa a MESMA ficha da Lista. */}
      {vista === 'quadro' && (
        <QuadroDoDia
          empresaId={empresaId}
          candidatos={leads}
          onAbrirLead={abrirLeadPorId}
        />
      )}

      {/* Irmão do painel de seleção, nunca filho de outro modal: confirma antes de disparar
          várias chamadas (algumas com IA) quando a seleção passa de um lote (MAX_LOTE). */}
      {confirmarLoteGrande && (
        <ModalConfirmar
          titulo="Gerar mensagens em massa"
          corpo={`${selecionados.size} lead(s) selecionado(s) — o sistema vai preparar as mensagens em ${Math.ceil(selecionados.size / MAX_LOTE)} lote(s) de até ${MAX_LOTE}. Nada é enviado nesta etapa.`}
          aviso="Pode levar alguns minutos quando a geração por IA está ligada. Continue nesta tela até terminar."
          rotuloConfirmar="Gerar mensagens"
          ocupado={gerandoLote}
          onConfirmar={() => { setConfirmarLoteGrande(false); gerarSelecionadosEmMassa() }}
          onCancelar={() => setConfirmarLoteGrande(false)}
        />
      )}

      {/* A FICHA DO LEAD — uma superfície, quatro seções. Eram dois modais para o mesmo lead
          (conversa e detalhes/ICP), cada um com o seu resumo no topo e cada um custando a
          posição na lista ao ser trocado pelo outro. Ver o cabeçalho de `FichaLead.tsx`. */}
      {ficha && leadDaFicha && (
        <FichaLead
          lead={leadDaFicha}
          conversa={{
            numero: ficha.numero,
            titulo: ficha.titulo,
            leadId: ficha.leadId,
            mensagemGerada: ficha.mensagemGerada,
            rodavel: ficha.rodavel,
            status: ficha.status,
            acessos: ficha.acessos,
          }}
          secao={ficha.secao}
          onTrocarSecao={(secao) => setFicha((c) => (c ? { ...c, secao } : c))}
          onFechar={() => setFicha(null)}
          empresaId={empresaId}
          onLeadAtualizado={(lead) => aplicarLeadAtualizado(lead as Lead)}
          podeEditarIcp={podeTriarLead}
          instanciaDesconectada={statusConexao?.connected === false}
          acaoPrincipal={acaoDaFicha}
          onAcaoPrincipal={acaoDaFicha && acaoDaFicha.chave !== 'travado' ? () => setFicha((c) => (c ? { ...c, secao: 'conversa' } : c)) : undefined}
          mensagemGerada={ficha.mensagemGerada}
          podeEnviar={podeEnviarConversa}
          podeGerar={podeGerarConversa}
          motivoEnvioIndisponivel={config.modo === 'automatico'
            ? 'No modo Automático, o envio é controlado pela rotina configurada.'
            : motivoBloqueioConexao}
          cooldownS={cooldownS}
          enviando={enviandoConversa}
          gerando={gerandoConversa}
          podeTriarLead={podeTriarLead}
          onEnviar={enviarLeadConversa}
          onGerar={gerarMensagemConversa}
          onAlterarStatus={alterarStatusConversa}
          onSalvarTelefone={(telefone) => salvarTelefone(ficha.leadId, telefone)}
          resumoExtra={resumoDaFicha}
        />
      )}

      {persAberto && (
        <PersonalizarModal
          view={view}
          onPatch={patchView}
          origem={origem}
          onOrigemChange={setOrigem}
          onReset={() => { setOrigem(''); setView(VIEW_PADRAO) }}
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

      {/* A confirmação da limpeza. O texto é o do módulo puro: ele diz o que o backend REALMENTE
          apaga (leads sem e-mail e sem telefone), e não o que a tela poderia sugerir. */}
      {confirmarLimpeza && (
        <ModalConfirmar
          titulo={LIMPEZA.titulo}
          corpo={LIMPEZA.corpo}
          aviso={LIMPEZA.aviso}
          rotuloConfirmar={LIMPEZA.rotuloConfirmar}
          tom="perigo"
          ocupado={limpando}
          onConfirmar={limpar}
          onCancelar={() => setConfirmarLimpeza(false)}
        />
      )}

      {exportOpen && (
        <ExportarCsvModal
          aba={ABAS.find((a) => a.valor === aba)?.label || ''}
          totalFiltrado={totalFiltrado}
          filtrosAtivos={!!origem || filtrosDeCarteira > 0 || !!busca.trim()}
          exportando={exportando}
          onExportar={exportar}
          onClose={() => setExportOpen(false)}
        />
      )}

      {ajudaOpen && (
        <ComoFuncionaModal modos={modosDisponiveis} onClose={() => setAjudaOpen(false)} />
      )}
    </div>
  )
}

// ─── Cabeçalho: cartões do funil, cartões de modo e o menu de ações secundárias ──

/**
 * Um estágio do funil. Continua sendo o seletor de aba — por isso `aria-pressed`, e não um
 * cartão decorativo. A seleção NÃO é dita só pela cor: o cartão ativo declara "em exibição".
 */
function AbaFunil({ cartao, ativo, onEscolher }: {
  cartao: { valor: string; label: string; total: number | null; percentual: number | null; tom: string }
  ativo: boolean
  onEscolher: () => void
}) {
  const detalhe = cartao.percentual === null
    ? `${cartao.label}: contagem ainda nao carregada`
    : `${cartao.label}: ${cartao.total} lead(s), ${cartao.percentual}% da carteira nas abas`
  return (
    <button type="button" onClick={onEscolher} aria-pressed={ativo} title={detalhe}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
        ativo ? 'border-brand bg-brand/5 font-semibold text-brand' : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
      }`}>
      <span className="whitespace-nowrap">{cartao.label}</span>
      {/* A contagem nunca some: ela e' o que faz o seletor valer mais que uma aba. `—` quando
          ninguem contou ainda — "0" afirmaria que o estagio esta vazio. */}
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        ativo ? 'bg-brand text-white' : 'bg-surface-3 text-ink-3'
      }`}>
        {cartao.total === null ? '—' : cartao.total}
      </span>
    </button>
  )
}

/**
 * FAIXA DE ENVIO — a linha que substitui o painel permanente de disparo na primeira dobra.
 *
 * O que ela carrega e' o que o operador precisa saber SEM abrir nada: em que modo esta, por
 * qual numero, se o WhatsApp esta conectado e se o envio esta liberado. O que ela esconde e'
 * ajuste (janela, intervalo, escolha do modo) — e nada que bloqueie o envio.
 *
 * O estado NUNCA e' so' cor: o rotulo em texto ("Envio bloqueado", "Próximo envio em 04:12")
 * vem junto da bolinha, e o motivo fica ao lado, nao atras de um hover.
 */
function FaixaEnvio({ faixa, aberto, onAlternar, onTestar, podeTestar, saudacaoFaltando }: {
  faixa: { estado: string; rotulo: string; detalhe: string; tom: string; resumo: string[] }
  aberto: boolean
  onAlternar: () => void
  onTestar: () => void
  podeTestar: boolean
  saudacaoFaltando: boolean
}) {
  const bolinha = faixa.tom === 'danger' ? 'bg-estado-danger'
    : faixa.tom === 'warn' ? 'bg-estado-warn'
    : faixa.tom === 'neutro' ? 'bg-line-strong'
    : 'bg-estado-ok'
  const texto = faixa.tom === 'danger' ? 'text-red-700'
    : faixa.tom === 'warn' ? 'text-amber-700'
    : faixa.tom === 'neutro' ? 'text-ink-2'
    : 'text-emerald-700'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bolinha}`} aria-hidden="true" />
        <span className={`text-sm font-semibold ${texto}`}>{faixa.rotulo}</span>
      </span>
      {/* Bloqueio NAO trunca e NAO depende de hover: ele diz o que impede o envio e o que
          fazer. Truncar aqui devolveria o defeito que esta faixa existe para corrigir. */}
      <span className={faixa.tom === 'danger'
        ? 'order-last min-w-0 basis-full text-xs text-red-700 sm:order-none sm:basis-auto sm:flex-1'
        : 'min-w-0 flex-1 truncate text-xs text-ink-3'} title={faixa.detalhe}>{faixa.detalhe}</span>
      {/* O que esta configurado, em texto curto: e' o que permite o painel ficar fechado. */}
      {faixa.resumo.length > 0 && (
        <span className="hidden min-w-0 shrink-0 items-center gap-1.5 text-xs text-ink-3 lg:flex">
          {faixa.resumo.map((r, i) => (
            <span key={r + i} className="max-w-[160px] truncate rounded-md bg-surface-3 px-1.5 py-0.5">{r}</span>
          ))}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={onTestar} disabled={!podeTestar}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 ${
            saudacaoFaltando ? 'border-estado-danger text-red-600 hover:bg-red-50' : 'border-line hover:bg-surface-2'
          }`}
          title={saudacaoFaltando
            ? 'Configure a saudação (mensagem-base) desta instância antes de disparar'
            : 'Envia uma mensagem de teste pro seu número e ajusta a saudação/IA'}>
          <IconFlask /> <span className="hidden sm:inline">Testar envio</span>
        </button>
        <button type="button" onClick={onAlternar} aria-expanded={aberto}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <IconGear /> <span className="hidden sm:inline">Configurar envio</span>
          <IconChevron className={`h-3.5 w-3.5 transition ${aberto ? 'rotate-180' : ''}`} />
        </button>
      </span>
    </div>
  )
}

/** Um modo de disparo. `radio` de verdade: setas do teclado e leitor de tela funcionam. */
function CartaoModo({ modo, ativo, onEscolher }: {
  modo: { valor: string; label: string; resumo: string }
  ativo: boolean
  onEscolher: () => void
}) {
  return (
    <button type="button" role="radio" aria-checked={ativo} onClick={onEscolher}
      className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
        ativo ? 'border-brand bg-brand/5' : 'border-line bg-surface hover:bg-surface-2'
      }`}>
      {/* A marca de seleção é forma + cor, nunca só cor. */}
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        ativo ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface'
      }`} aria-hidden="true">
        {ativo && <IconCheck className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold ${ativo ? 'text-brand' : 'text-ink'}`}>{modo.label}</span>
        <span className="block text-[11px] leading-snug text-ink-3">{modo.resumo}</span>
      </span>
    </button>
  )
}

/**
 * Menu das ações secundárias do cabeçalho. Abre por CLIQUE (não por hover): no toque não existe
 * hover, e uma ação que apaga dado não pode depender de um gesto que metade dos aparelhos não
 * tem. Fecha em Escape, clique fora e rolagem — a âncora se moveria.
 *
 * Lista vazia não renderiza nada; UM item vira botão comum, porque menu de uma opção é fricção
 * pura (mesma decisão do `MenuRadialAcoes` de Follow-ups).
 */
function MenuMaisAcoes({ itens, ocupado, onEscolher }: {
  itens: { chave: 'exportar' | 'limpar'; rotulo: string; tom: 'neutro' | 'perigo' }[]
  ocupado: boolean
  onEscolher: (chave: 'exportar' | 'limpar') => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const aoClicar = (e: globalThis.MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    const aoRolar = () => setAberto(false)
    document.addEventListener('mousedown', aoClicar)
    document.addEventListener('keydown', aoTeclar)
    window.addEventListener('scroll', aoRolar, true)
    window.addEventListener('resize', aoRolar)
    return () => {
      document.removeEventListener('mousedown', aoClicar)
      document.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('scroll', aoRolar, true)
      window.removeEventListener('resize', aoRolar)
    }
  }, [aberto])

  if (!itens.length) return null
  if (itens.length === 1) {
    const unico = itens[0]
    return (
      <Botao variante={unico.tom === 'perigo' ? 'perigosa' : 'secundaria'} carregando={ocupado}
        onClick={() => onEscolher(unico.chave)}
        iconeInicio={unico.chave === 'limpar' ? <IconBroom /> : <IconDownload />}
        className="min-h-11 sm:min-h-0">
        {unico.rotulo}
      </Botao>
    )
  }

  return (
    <div className="relative" ref={caixa}>
      <Botao variante="secundaria" carregando={ocupado} onClick={() => setAberto((a) => !a)}
        aria-haspopup="menu" aria-expanded={aberto} className="min-h-11 sm:min-h-0">
        Mais ações <IconChevron className={`h-3.5 w-3.5 transition ${aberto ? 'rotate-180' : ''}`} />
      </Botao>
      {aberto && (
        <div role="menu" aria-label="Mais ações"
          className="absolute right-0 z-30 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl">
          {itens.map((i) => (
            <button key={i.chave} type="button" role="menuitem"
              onClick={() => { setAberto(false); onEscolher(i.chave) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 ${
                i.tom === 'perigo' ? 'text-estado-danger' : 'text-ink-2'
              }`}>
              {i.chave === 'limpar' ? <IconBroom /> : <IconDownload />}
              {i.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal Exportar CSV — escolhe COLUNAS, nunca quais leads ───────────────────
/**
 * O escopo é declarado, não escolhido: o arquivo sai com o conjunto FILTRADO, que é o que o
 * servidor sabe montar. "Selecionados" e "página atual" exigiriam o endpoint aceitar lista de
 * ids — oferecer as opções aqui entregaria um arquivo diferente do pedido.
 */
function ExportarCsvModal({ aba, totalFiltrado, filtrosAtivos, exportando, onExportar, onClose }: {
  aba: string
  totalFiltrado: number
  filtrosAtivos: boolean
  exportando: boolean
  onExportar: (colunas: string[], nomeArquivo: string) => Promise<void>
  onClose: () => void
}) {
  const [colunas, setColunas] = useState<string[]>(COLUNAS_CSV_PADRAO)
  const [nome, setNome] = useState('')
  const pedido = validarExportacao({ colunas, nomeArquivo: nome })
  const alternar = (chave: string) => setColunas((c) => (
    c.includes(chave) ? c.filter((x) => x !== chave) : [...c, chave]))

  return (
    <FolhaModal
      aberto
      titulo="Exportar CSV"
      descricao="Escolha as colunas do arquivo. Os leads exportados são os do recorte atual."
      onFechar={onClose}
      tamanho="md"
      rodape={
        <>
          <Botao variante="neutra" onClick={onClose} className="min-h-11 sm:min-h-0">Cancelar</Botao>
          <Botao variante="primaria" carregando={exportando}
            motivoDesabilitado={pedido.ok ? '' : pedido.motivo}
            disabled={!pedido.ok}
            onClick={() => onExportar(colunas, nome)}
            iconeInicio={<IconDownload />} className="min-h-11 flex-1 sm:min-h-0 sm:flex-none">
            Exportar CSV
          </Botao>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-2">
          <p className="font-medium text-ink">O que vai no arquivo</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            <span className="tabular-nums">{totalFiltrado}</span> lead{totalFiltrado === 1 ? '' : 's'} do
            estágio <b className="text-ink-2">{aba}</b>
            {filtrosAtivos ? ', com os filtros que estão aplicados agora.' : ' (sem filtro de carteira aplicado).'}
            {' '}A seleção da tabela não muda este recorte.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Colunas</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setColunas(COLUNAS_CSV_PADRAO)}
                className="text-xs text-brand hover:underline">Todas</button>
              <button type="button" onClick={() => setColunas([])}
                className="text-xs text-brand hover:underline">Nenhuma</button>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {COLUNAS_CSV.map((c) => (
              <label key={c.chave}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-sm text-ink-2 hover:bg-surface-2">
                <input type="checkbox" checked={colunas.includes(c.chave)} onChange={() => alternar(c.chave)} />
                {c.rotulo}
              </label>
            ))}
          </div>
          {!pedido.ok && <p className="mt-2 text-xs text-estado-danger">{pedido.motivo}</p>}
        </div>

        <div>
          <label htmlFor="csv-nome" className="mb-1 block text-xs text-ink-3">Nome do arquivo</label>
          <input id="csv-nome" value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder={`banco-leads-${new Date().toISOString().slice(0, 10)}.csv`}
            className={classesEntrada({ extra: 'min-h-11 sm:min-h-0' })} />
          <p className="mt-1 text-xs text-ink-3">Deixe em branco para usar o nome padrão.</p>
        </div>
      </div>
    </FolhaModal>
  )
}

// ─── Modal "Como funciona?" ────────────────────────────────────────────────────
/** Explica o que a tela decide. Texto curto e orientado à ação — não é manual da interface. */
function ComoFuncionaModal({ modos, onClose }: {
  modos: { valor: string; label: string; resumo: string; hint: string }[]
  onClose: () => void
}) {
  return (
    <FolhaModal aberto titulo="Como funciona o Banco de Leads"
      descricao="A carteira inteira num lugar só: encontrar o lead, decidir a abordagem e disparar."
      onFechar={onClose} tamanho="md"
      rodape={<Botao variante="primaria" onClick={onClose} className="min-h-11 flex-1 sm:min-h-0 sm:flex-none">Entendi</Botao>}
    >
      <div className="space-y-5 text-sm text-ink-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Os três modos de disparo</p>
          <ul className="space-y-2">
            {modos.map((m) => (
              <li key={m.valor} className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="font-semibold text-ink">{m.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{m.hint}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">O caminho de sempre</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-ink-3">
            <li>Escolha o estágio do funil nos cartões do topo.</li>
            <li>Recorte a carteira nos filtros (origem, nicho, cidade, responsável).</li>
            <li>Abra o lead pelo nome para ver conversa, pontuação e evidências.</li>
            <li>Dispare a saudação — pelo botão do lead, ou em massa no modo Manual.</li>
          </ol>
        </div>
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-3">
          A ordem da lista já vem pronta do sistema (a fila de trabalho: quem respondeu primeiro,
          depois quem tem mensagem pronta, depois quem nunca foi abordado). Clicar num cabeçalho
          ou escolher outra ordenação sobrescreve a fila — e o aviso “Voltar à ordem de trabalho”
          aparece para desfazer.
        </p>
      </div>
    </FolhaModal>
  )
}

// ─── Tabelas por origem (mesmo layout da Aquisição) ────────────────────────────
type TabelaProps = {
  leads: Lead[]
  // Total do conjunto filtrado (antes da paginação) — `leads` aqui é só a página visível.
  // Opcional para não quebrar quem ainda não passa: cai para `leads.length`.
  total?: number
  ordem: Ordem
  onOrdenar: (chave: string) => void
  mostrarRodar: boolean
  cols: Record<string, boolean>
  previsoesEnvio: Map<string, PrevisaoEnvio>
  selecionados: Set<string>
  onToggleSel: (id: string) => void
  // Selecao da PAGINA, pelo checkbox do cabecalho. Opcionais porque a tabela continua
  // renderizavel sem selecao (abas que nao permitem disparo).
  idsPagina?: string[]
  onSelecionarPagina?: () => void
  onLimparSelecao?: () => void
  onAbrirFicha: (l: Lead, gatilho: string) => void
  onSalvarEmail: (id: string, email: string) => Promise<void>
  onSalvarTelefone: (id: string, telefone: string) => Promise<void>
  onAbrirDetalhes: (l: Lead) => void
  // CRM em equipe (responsável/carteira). Tudo opcional: as tabelas que ainda não passam continuam
  // funcionando, só sem as colunas novas.
  usuarioId?: string | null
  podeAssumir?: boolean
  podeTransferir?: boolean
  onAssumir?: (l: Lead) => void
  onDevolver?: (l: Lead) => void
}

// Rodapé "Anterior/Próxima" com o resumo do intervalo — mesmo padrão visual já validado em
// Follow-ups (`RodapeFila`), sobre o recorte PURO de `lib/paginacao.js`. Compartilhado pelas
// duas tabelas (Places/Instagram): cada uma tem sua própria página, mas o rodapé é o mesmo.
function RodapePaginacaoBanco({ pg, onPagina }: { pg: PaginaLista<Lead>; onPagina: (p: number) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-surface px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-ink-3" aria-live="polite">
        <span className="tabular-nums">{resumoIntervalo(pg)}</span>
      </p>
      {(pg.temAnterior || pg.temProxima) && (
        <div className="flex items-center gap-1 self-end sm:self-auto">
          <button type="button" onClick={() => onPagina(pg.pagina - 1)} disabled={!pg.temAnterior}
            aria-label="Página anterior"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent">
            ◀ <span className="hidden sm:inline">Anterior</span>
          </button>
          <span className="px-1 text-xs text-ink-3">
            Página <b className="tabular-nums text-slate-700">{pg.pagina}</b> de <span className="tabular-nums">{pg.totalPaginas}</span>
          </span>
          <button type="button" onClick={() => onPagina(pg.pagina + 1)} disabled={!pg.temProxima}
            aria-label="Próxima página"
            className="min-h-[36px] rounded-lg border px-3 py-1 text-xs hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30 disabled:hover:bg-transparent">
            <span className="hidden sm:inline">Próxima</span> ▶
          </button>
        </div>
      )}
    </div>
  )
}

// Célula de status compartilhada: o selo principal é o STATUS DO LEAD (o que foi marcado na
// conversa); a faixa de trabalho aparece só como apoio para explicar por que a fila ordenou assim.
function StatusCelula({ l }: { l: Lead }) {
  const locked = isLocked(l)
  const status = statusOperacionalDoLead(l)
  const faixa = seloFaixa(l.faixa_trabalho)
  return (
    <td className="px-3 py-2">
      <div
        className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.classe}`}
        title={status.detalhe}>
        {status.rotulo}
      </div>
      {faixa && (
        <div className="mt-0.5 text-[11px] text-ink-3" title={faixa.dica}>
          Fila: {faixa.rotulo}
        </div>
      )}
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
      : { titulo: 'Sem previsão', detalhe: motivoDescarte(l) || statusOperacionalDoLead(l).rotulo || l.status, tom: 'neutro' }
  )
  const cls = {
    auto: 'bg-sky-50 text-sky-700 border-sky-200',
    pronto: 'bg-amber-50 text-amber-700 border-amber-200',
    enviado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    erro: 'bg-red-50 text-red-700 border-red-200',
    neutro: 'bg-surface-2 text-ink-2 border-line',
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

// Coluna Telefone: número CLICÁVEL que abre DIRETO o WhatsApp (wa.me), levando a mensagem
// já gerada como rascunho quando ela existe — é o que o antigo botão verde ao lado fazia.
// O botão saiu: número e botão levavam ao mesmo lugar, e a linha ficava com duas ações
// coladas para o mesmo destino. O histórico/conversa do lead abre pelo NOME.
// Indicadores discretos seguem aqui: ícone de envelope = mensagem aguardando envio;
// selo verde = WhatsApp verificado; aviso = sem conta WhatsApp (disparo não chegou).
function TelefoneCelula({ l, onSalvarTelefone }: { l: Lead; onSalvarTelefone: (id: string, telefone: string) => Promise<void> }) {
  const msgPronta = !!l.mensagem_gerada
  const digitos = String(l.telefone || '').replace(/\D/g, '')
  const textoWa = String(l.mensagem_gerada || '').trim()
  const waHref = digitos
    ? `https://wa.me/${digitos.startsWith('55') ? digitos : `55${digitos}`}${textoWa ? `?text=${encodeURIComponent(textoWa)}` : ''}`
    : ''
  return (
    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
      {l.telefone ? (
        <span className="inline-flex items-center gap-1">
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`group -mx-1 inline-flex flex-col items-start rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${msgPronta ? 'text-amber-700 font-semibold' : 'text-emerald-700'}`}
              title={textoWa ? 'Abrir no WhatsApp com a mensagem pronta' : 'Abrir no WhatsApp'}
              aria-label={`Abrir ${l.telefone} no WhatsApp${textoWa ? ' com a mensagem pronta' : ''}`}
            >
              <span className="inline-flex items-center gap-1">
                <IconeWhatsapp className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="underline decoration-current underline-offset-2 group-hover:decoration-2">{l.telefone}</span>
                {msgPronta && <IconSend className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />}
              </span>
              <span className="font-sans text-[10px] font-medium leading-3 text-ink-3 group-hover:text-emerald-700">
                {textoWa ? 'Abrir no WhatsApp com a mensagem →' : 'Abrir no WhatsApp →'}
              </span>
            </a>
          ) : (
            <span className="text-ink-2">{l.telefone}</span>
          )}
          {l.tem_whatsapp === true && (
            <span className="h-2 w-2 rounded-full bg-emerald-500" title="WhatsApp verificado" />
          )}
          {l.tem_whatsapp === false && (
            <span className="text-[10px] text-slate-400 whitespace-nowrap" title="Disparo não chegou — número sem conta WhatsApp">sem WhatsApp</span>
          )}
          {/* CORRIGIR o número não mora aqui: a linha já está no limite de espaço e corrigir
              telefone é raro perto de abrir o WhatsApp. A edição vive no cabeçalho do modal da
              conversa, onde o número é clicável. O que fica na coluna é a ADIÇÃO (abaixo), que
              é trabalho que o lead sem telefone exige para entrar na fila. */}
        </span>
      ) : (
        /* Sem telefone o lead não entra na fila de abordagem — o "+ telefone" é o trabalho que
           cabe nele, e é por isso que ele deixou de disputar o topo da lista com quem já pode
           ser abordado (faixa "Falta contato"). */
        <ContatoEditavel
          value={null}
          onSave={(telefone) => onSalvarTelefone(l.id, telefone)}
          rotuloVazio="+ telefone"
          placeholder="DDD + número"
          tipo="tel"
          titulo="Adicionar o telefone deste lead"
          largura="w-36"
        />
      )}
    </td>
  )
}


// ─── CRM em equipe: qualificação e responsável ──────────────────────────────────────────────

/**
 * RESPONSÁVEL (Etapa 4) + as ações que cabem a quem está olhando.
 *
 * "Livre" não é pendência: é a fila de onde qualquer vendedor pode puxar. Quando o botão
 * "Assumir" não aparece, o MOTIVO aparece no lugar — botão sumido sem explicação é o que faz o
 * operador achar que a tela quebrou.
 */
function ResponsavelCelula({ l, usuarioId, podeAssumir, podeTransferir, onAssumir, onDevolver }: {
  l: Lead; usuarioId?: string | null; podeAssumir?: boolean; podeTransferir?: boolean
  onAssumir?: (l: Lead) => void; onDevolver?: (l: Lead) => void
}) {
  const dono = donoDoLead(l, usuarioId)
  const acoes = acoesDeResponsavel(l, { usuarioId, podeAssumir, podeTransferir })
  return (
    <td className="px-3 py-2">
      <div className="flex flex-col gap-0.5">
        {acoes.assumir && onAssumir && (
          <button onClick={() => onAssumir(l)}
            className="self-start rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition hover:border-brand/30 hover:bg-brand/10 hover:text-brand"
            title="Lead livre: clique para assumir agora">
            Livre · assumir
          </button>
        )}
        {!acoes.assumir && (
          <span className={dono.meu ? 'text-[12px] font-medium text-brand' : 'text-[12px] text-ink-2'}>
            {dono.rotulo}
          </span>
        )}
        {acoes.devolver && onDevolver && (
          <button onClick={() => onDevolver(l)}
            className="self-start text-[11px] text-ink-3 underline-offset-2 hover:underline"
            title="Devolve o lead para a fila de livres">
            Devolver
          </button>
        )}
        {!acoes.assumir && !acoes.devolver && acoes.motivoSemAssumir && (
          <span className="text-[10px] text-slate-400">{acoes.motivoSemAssumir}</span>
        )}
      </div>
    </td>
  )
}

// ICP enxuto na tabela. Cadastro/coleta continua existindo como evidencia do ICP, mas agora
// mora no drawer "Detalhes" para nao criar duas leituras concorrentes na linha.
function CadastroDetalhesCelula({ l, onAbrirDetalhes }: {
  l: Lead; onAbrirDetalhes: (l: Lead) => void
}) {
  const resumo = resumoIcpOperacional(l)
  const selo = seloIcp(resumo.faixa, resumo.score)
  const qualificacao = qualificacaoDoLead(l)
  const validacao = seloValidacaoLead(qualificacao.validacao)
  const maximo = maximoDoLead(l)
  const cadastro = leituraCadastro(l.score_cadastro, maximo, criteriosDoLead(l))
  const alertas = [...(qualificacao.bloqueios || []), ...(qualificacao.penalidades || []), ...(qualificacao.revisoes || [])]
    .slice(0, 2).map((a: { rotulo: string }) => a.rotulo).join(' · ')
  const title = `${resumo.origem === 'previsao' ? 'Prévia automática' : 'ICP salvo'} — ${selo.rotulo}: ${selo.descricao}${selo.score != null ? ` (${selo.score}/13)` : ''}. Régua operacional: ${qualificacao.score_100}/100 — ${validacao.rotulo}. Cadastro/coleta: ${typeof l.score_cadastro === 'number' ? `${l.score_cadastro}/${maximo}` : 'sem score'} — ${cadastro.titulo}.${alertas ? ` Alertas: ${alertas}.` : ''}`
  return (
    <td className="px-3 py-2 text-center">
      <div className="flex min-w-[62px] flex-col items-center gap-1" title={title}>
        <BolinhaIcp l={l} />
        <button onClick={() => onAbrirDetalhes(l)}
          className="text-[11px] font-medium text-ink-3 underline-offset-2 hover:text-brand hover:underline"
          aria-label={`Abrir detalhes de ICP e cadastro de ${l.nome || 'lead'}`}
          title="ICP, cadastro como evidência, endereço, nota, avaliações, horário, links e dados completos do lead">
          Detalhes
        </button>
      </div>
    </td>
  )
}

function QualidadeIcpCelula({ l }: { l: Lead }) {
  const resumo = resumoIcpOperacional(l)
  const selo = seloIcp(resumo.faixa, resumo.score)
  const qualificacao = qualificacaoDoLead(l)
  const validacao = seloValidacaoLead(qualificacao.validacao)
  const title = `${resumo.origem === 'previsao' ? 'Prévia automática' : 'ICP salvo'} — ${selo.rotulo}: ${selo.descricao}${selo.score != null ? ` (${selo.score}/13)` : ''}. Régua operacional: ${qualificacao.score_100}/100 — ${validacao.rotulo}.`
  return (
    <td className="px-3 py-2 whitespace-nowrap">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${selo.classe}`} title={title}>
        {selo.rotulo}{selo.score != null ? ` · ${selo.score}/13` : ''}
      </span>
    </td>
  )
}

function classeLinhaQualidadeIcp(l: Lead): string {
  const resumo = resumoIcpOperacional(l)
  const faixa = seloIcp(resumo.faixa, resumo.score).chave
  if (faixa === 'A') return 'bg-orange-50/60 hover:bg-orange-50'
  if (faixa === 'B') return 'bg-amber-50/45 hover:bg-amber-50/80'
  if (faixa === 'C') return 'bg-sky-50/25 hover:bg-sky-50/60'
  return 'hover:bg-surface-2/60'
}

/**
 * COLUNA CONGELADA — o fundo OPACO da célula de identidade.
 *
 * A tinta da linha é semitransparente (`/60`, `/45`, `/25`), o que é certo sobre a página e
 * errado numa célula `sticky`: o conteúdo das outras colunas passaria por baixo e apareceria
 * através dela ao rolar. Aqui a mesma faixa vira a versão opaca.
 */
function fundoCelulaFixa(l: Lead): string {
  const resumo = resumoIcpOperacional(l)
  const faixa = seloIcp(resumo.faixa, resumo.score).chave
  if (faixa === 'A') return 'bg-orange-50'
  if (faixa === 'B') return 'bg-amber-50'
  if (faixa === 'C') return 'bg-sky-50'
  return 'bg-surface'
}

/** Sombra que revela que há mais coluna à direita — sem ela a parada parece corte. */
const CELULA_FIXA = 'sticky left-0 z-10 shadow-[6px_0_8px_-8px_rgb(15_23_42_/_0.35)]'
const CABECALHO_FIXO = 'sticky left-0 z-30 bg-surface-2 shadow-[6px_0_8px_-8px_rgb(15_23_42_/_0.35)]'

function NomeLeadCelula({ l, onAbrirFicha, largura = 'max-w-[220px]', className = '' }: {
  l: Lead
  onAbrirFicha: (l: Lead, gatilho: string) => void
  largura?: string
  /** Layout do chamador (coluna congelada). Aditivo. */
  className?: string
}) {
  return (
    <td className={`px-3 py-2 font-medium ${className}`}>
      <div className="flex min-w-0 flex-col gap-1">
        {/* O NOME abre o RESUMO da ficha — a leitura que decide se vale trabalhar agora.
            A conversa continua a um clique: é a segunda aba, e o botão de ação da linha
            (Enviar / Responder / Revisar) abre direto nela. */}
        <TextoTruncado
          texto={l.nome}
          onClick={() => onAbrirFicha(l, 'nome')}
          dica="Abrir a ficha deste lead"
          className={`${largura} text-ink hover:text-brand hover:underline`}
        />
      </div>
    </td>
  )
}

function SelCelula({ l, selecionados, onToggleSel, className = '' }: { l: Lead; selecionados: Set<string>; onToggleSel: (id: string) => void; className?: string }) {
  return (
    <td className={`px-3 py-2 ${className}`}>
      <input type="checkbox" checked={selecionados.has(l.id)} disabled={!isRodavel(l)}
        onChange={() => onToggleSel(l.id)} aria-label={`Selecionar ${l.nome}`} />
    </td>
  )
}

/**
 * CARTAO DO LEAD — a forma da fila no CELULAR.
 *
 * Por que cartao e nao a tabela encolhida: a tabela tem ate 15 colunas e `min-w-max`, entao no
 * telefone ela vira rolagem horizontal sem fim — e como nenhuma coluna e' congelada, ao chegar
 * em "Responsavel" o operador ja nao sabe de quem e' a linha. Cartao e' o padrao certo quando
 * se le UM registro por vez; a tabela continua sendo a certa para COMPARAR, e por isso ela
 * permanece intacta a partir de `md`.
 *
 * O cartao nao mostra menos informacao por preguica: mostra as que decidem a proxima acao
 * (faixa da fila, nome, mercado, as duas pontuacoes, telefone). O resto continua em "Detalhes",
 * que e' a mesma porta do desktop.
 *
 * ⚠️ Ele NAO reclassifica nada: faixa, ICP, cadastro e elegibilidade vem exatamente das mesmas
 * funcoes que a tabela usa.
 */
function LeadCartao({ l, mostrarRodar, selecionados, onToggleSel, onAbrirFicha, onAbrirDetalhes, envioBloqueado, motivoEnvioBloqueado, usuarioId, podeAssumir, podeTransferir, onAssumir, onDevolver }: {
  l: Lead
  mostrarRodar: boolean
  selecionados: Set<string>
  onToggleSel: (id: string) => void
  onAbrirFicha: (l: Lead, gatilho: string) => void
  onAbrirDetalhes: (l: Lead) => void
  envioBloqueado: boolean
  motivoEnvioBloqueado: string
  usuarioId?: string | null
  podeAssumir?: boolean
  podeTransferir?: boolean
  onAssumir?: (l: Lead) => void
  onDevolver?: (l: Lead) => void
}) {
  const faixa = seloFaixa(l.faixa_trabalho)
  const statusLead = statusOperacionalDoLead(l)
  const resumo = resumoIcpOperacional(l)
  const selo = seloIcp(resumo.faixa, resumo.score)
  const maximo = maximoDoLead(l)
  const cadastro = leituraCadastro(l.score_cadastro, maximo, criteriosDoLead(l))
  const dono = donoDoLead(l, usuarioId)
  const acoesDono = acoesDeResponsavel(l, { usuarioId, podeAssumir, podeTransferir })

  // Os vereditos vem de quem ja os tinha. Recalcula-los aqui criaria uma segunda regra de
  // elegibilidade, mais frouxa que a do backend.
  const acao = acaoPrincipalDoLead({
    temTelefone: Boolean(l.telefone),
    rodavel: isRodavel(l),
    travado: isLocked(l),
    motivoTravado: l.bloqueio_motivo ? (MOTIVO_LABEL[l.bloqueio_motivo] || l.bloqueio_motivo) : '',
    mensagemPronta: Boolean(l.mensagem_gerada),
    respondeu: l.status === 'respondeu',
    erroIa: temErroIa(l),
    envioBloqueado,
    motivoEnvioBloqueado,
  })
  const acaoEDisparo = acao.chave === ACOES.ENVIAR || acao.chave === ACOES.REVISAR
  const descarte = motivoDescarte(l)
  const falha = falhaEnvio(l)

  return (
    <article className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex items-start gap-2.5">
        {mostrarRodar && (
          <input type="checkbox" checked={selecionados.has(l.id)} disabled={!isRodavel(l)}
            onChange={() => onToggleSel(l.id)} aria-label={`Selecionar ${l.nome}`}
            className="mt-1 h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusLead.classe}`} title={statusLead.detalhe}>
            {statusLead.rotulo}
          </span>
          {faixa && <span className="ml-1 align-middle text-[11px] text-ink-3">Fila: {faixa.rotulo}</span>}
          <h3 className="mt-1 truncate text-[15px] font-bold leading-tight text-ink">{l.nome}</h3>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            {[l.nicho, l.cidade].filter(Boolean).join(' · ') || 'Mercado não informado'}
          </p>
        </div>
        <button type="button" onClick={() => onAbrirDetalhes(l)}
          className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          aria-label={`Detalhes de ${l.nome}`} title="ICP, cadastro, endereço, nota, links e dados completos">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      {/* As DUAS pontuacoes lado a lado, cada uma com o que mede escrito em texto. Elas medem
          coisas diferentes e andam em direcoes opostas sobre o mesmo lead — juntar as duas num
          numero so e' o defeito que ja fez o melhor lead da campanha aparecer em vermelho. */}
      <div className="mt-2.5 flex items-center gap-3 rounded-md border border-line bg-surface-2 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BolinhaIcp l={l} />
          <span className="min-w-0 text-[11px] leading-tight text-ink-2">
            Perfil<br />
            <strong className="font-semibold text-ink">{selo.rotulo}{selo.score != null ? ` · ${selo.score}/13` : ''}</strong>
          </span>
        </div>
        <span className="h-7 w-px shrink-0 bg-line" aria-hidden="true" />
        <span className="min-w-0 text-[11px] leading-tight text-ink-2">
          Cadastro<br />
          <strong className="font-semibold text-ink">
            {typeof l.score_cadastro === 'number' ? `${cadastro.titulo} · ${l.score_cadastro}/${maximo}` : 'sem pontuação'}
          </strong>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono text-ink-2">{l.telefone || 'Telefone pendente'}</span>
        {l.tem_whatsapp === true && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Tem WhatsApp</span>
        )}
        {l.tem_whatsapp === false && (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-2">Sem WhatsApp</span>
        )}
        {l.proximo_agendamento && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
            <IconCalendar className="h-3 w-3" /> {fmtDataHora(l.proximo_agendamento)}
          </span>
        )}
      </div>

      {(falha || descarte) && (
        <p className="mt-1.5 text-[11px] font-medium text-estado-danger">
          {falha ? `Falha no envio: ${falha}` : `Descartado: ${descarte}`}
        </p>
      )}
      {acao.chave === ACOES.TRAVADO && (
        <p className="mt-1.5 text-[11px] font-medium text-estado-warn">{acao.dica}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Botao
          variante={acao.variante}
          onClick={() => onAbrirFicha(l, 'acao')}
          motivoDesabilitado={acaoEDisparo ? acao.motivoDesabilitado : ''}
          disabled={acaoEDisparo && Boolean(acao.motivoDesabilitado)}
          title={acao.dica}
          className="min-h-11 flex-1"
        >
          {acao.rotulo}
        </Botao>
        {acoesDono.assumir && onAssumir && (
          <Botao variante="secundaria" onClick={() => onAssumir(l)} className="min-h-11 shrink-0"
            title="Lead livre: clique para assumir agora">
            Assumir
          </Botao>
        )}
        {!acoesDono.assumir && (
          <span className={`shrink-0 text-[11px] ${dono.meu ? 'font-medium text-brand' : 'text-ink-3'}`}>
            {dono.rotulo}
          </span>
        )}
      </div>
      {acoesDono.devolver && onDevolver && (
        <button type="button" onClick={() => onDevolver(l)}
          className="mt-1.5 text-[11px] text-ink-3 underline-offset-2 hover:underline">
          Devolver para a fila
        </button>
      )}
    </article>
  )
}

/** A fila em cartoes — so no celular. A partir de `md` quem manda e' a tabela. */
function ListaCartoesBanco({ leads, ...resto }: {
  leads: Lead[]
  mostrarRodar: boolean
  selecionados: Set<string>
  onToggleSel: (id: string) => void
  onAbrirFicha: (l: Lead, gatilho: string) => void
  onAbrirDetalhes: (l: Lead) => void
  envioBloqueado: boolean
  motivoEnvioBloqueado: string
  usuarioId?: string | null
  podeAssumir?: boolean
  podeTransferir?: boolean
  onAssumir?: (l: Lead) => void
  onDevolver?: (l: Lead) => void
}) {
  if (!leads.length) return null
  // Sem titulo de fonte: a origem vive DENTRO do cartao, como vive dentro da linha da tabela.
  // Agrupar por fonte aqui quebraria a ordem de trabalho exatamente como quebrava no computador.
  return (
    <section aria-label="Leads" className="space-y-2">
      {leads.map((l) => <LeadCartao key={l.id} l={l} {...resto} />)}
    </section>
  )
}

/**
 * Cabecalho de selecao da pagina. Substitui os botoes soltos "Selecionar pagina atual" /
 * "Selecionar todos os filtrados" que viviam num bloco permanente acima da lista (padrao de
 * data table: a selecao mora na tabela, nao num painel a parte).
 *
 * O estado INDETERMINADO existe porque "parte da pagina marcada" e' diferente de "nenhum
 * marcado": sem ele, o operador que marcou 3 de 25 ve a caixa vazia e o clique seguinte marca
 * tudo sem aviso.
 */
function CheckboxPagina({ idsPagina, selecionados, onSelecionarPagina, onLimparSelecao }: {
  idsPagina: string[]
  selecionados: Set<string>
  onSelecionarPagina: () => void
  onLimparSelecao: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const marcados = idsPagina.filter((id) => selecionados.has(id)).length
  const todos = idsPagina.length > 0 && marcados === idsPagina.length
  const parcial = marcados > 0 && !todos
  useEffect(() => { if (ref.current) ref.current.indeterminate = parcial }, [parcial])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todos}
      disabled={!idsPagina.length}
      onChange={() => (todos || parcial ? onLimparSelecao() : onSelecionarPagina())}
      className="h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={todos || parcial
        ? `Limpar seleção (${marcados} de ${idsPagina.length} nesta página)`
        : `Selecionar os ${idsPagina.length} leads desta página`}
      title={todos || parcial ? 'Limpar seleção' : 'Selecionar esta página'}
    />
  )
}

/**
 * A ORIGEM na linha. Texto + pilula neutra, nunca so' cor. Ela abre as evidencias daquela fonte
 * na ficha; o filtro por fonte vive no modal "Colunas".
 *
 * O rotulo vem de `lib/lead-origem.js`, por lista fechada. Antes a fonte nao era um dado da
 * linha: ela era o TITULO da tabela em que a linha tinha caido, e o "resto" (tudo que nao fosse
 * Google Places) caia sob o titulo "Instagram" — entao lead de anuncio da Meta era apresentado
 * ao operador como lead de Instagram.
 */
function OrigemCelula({ l, onAbrirFicha }: {
  l: Lead
  onAbrirFicha: (l: Lead, gatilho: string) => void
}) {
  const o = celulaOrigem(l)
  return (
    <td className="px-3 py-2 align-top">
      <button
        type="button"
        onClick={() => onAbrirFicha(l, 'origem')}
        className={`${o.classe} max-w-full hover:border-line-strong hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
        title={`${o.rotulo} — ${o.dica} Clique para ver as evidências desta fonte.`}
      >
        <span className="truncate">{o.curto}</span>
      </button>
      {o.detalhe && (
        <p className="mt-0.5 max-w-[140px] truncate text-[11px] text-ink-3" title={o.detalhe}>{o.detalhe}</p>
      )}
    </td>
  )
}

/**
 * A LISTA — uma so'. Eram duas tabelas ("Google Places" x o resto), com paginacao e ordenacao
 * independentes: a fila de trabalho que o servidor calcula e' GLOBAL, e parti-la fazia o 1o lead
 * de cada metade disputar o topo sem nada dizer qual dos dois era o mais urgente.
 *
 * As colunas sao a UNIAO das duas tabelas antigas. Coluna que nao se aplica aquela fonte mostra
 * "—" — e isso e' informacao, nao lacuna: lead de anuncio nao tem nota do Maps porque ele nao
 * veio do Maps. Quem escolhe o que fica visivel continua sendo o "Personalizar colunas".
 */
function TabelaBanco({ leads, total, ordem, onOrdenar, mostrarRodar, cols, previsoesEnvio, selecionados, onToggleSel, idsPagina, onSelecionarPagina, onLimparSelecao, onAbrirFicha, onSalvarEmail, onSalvarTelefone, onAbrirDetalhes, usuarioId, podeAssumir, podeTransferir, onAssumir, onDevolver }: TabelaProps) {
  const n = total ?? leads.length
  return (
    <div className="overflow-hidden bg-surface">
      <DataTableFrame>
        <table className="w-full min-w-max text-sm">
          <caption className="sr-only">{n} lead{n === 1 ? '' : 's'} na ordem de trabalho</caption>
          <thead className="sticky top-0 z-20 bg-surface-2 shadow-[0_1px_0_0_#e2e8f0]">
            <tr>
              {/* IDENTIDADE CONGELADA. "Entrou em" saiu da frente do nome: a coluna fixa tem
                  de ser a que diz DE QUEM é a linha, e ela precisa ser a primeira. */}
              {mostrarRodar && (
                <th className={`w-9 px-3 py-2 ${CABECALHO_FIXO}`}>
                  <CheckboxPagina idsPagina={idsPagina || []} selecionados={selecionados}
                    onSelecionarPagina={onSelecionarPagina || (() => {})}
                    onLimparSelecao={onLimparSelecao || (() => {})} />
                </th>
              )}
              <ThOrdenavel label="Lead" chave="nome" ordem={ordem} onOrdenar={onOrdenar}
                className={`${CABECALHO_FIXO} ${mostrarRodar ? 'left-9' : 'left-0'}`} />
              {/* Origem nao e ordenavel de proposito: ordenar por fonte devolveria a lista
                  agrupada por origem, que e' exatamente a separacao que esta tela deixou de
                  fazer. Quem quer ver uma fonte so' usa o FILTRO de origem. */}
              <th className="px-3 py-2 text-left font-medium text-ink-3">Origem</th>
              {/* ICP fica enxuto; cadastro/evidencias entram em Detalhes. */}
              <ThOrdenavel label="ICP" chave="prioridade" ordem={ordem} onOrdenar={onOrdenar} align="center" />
              {cols.entrou && <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.username && <ThOrdenavel label="@username" chave="username" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.telefone && <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.envio_previsto && <ThOrdenavel label="Envio" chave="envio" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.status && <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.qualidade && <ThOrdenavel label="Qualidade" chave="icp" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.responsavel && <th className="px-3 py-2 text-left font-medium text-ink-3">Responsável</th>}
              {cols.email && <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.nicho && <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.seguidores && <ThOrdenavel label="Seguidores" chave="seguidores" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.endereco && <ThOrdenavel label="Endereço" chave="endereco" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.aval && <ThOrdenavel label="Aval." chave="aval" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.nota && <ThOrdenavel label="Nota" chave="nota" ordem={ordem} onOrdenar={onOrdenar} align="right" />}
              {cols.horario && <ThOrdenavel label="Horário" chave="horario" ordem={ordem} onOrdenar={onOrdenar} />}
              {cols.links && <ThOrdenavel label="Links" chave="links" ordem={ordem} onOrdenar={onOrdenar} />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => {
              const horario = !!l.json_apresentacao?.empresa?.horario_funcionamento
              const handle = String(l.instagram_handle || '').replace(/^@/, '')
              return (
                <tr key={l.id} className={`${classeLinhaQualidadeIcp(l)} align-top`}>
                  {mostrarRodar && <SelCelula l={l} selecionados={selecionados} onToggleSel={onToggleSel} className={`${CELULA_FIXA} ${fundoCelulaFixa(l)}`} />}
                  {/* O NOME abre a conversa do lead. A ficha da fonte não se perdeu:
                      virou acesso rápido no topo do modal e continua em "Detalhes". */}
                  <NomeLeadCelula l={l} onAbrirFicha={onAbrirFicha} largura="max-w-[220px]"
                    className={`${CELULA_FIXA} ${fundoCelulaFixa(l)} ${mostrarRodar ? 'left-9' : 'left-0'}`} />
                  <OrigemCelula l={l} onAbrirFicha={onAbrirFicha} />
                  <CadastroDetalhesCelula l={l} onAbrirDetalhes={onAbrirDetalhes} />
                  {cols.entrou && <td className="px-3 py-2 whitespace-nowrap text-xs text-ink-3">{fmtDataHora(l.created_at)}</td>}
                  {cols.username && (
                    <td className="px-3 py-2 text-xs">
                      {handle
                        ? <a href={`https://instagram.com/${handle}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">@{handle}</a>
                        : '—'}
                    </td>
                  )}
                  {cols.telefone && <TelefoneCelula l={l} onSalvarTelefone={onSalvarTelefone} />}
                  {cols.envio_previsto && <EnvioCelula l={l} previsoesEnvio={previsoesEnvio} />}
                  {cols.status && <StatusCelula l={l} />}
                  {cols.qualidade && <QualidadeIcpCelula l={l} />}
                  {cols.responsavel && (
                    <ResponsavelCelula l={l} usuarioId={usuarioId} podeAssumir={podeAssumir}
                      podeTransferir={podeTransferir} onAssumir={onAssumir} onDevolver={onDevolver} />
                  )}
                  {cols.email && <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => onSalvarEmail(l.id, email)} /></td>}
                  {cols.nicho && (
                    <td className="px-3 py-2 text-xs">
                      <NichoCidade nicho={l.nicho || l.categoria_perfil} cidade={l.cidade} />
                    </td>
                  )}
                  {cols.seguidores && <td className="px-3 py-2 text-right text-xs font-semibold">{l.seguidores != null ? l.seguidores.toLocaleString('pt-BR') : '—'}</td>}
                  {cols.endereco && <td className="px-3 py-2 text-xs text-ink-2 max-w-[180px] truncate" title={l.endereco || ''}>{l.endereco || '—'}</td>}
                  {cols.aval && <td className="px-3 py-2 text-right text-xs">{l.avaliacoes ?? '—'}</td>}
                  {cols.nota && <td className="px-3 py-2 text-right text-xs">{l.rating != null ? Number(l.rating).toFixed(1) : '—'}</td>}
                  {/* Horário só existe na ficha do Maps. Em lead de outra fonte a resposta é
                      "não se aplica", que NÃO é o mesmo que "não tem horário" (❌). */}
                  {cols.horario && (
                    <td className="px-3 py-2 text-center">
                      {celulaOrigem(l).chave === 'places' ? (horario ? '✅' : '❌') : <span className="text-ink-3">—</span>}
                    </td>
                  )}
                  {cols.links && (
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-ink-3 underline mr-2">bio</a>}
                      {l.tem_site && l.site && <a href={l.site} target="_blank" rel="noreferrer" className="text-ink-3 underline mr-2">site</a>}
                      {/* Link que existe mas NÃO é site: aparece pelo que é, nunca como "site". */}
                      {!l.tem_site && l.link_original && l.link_original !== l.link_bio && (
                        <a href={l.link_original} target="_blank" rel="noreferrer" className="text-ink-3 underline"
                          title={`Não é site próprio: ${l.link_original}`}>
                          {rotuloLink(l.classificacao_url) || 'link'}
                        </a>
                      )}
                      {!l.link_bio && !l.site && !l.link_original && '—'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </DataTableFrame>
    </div>
  )
}

// ─── Modal Colunas e filtros (colunas + filtros + ordenação + presets) ──
const PRESETS: { nome: string; dica: string; patch: Partial<ViewConfig>; aba?: string }[] = [
  { nome: 'Alta chance de venda', dica: 'Lead A, com telefone, sem disparo', patch: { icp: 'A', telefone: 'com', disparo: 'nao_disparado', ordenacao: 'icp_desc' } },
  { nome: 'Bom fit sem abordagem', dica: 'Lead A/B ainda não disparado', patch: { disparo: 'nao_disparado', ordenacao: 'icp_desc' }, aba: 'sem_contato' },
  { nome: 'Revisar ICP', dica: 'Leads ainda sem checklist ICP', patch: { icp: 'sem_icp', telefone: 'com' }, aba: 'sem_contato' },
  { nome: 'Sem presença digital', dica: 'Sem site próprio, sem rede social e com telefone', patch: { site: 'sem', social: 'sem', telefone: 'com', disparo: 'nao_disparado' }, aba: 'sem_contato' },
  { nome: 'Só rede social', dica: 'Tem rede social, mas não tem site próprio', patch: { site: 'sem', social: 'com', telefone: 'com', disparo: 'nao_disparado' }, aba: 'sem_contato' },
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
      <label className="block text-[11px] text-ink-3 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
        {opcoes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

function PersonalizarModal({ view, origem, onOrigemChange, onPatch, onReset, onPreset, onClose }: {
  view: ViewConfig
  origem: string
  onOrigemChange: (origem: string) => void
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
      className={`z-50 bg-surface rounded-lg shadow-2xl border flex flex-col max-h-[85vh] w-[640px] max-w-[95vw] ${pos ? '' : 'fixed left-1/2 top-12 -translate-x-1/2'}`}>
        <div onMouseDown={startDrag}
          className="flex items-center justify-between px-5 py-3 border-b cursor-move select-none bg-surface-2 rounded-t-2xl">
          <h3 className="font-semibold text-lg">⠿ Colunas e filtros</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" aria-label="Fechar">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Presets rápidos</p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Ordenação e priorização</p>
            <select value={view.ordenacao} onChange={(e) => onPatch({ ordenacao: e.target.value })}
              className="w-full md:w-2/3 border rounded-lg px-2 py-1.5 text-sm">
              {ORDENACOES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
            </select>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Origem dos leads</p>
            <div className="max-w-xs">
              <SelFiltro
                label="Mostrar"
                value={origem}
                onChange={onOrigemChange}
                opcoes={OPCOES_FILTRO_ORIGEM.map((o) => [o.valor, o.label] as [string, string])}
              />
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Filtros</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <SelFiltro label="Site próprio" value={view.site} onChange={(v) => onPatch({ site: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com site próprio'], ['sem', 'Sem site próprio']]} />
              <SelFiltro label="Rede social" value={view.social} onChange={(v) => onPatch({ social: v as Filtro3 })} opcoes={[['todos', 'Todas'], ['com', 'Com rede social'], ['sem', 'Sem rede social']]} />
              <SelFiltro label="E-mail" value={view.email} onChange={(v) => onPatch({ email: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com e-mail'], ['sem', 'Sem e-mail']]} />
              <SelFiltro label="Telefone" value={view.telefone} onChange={(v) => onPatch({ telefone: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com telefone'], ['sem', 'Sem telefone']]} />
              <SelFiltro label="Envio (WhatsApp)" value={view.envio} onChange={(v) => onPatch({ envio: v as ViewConfig['envio'] })} opcoes={[['todos', 'Todos'], ['possivel', 'Envio possível'], ['impossivel', 'Sem WhatsApp']]} />
              <SelFiltro label="Status do lead" value={view.statusLead} onChange={(v) => onPatch({ statusLead: v })} opcoes={FILTROS_STATUS_LEAD.map((o) => [o.valor, o.label] as [string, string])} />
              <SelFiltro label="Mensagem gerada" value={view.msgGerada} onChange={(v) => onPatch({ msgGerada: v as Filtro3 })} opcoes={[['todos', 'Todos'], ['com', 'Com mensagem'], ['sem', 'Sem mensagem']]} />
              <SelFiltro label="ICP geral" value={view.icp} onChange={(v) => onPatch({ icp: v as ViewConfig['icp'] })} opcoes={[['todos', 'Todos'], ['A', 'Lead A'], ['B', 'Lead B'], ['C', 'Lead C'], ['sem_icp', 'Sem ICP salvo']]} />
              <SelFiltro label="Disparo" value={view.disparo} onChange={(v) => onPatch({ disparo: v as ViewConfig['disparo'] })} opcoes={[['todos', 'Todos'], ['disparado', 'Disparado'], ['nao_disparado', 'Não disparado'], ['falha', 'Falha no envio']]} />
              <SelFiltro label="Agendamento" value={view.agendamento} onChange={(v) => onPatch({ agendamento: v as ViewConfig['agendamento'] })} opcoes={[['todos', 'Todos'], ['com', 'Com agendamento'], ['sem', 'Sem agendamento'], ['hoje', 'Hoje'], ['7dias', 'Próx. 7 dias']]} />
              <div className="col-span-2">
                <label className="block text-[11px] text-ink-3 mb-1">Região (endereço/cidade contém)</label>
                <input value={view.regiao} onChange={(e) => onPatch({ regiao: e.target.value })} placeholder="ex: São Bernardo, Centro" className="w-full border rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div><label className="block text-[11px] text-ink-3 mb-1">Cadastro/coleta ≥</label>{num(view.scoreMin, (s) => onPatch({ scoreMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-ink-3 mb-1">Cadastro/coleta ≤</label>{num(view.scoreMax, (s) => onPatch({ scoreMax: s }), '100')}</div>
              <div />
              <div><label className="block text-[11px] text-ink-3 mb-1">Nota ≥</label>{num(view.notaMin, (s) => onPatch({ notaMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-ink-3 mb-1">Nota ≤</label>{num(view.notaMax, (s) => onPatch({ notaMax: s }), '5')}</div>
              <div />
              <div><label className="block text-[11px] text-ink-3 mb-1">Avaliações ≥</label>{num(view.avalMin, (s) => onPatch({ avalMin: s }), '0')}</div>
              <div><label className="block text-[11px] text-ink-3 mb-1">Avaliações ≤</label>{num(view.avalMax, (s) => onPatch({ avalMax: s }), '∞')}</div>
              <div />
              <div><label className="block text-[11px] text-ink-3 mb-1">Entrou de</label><input type="date" value={view.dataDe} onChange={(e) => onPatch({ dataDe: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-[11px] text-ink-3 mb-1">Entrou até</label><input type="date" value={view.dataAte} onChange={(e) => onPatch({ dataAte: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Colunas visíveis</p>
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
          <button onClick={onReset} className="text-sm text-ink-3 hover:text-slate-800">↺ Restaurar padrão</button>
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
      <div className="bg-surface rounded-lg shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Adicionar cadastro</h3>
            <p className="text-xs text-ink-3 mt-0.5">Cria um lead manualmente no banco. Informe ao menos WhatsApp ou Instagram.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        <div>
          <label className="block text-xs text-ink-3 mb-1">Origem</label>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm">
            {ORIGENS_CADASTRO.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-ink-3 mb-1">Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do lead ou empresa" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-ink-3 mb-1">WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="ex: 5521999998888" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-ink-3 mb-1">Instagram</label>
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
      <div className="bg-surface rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Testar envio — {instancia.nome || instancia.evolution_instance}</h3>
            <p className="text-xs text-ink-3 mt-0.5">Mande uma mensagem de teste pro seu número pra confirmar que a instância envia normalmente.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        {/* Teste de envio — ação principal */}
        <div className="flex items-end gap-2 rounded-lg bg-surface-2 border p-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-3 mb-1">Seu número (teste)</label>
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
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Ajustes de geração</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={gerarIa} onChange={(e) => setGerarIa(e.target.checked)} />
            Gerar a mensagem por IA com análise do lead
          </label>
          <div>
            <label className="block text-xs text-ink-3 mb-1">Instruções extras para a IA (tom, oferta, CTA)</label>
            <textarea value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} rows={3}
              placeholder="Ex.: tom informal, oferta de site profissional, sempre convidar para uma conversa rápida."
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-ink-3 mb-1">Saudação de fallback (usada se a IA falhar ou estiver desligada)</label>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4}
              placeholder="Oi {nome}, tudo bem? Vi a {empresa} aqui em {cidade}…"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">
              Variáveis: <code>{'{nome}'}</code> <code>{'{empresa}'}</code> <code>{'{cidade}'}</code> <code>{'{nicho}'}</code>
            </p>
          </div>
          {preview && (
            <div className="rounded-lg bg-surface-2 border px-3 py-2 text-xs text-ink-2">
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
