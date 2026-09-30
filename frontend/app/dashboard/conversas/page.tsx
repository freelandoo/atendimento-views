'use client'
// Central de Mensagens — LISTA de conversas. O detalhe de uma conversa NAO mora aqui.
//
// O painel de detalhe vivia inline nesta pagina (cabecalho de prioridade comercial, abas
// Conversa/Interesses, feedback por mensagem, compositor do operador, pausar/retomar agente,
// reenviar WhatsApp, deletar historico). Enquanto isso, o "Abrir conversa" da fila de
// Follow-ups abria um modal somente-leitura: mesma conversa, mesmas permissoes, experiencia
// diferente. O painel foi extraido para `components/ConversaPainel.tsx` e as duas telas
// passaram a ser apenas PORTAS DE ENTRADA para ele.
//
// O que sobra aqui: encontrar a conversa (busca, filtros de temperatura, alerta de leads
// esfriando) e remover o contato. A partir do clique em "Histórico", quem manda e o painel.
import { useEffect, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import DataTableFrame from '@/components/ui/DataTableFrame'
import FolhaModal from '@/components/ui/FolhaModal'
import TextoTruncado from '@/components/ui/TextoTruncado'
import { IconTrash, IconGear } from '@/components/ui/icons'
import ConversaPainel, {
  InteresseBadge,
  TempBadge,
  scoreValue,
  type ConversaResumo,
} from '@/components/ConversaPainel'
import FichaLead, { type SecaoFicha } from '@/components/FichaLead'
import { type LeadDetalhavel } from '@/components/LeadDetalhesModal'
import { acessosDoLead } from '@/lib/lead-acessos'
import { cartaoCompromisso, resumoUltimaLigacao, type ProximaAcaoLead } from '@/lib/lead-proxima-acao'
import { identidadeConversa, nomeColunaLead } from '@/lib/lead-identidade'
import {
  opcoesEscopoConversa, avisoDeRecorte, atendenteDaConversa,
} from '@/lib/conversa-operacao'
import { useSession } from '@/lib/useSession'
import { temCapacidade } from '@/lib/capacidades'
import AlternadorModoIa from '@/components/ui/AlternadorModoIa'
import {
  ajudaPadraoGlobal,
  descreverModo,
  houveMudancaDeModo,
  normalizarModo,
  opcoesDeModo,
  rotuloAcessivelPadrao,
} from '@/lib/conversa-modo-ia'
import type { ModoIa } from '@/lib/conversa-modo-ia'

// CRM em equipe, Etapa 7: a conversa passou a ter DONO. Os dois campos chegam prontos do
// backend; a tela só traduz.
type Conversa = ConversaResumo & {
  responsavel_id?: string | null
  responsavel_desde?: string | null
  responsavel_nome?: string | null
  // Casados por telefone com o prospect (quando existe): filtros por nicho/tem-WhatsApp.
  nicho?: string | null
  tem_whatsapp?: boolean | null
  prospect_id?: string | null
}

function fmtData(s?: string): string {
  if (!s) return ''
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

type Faixa = 'quente' | 'morno' | 'frio'

// Classifica a conversa em quente/morno/frio combinando a temperatura comercial do
// perfil com o score de interesse (fallback quando a temperatura ainda não foi definida).
function classificar(c: Conversa): Faixa {
  const t = c.temperatura_lead
  if (t === 'quente' || t === 'morno' || t === 'frio') return t
  const f = c.score_interesse_faixa
  if (f === 'alto') return 'quente'
  if (f === 'medio') return 'morno'
  return 'frio'
}

function normTitulo(s?: string): string {
  return String(s || '').toLowerCase()
}

// "Esfriando": o lead demonstrou calor (temperatura quente, etapa avançada ou sinais
// de compra) mas surgiram sinais de resfriamento (silêncio, adiamento ou recusa).
function esfriando(c: Conversa): boolean {
  const crit = c.score_interesse_criterios || []
  const teveCalor =
    c.temperatura_lead === 'quente' ||
    ['proposta', 'fechamento', 'handoff', 'reuniao_agendada'].includes(c.estagio) ||
    crit.some((x) => x.delta > 0 && /(preco|proximo passo|reuniao|urgencia|etapa comercial avancada)/.test(normTitulo(x.titulo)))
  const esfriou = crit.some((x) => x.delta < 0 && /(sem resposta|postergou|recusou)/.test(normTitulo(x.titulo)))
  return teveCalor && esfriou
}

// Ordenacao rapida (os "filtros rapidos" que o operador clica). Tudo client-side sobre a janela
// carregada — mesmo padrao do "Personalizar" do Banco de Leads.
type Ordem = 'recentes' | 'quentes' | 'interesse' | 'antigos'
const ORDENS: { valor: Ordem; label: string }[] = [
  { valor: 'recentes', label: 'Mais recentes' },
  { valor: 'quentes', label: '🔥 Mais quentes' },
  { valor: 'interesse', label: 'Maior interesse' },
  { valor: 'antigos', label: 'Mais antigos' },
]

type Filtros = {
  interesseMin: '' | 'alto' | 'medio'
  whatsapp: '' | 'sim' | 'nao'
  nicho: string
  status: string
  estagio: string
  instancia: string
  atendente: string // '' | 'nao_atribuida' | <nome do responsavel>
  periodo: '' | 'hoje' | '14d' | 'custom'
  de: string
  ate: string
}
const FILTROS_VAZIOS: Filtros = {
  interesseMin: '', whatsapp: '', nicho: '', status: '', estagio: '',
  instancia: '', atendente: '', periodo: '', de: '', ate: '',
}
const CAMPO_SEL = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand'
const RANK_INTERESSE: Record<string, number> = { alto: 3, medio: 2, baixo: 1 }
const RANK_TEMP: Record<Faixa, number> = { quente: 0, morno: 1, frio: 2 }

function instanciaDe(c: Conversa): string { return c.instancia_nome || c.evolution_instance || '' }

function contarFiltros(f: Filtros): number {
  const chaves: (keyof Filtros)[] = ['interesseMin', 'whatsapp', 'nicho', 'status', 'estagio', 'instancia', 'atendente', 'periodo']
  return chaves.reduce((n, k) => (f[k] ? n + 1 : n), 0)
}

function mesmaData(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dentroPeriodo(c: Conversa, f: Filtros): boolean {
  if (!f.periodo) return true
  if (!c.atualizado_em) return false
  const d = new Date(c.atualizado_em)
  const agora = new Date()
  if (f.periodo === 'hoje') return mesmaData(d, agora)
  if (f.periodo === '14d') return d.getTime() >= agora.getTime() - 14 * 864e5
  if (f.de && d < new Date(f.de + 'T00:00:00')) return false
  if (f.ate && d > new Date(f.ate + 'T23:59:59')) return false
  return true
}

// Bloco "Próxima ação" do Resumo da ficha (paridade com o Banco de Leads). Read-only e COMPACTO:
// reusa o mesmo endpoint e a mesma tradução pura (`cartaoCompromisso`/`resumoUltimaLigacao`). A
// CRIAÇÃO de follow-up/reunião acontece na aba Conversa; aqui só se MOSTRA o que já foi combinado.
function ResumoProximaAcao({ empresaId, leadId, onIrConversa }: {
  empresaId: string; leadId: string; onIrConversa: () => void
}) {
  const [pa, setPa] = useState<ProximaAcaoLead | null>(null)
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando')
  useEffect(() => {
    let vivo = true
    setEstado('carregando')
    apiFetch<ProximaAcaoLead>(`/api/empresas/${empresaId}/banco-leads/leads/${leadId}/proxima-acao`)
      .then((r) => { if (vivo) { setPa(r.data); setEstado('ok') } })
      .catch(() => { if (vivo) setEstado('erro') })
    return () => { vivo = false }
  }, [empresaId, leadId])

  const agora = new Date()
  const cartoes = (pa?.compromissos || []).map((raw) => cartaoCompromisso(raw, agora))
  const [principal, ...outros] = cartoes
  const ligacao = resumoUltimaLigacao(pa?.ultima_ligacao || null, agora)

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Próxima ação</p>
      {estado === 'carregando' ? (
        <p className="mt-1 text-xs text-ink-3">Carregando follow-ups e reuniões…</p>
      ) : estado === 'erro' ? (
        <p className="mt-1 text-xs text-amber-800">Não foi possível carregar follow-ups e reuniões deste lead.</p>
      ) : principal ? (
        <div className={`mt-2 rounded-md border px-3 py-2.5 ${principal.classe}`}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium">
            {principal.selo && <span className="rounded-full bg-surface px-2 py-0.5 font-semibold">{principal.selo}</span>}
            <span>{principal.tipo}</span><span aria-hidden>·</span><span>{principal.quando}</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">{principal.titulo}</p>
          {principal.observacao && <p className="mt-0.5 text-xs leading-relaxed text-ink-2">“{principal.observacao}”</p>}
          {principal.detalhe && <p className="mt-0.5 text-[11px] text-ink-3">{principal.detalhe}</p>}
          <button type="button" onClick={onIrConversa}
            className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-2">
            Abrir conversa
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-3">Nenhum follow-up, retorno ou reunião combinado com este lead.</p>
          <button type="button" onClick={onIrConversa}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-2">
            Criar follow-up
          </button>
        </div>
      )}
      {outros.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs">
          {outros.map((c) => (
            <li key={c.chave} className="flex flex-wrap items-baseline gap-x-1.5 text-ink-2">
              {c.selo && <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${c.classe}`}>{c.selo}</span>}
              <span className="text-ink-3">{c.tipo} · {c.quando}:</span>
              <span className="font-medium text-ink">{c.titulo}</span>
            </li>
          ))}
        </ul>
      )}
      {ligacao && (
        <div className="mt-3 border-t border-line pt-3 text-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Última ligação</p>
          <p className="mt-1 text-ink-2">{ligacao.texto}</p>
          {ligacao.notas && <p className="mt-0.5 text-[11px] text-ink-3">“{ligacao.notas}”</p>}
        </div>
      )}
    </div>
  )
}

export default function ConversasPage() {
  const [lista, setLista] = useState<Conversa[]>([])
  const [erro, setErro] = useState('')
  // Guarda so o NUMERO: quem carrega a conversa e o painel, que assim garante estado de
  // carregando, erro com "Tentar de novo" e a troca rapida entre conversas sem vazamento.
  const [numeroAberto, setNumeroAberto] = useState<string | null>(null)
  // Aba com que o painel abre — deep-link aditivo (dado pronto, sem rota nova): "Histórico"
  // abre em 'chat'; o botão "Detalhes" ao lado do interesse abre já em 'interesses'.
  const [abaAberta, setAbaAberta] = useState<'chat' | 'interesses'>('chat')
  // Ficha do lead — o MESMO drawer do Banco de Leads (FichaLead). So' abre quando a conversa tem
  // um prospect por tras; sem prospect (Meta/organico/nao coletado) cai no ConversaPainel, que
  // serve qualquer contato. O FichaLead e' inteiro chaveado pelo id do prospect e nao renderiza
  // sem ele.
  const [ficha, setFicha] = useState<{
    lead: LeadDetalhavel; status: string; numero: string; titulo: string
    secao: SecaoFicha; criterios: { titulo?: string; delta?: number }[]
  } | null>(null)
  // "Esfriando" e' o unico filtro rapido que sobrou na barra (junto dos de ordenacao); os de
  // temperatura sairam. O banner de alerta e o chip usam este mesmo estado.
  const [filtro, setFiltro] = useState<'todos' | 'esfriando'>('todos')
  // Ordenacao rapida + painel "Personalizar" (client-side, persistidos por tela).
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const [mostrarFiltros, setMostrarFiltros] = useState(false)
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS)
  const [buscaNumero, setBuscaNumero] = useState('')
  const [carregandoLista, setCarregandoLista] = useState(true)
  // Padrao GLOBAL da IA (app.empresas.config.modo_ia_padrao). `null` = ainda carregando:
  // desenhar "Conversa" antes de saber mostraria um estado que talvez nao seja o real.
  const [modoPadrao, setModoPadrao] = useState<ModoIa | null>(null)
  const [alterandoPadrao, setAlterandoPadrao] = useState(false)
  const requisicaoLista = useRef(0)
  const fb = useFeedback()

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  // Quem está olhando — é o que distingue "Você" de "Outro atendente" na coluna Atendente.
  const { usuario, capacidades } = useSession()
  const usuarioId = usuario?.id

  // Etapa 7: recorte por ATENDENTE. `escopo` é o que a tela PEDE; `escopoEfetivo` é o que o
  // backend DEVOLVEU. Quem não pode ver todas recebe "minhas + NÃO ATRIBUÍDAS" — e a segunda
  // metade não é cortesia: conversa que ninguém vê é cliente sem resposta.
  const [escopo, setEscopo] = useState('')
  const [escopoEfetivo, setEscopoEfetivo] = useState<string | null>(null)
  // O ALCANCE (frase pronta do backend) é outra coisa que o ESCOPO: o escopo é o filtro que esta
  // tela pediu; o alcance é o LIMITE de quem está olhando — as suas, as do seu número e as dos
  // números compartilhados da empresa. Declarar o limite evita o atendente achar que a Central
  // esvaziou ou que perdeu histórico.
  const [alcance, setAlcance] = useState<string>('')
  const [podeVerTodas, setPodeVerTodas] = useState(false)

  function carregar(numeroBuscado = buscaNumero) {
    if (!empresaId) return
    const requisicao = ++requisicaoLista.current
    const numero = numeroBuscado.replace(/\D/g, '').slice(0, 20)
    // ponytail: filtros/ordenacao rodam sobre esta janela (os 200 mais recentes). Carteira maior
    // => paginacao de servidor, projeto proprio (mesma divida declarada do Banco de Leads).
    const params = new URLSearchParams({ limit: '200' })
    if (numero) params.set('numero', numero)
    if (escopo) params.set('escopo', escopo)

    setCarregandoLista(true)
    setErro('')
    apiFetch<Conversa[], { escopo?: string; pode_ver_todas?: boolean; alcance?: string }>(
      `/api/empresas/${empresaId}/conversas?${params.toString()}`
    )
      .then((r) => {
        if (requisicao !== requisicaoLista.current) return
        setLista(r.data)
        // Recortar em silêncio faria o atendente achar que a Central esvaziou.
        setEscopoEfetivo(r.meta?.escopo || null)
        setPodeVerTodas(r.meta?.pode_ver_todas === true)
        setAlcance(r.meta?.alcance || '')
      })
      .catch((e) => {
        if (requisicao === requisicaoLista.current) setErro(e.message)
      })
      .finally(() => {
        if (requisicao === requisicaoLista.current) setCarregandoLista(false)
      })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => carregar(buscaNumero), 300)
    return () => window.clearTimeout(timer)
  }, [empresaId, buscaNumero, escopo])

  // Preferencia de TELA (ordem + filtros), como `bancoLeadsView` no Banco de Leads. Trabalho do
  // operador; sobrevive ao reload. try/catch: private window / storage bloqueado nao pode quebrar.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('conversasView')
      if (!raw) return
      const v = JSON.parse(raw)
      if (v?.ordem) setOrdem(v.ordem)
      if (v?.filtros) setFiltros({ ...FILTROS_VAZIOS, ...v.filtros })
    } catch { /* sem preferencia salva; segue no padrao */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('conversasView', JSON.stringify({ ordem, filtros })) } catch { /* ignore */ }
  }, [ordem, filtros])

  // O padrao global e' carregado uma vez, fora do ciclo da busca: ele nao depende de filtro
  // nem de texto digitado. Falha aqui NAO vira erro na tela — a lista de conversas continua
  // util sem o controle, e um alarme vermelho no topo diria que a Central quebrou.
  useEffect(() => {
    if (!empresaId) return
    let vivo = true
    apiFetch<{ modo: string }>(`/api/empresas/${empresaId}/modo-ia-padrao`)
      .then((r) => { if (vivo) setModoPadrao(normalizarModo(r.data.modo)) })
      .catch(() => { /* sem controle global; o resto da tela segue */ })
    return () => { vivo = false }
  }, [empresaId])

  /**
   * OTIMISTA com reversao, como no painel: o efeito vale para mensagens futuras e esperar a
   * rede faria o operador clicar duas vezes. Falhou, volta ao valor anterior — a tela nunca
   * pode afirmar "Análise" enquanto o motor continua respondendo.
   */
  async function alterarModoPadrao(novo: ModoIa) {
    if (!empresaId || alterandoPadrao) return
    const anterior = modoPadrao
    if (!houveMudancaDeModo(anterior, novo)) return
    setAlterandoPadrao(true)
    setModoPadrao(novo)
    try {
      const r = await fb.runTask(
        () => apiFetch<{ modo: string }>(`/api/empresas/${empresaId}/modo-ia-padrao`, {
          method: 'PATCH',
          body: JSON.stringify({ modo: novo }),
        }),
        { sucesso: `Modo padrão da Central: ${descreverModo(novo).rotulo}.` }
      )
      setModoPadrao(normalizarModo(r.data.modo))
    } catch {
      setModoPadrao(anterior)
    } finally {
      setAlterandoPadrao(false)
    }
  }

  // Clique no NOME: abre a ficha do lead (drawer do Banco de Leads) quando ha' prospect; senao,
  // o painel de conversa. Falha ao buscar o lead (comercial sem LEAD_VER_APROVADOS, ou lead fora
  // do recorte) tambem cai no painel — sempre aparece um drawer.
  async function abrirDetalheDoLead(c: Conversa) {
    if (!c.prospect_id || !empresaId) { setAbaAberta('chat'); setNumeroAberto(c.numero); return }
    try {
      const r = await apiFetch<LeadDetalhavel & { status?: string }>(
        `/api/empresas/${empresaId}/banco-leads/leads/${c.prospect_id}`
      )
      const lead = r.data
      setFicha({
        lead,
        status: lead.status || '',
        numero: c.numero,
        titulo: nomeColunaLead(c) || identidadeConversa(c).titulo,
        secao: 'resumo',
        criterios: c.score_interesse_criterios || [],
      })
    } catch {
      setAbaAberta('chat'); setNumeroAberto(c.numero)
    }
  }

  // Registro de status na ficha (contato, ligação, reunião, proposta, descarte). Mesmo endpoint
  // do Banco de Leads (`PATCH /leads/:id/status`); aqui só se atualiza a ficha aberta — não há
  // lista de leads para reconciliar. É o que habilita o registro dentro do drawer da Central.
  async function alterarStatusFicha(statusOperacional: string, payload?: Record<string, unknown>) {
    if (!ficha || !empresaId) return
    const r = await fb.runTask(
      () => apiFetch<{ status: string }>(
        `/api/empresas/${empresaId}/banco-leads/leads/${ficha.lead.id}/status`,
        { method: 'PATCH', body: JSON.stringify({ status: statusOperacional, ...(payload || {}) }) }
      ),
      { sucesso: 'Registro atualizado.' }
    )
    setFicha((f) => (f ? { ...f, status: r.data.status } : f))
  }

  async function salvarTelefoneFicha(telefone: string) {
    if (!ficha || !empresaId) return
    const r = await apiFetch<{ telefone: string | null; status: string }>(
      `/api/empresas/${empresaId}/banco-leads/leads/${ficha.lead.id}/telefone`,
      { method: 'PATCH', body: JSON.stringify({ telefone }) }
    )
    setFicha((f) => (f ? { ...f, status: r.data.status, lead: { ...f.lead, telefone: r.data.telefone } } : f))
    fb.toast(telefone ? 'Telefone salvo.' : 'Telefone removido.')
  }

  async function removerConversa(c: Conversa) {
    if (!empresaId) return
    const identidade = identidadeConversa(c)
    if (!confirm(`Remover ${identidade.titulo} do banco?\n\nIsso apaga a conversa, perfil do lead e insights. Ação irreversível.`)) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`, { method: 'DELETE' }),
        { sucesso: 'Conversa removida.' })
      setLista((prev) => prev.filter((x) => x.numero !== c.numero))
      if (numeroAberto === c.numero) setNumeroAberto(null)
    } catch { /* erro já exibido pelo feedback */ }
  }

  // Marca as conversas que estão esfriando (o unico filtro rapido de temperatura que sobrou).
  const enriquecidas = lista.map((c) => ({ c, alerta: esfriando(c) }))
  const totalEsfriando = enriquecidas.filter((x) => x.alerta).length
  // Opcoes dos selects derivadas da propria janela carregada (auto-atualizam; sem lista fixa).
  const distinct = (get: (c: Conversa) => string | null | undefined) =>
    Array.from(new Set(lista.map(get).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const opcoes = {
    nicho: distinct((c) => c.nicho),
    status: distinct((c) => c.status),
    estagio: distinct((c) => c.estagio),
    instancia: distinct((c) => instanciaDe(c)),
    atendente: distinct((c) => c.responsavel_nome),
  }

  function passaFiltros(c: Conversa): boolean {
    const f = filtros
    if (f.interesseMin && (RANK_INTERESSE[c.score_interesse_faixa || ''] ?? 0) < RANK_INTERESSE[f.interesseMin]) return false
    if (f.whatsapp === 'sim' && c.tem_whatsapp !== true) return false
    if (f.whatsapp === 'nao' && c.tem_whatsapp !== false) return false
    if (f.nicho && (c.nicho || '') !== f.nicho) return false
    if (f.status && (c.status || '') !== f.status) return false
    if (f.estagio && (c.estagio || '') !== f.estagio) return false
    if (f.instancia && instanciaDe(c) !== f.instancia) return false
    if (f.atendente === 'nao_atribuida' && c.responsavel_id) return false
    if (f.atendente && f.atendente !== 'nao_atribuida' && (c.responsavel_nome || '') !== f.atendente) return false
    if (!dentroPeriodo(c, f)) return false
    return true
  }

  const porTempo = (a: Conversa, b: Conversa) =>
    new Date(b.atualizado_em || 0).getTime() - new Date(a.atualizado_em || 0).getTime()
  const porInteresse = (a: Conversa, b: Conversa) =>
    (scoreValue(b.score_interesse) ?? -1) - (scoreValue(a.score_interesse) ?? -1)
  function ordenar(a: { c: Conversa }, b: { c: Conversa }): number {
    if (ordem === 'antigos') return -porTempo(a.c, b.c)
    if (ordem === 'interesse') return porInteresse(a.c, b.c)
    if (ordem === 'quentes') return (RANK_TEMP[classificar(a.c)] - RANK_TEMP[classificar(b.c)]) || porInteresse(a.c, b.c)
    return porTempo(a.c, b.c) // recentes (padrao)
  }

  const nFiltros = contarFiltros(filtros)
  const visiveis = enriquecidas
    .filter((x) => (filtro === 'esfriando' ? x.alerta : true))
    .filter((x) => passaFiltros(x.c))
    .sort(ordenar)


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Conversas</h1>
          <p className="mt-1 text-sm text-slate-500">Encontre um contato e acompanhe o histórico do atendimento.</p>
        </div>
        {/* Padrao GLOBAL da IA. So aparece depois de carregado: um controle que mostra
            "Conversa" antes de saber o valor real e' pior que controle nenhum.
            Padrao compacto de controle de ativacao: NOME + icone de informacao + controle.
            O estado por extenso e os dois paragrafos fixos sairam — a opcao marcada JA e' o
            estado, e a consequencia + o limite das excecoes vivem no balao (`ajudaPadraoGlobal`)
            e no `aria-label`, sem ocupar espaco permanente no topo da tela. */}
        {modoPadrao && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <span className="text-sm font-medium text-slate-700">Modo padrão da IA</span>
            <AlternadorModoIa
              opcoes={opcoesDeModo()}
              selecionado={modoPadrao}
              onMudar={(id) => alterarModoPadrao(id as ModoIa)}
              ocupado={alterandoPadrao}
              // Etapa 9: o padrão da EMPRESA decide como a IA se comporta em toda conversa nova.
              // Se a exceção por conversa exige a capacidade, o padrão global exige ainda mais.
              bloqueio={temCapacidade(capacidades, 'conversa_gerenciar_ia') ? '' : 'Só quem administra a operação pode mudar o padrão da IA.'}
              compacto
              ajuda={ajudaPadraoGlobal(modoPadrao)}
              ariaLabel={rotuloAcessivelPadrao(modoPadrao)}
            />
          </div>
        )}
      </div>
      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {totalEsfriando > 0 && (
        <button
          onClick={() => setFiltro('esfriando')}
          className="flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left transition hover:bg-red-100"
        >
          <span className="text-xl">⚠️</span>
          <span className="text-sm text-red-800">
            <strong>{totalEsfriando} lead{totalEsfriando > 1 ? 's' : ''} esfriando</strong> — mostrou interesse mas começou a
            perder calor (silêncio, adiamento ou recusa). Clique para ver e intervir.
          </span>
        </button>
      )}

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-4">
          {podeVerTodas && (
            <div>
              <label htmlFor="escopo-conversas" className="mb-1 block text-xs font-medium text-slate-500">Atendente</label>
              <select id="escopo-conversas" value={escopo} onChange={(e) => setEscopo(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand">
                {opcoesEscopoConversa(podeVerTodas).map((o) => (
                  <option key={o.valor || 'padrao'} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
              {/* O servidor rebaixou o pedido? Recortar em silêncio faria o atendente achar que a
                  Central esvaziou. */}
              {avisoDeRecorte(escopo, escopoEfetivo) && (
                <p className="mt-1 max-w-[220px] text-[10px] leading-snug text-amber-700">
                  {avisoDeRecorte(escopo, escopoEfetivo)}
                </p>
              )}
            </div>
          )}

          <div className="min-w-[240px] flex-1 sm:max-w-xl">
            <label htmlFor="busca-numero" className="mb-1 block text-xs font-medium text-slate-500">Pesquisar número</label>
            <div className="relative">
              <input
                id="busca-numero"
                type="search"
                inputMode="tel"
                value={buscaNumero}
                onChange={(e) => setBuscaNumero(e.target.value)}
                placeholder="Ex.: (11) 99999-9999"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-blue-100"
              />
              {buscaNumero && (
                <button
                  type="button"
                  onClick={() => setBuscaNumero('')}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-brand"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
          <p className="pb-2 text-xs text-slate-500" aria-live="polite">
            {carregandoLista ? 'Buscando conversas…' : `${visiveis.length} conversa${visiveis.length === 1 ? '' : 's'} encontrada${visiveis.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* Filtros rapidos: ordenacao + o atalho "Esfriando". O resto dos filtros vive no modal. */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-3">
          <span className="text-xs font-medium text-slate-500">Ordenar:</span>
          {ORDENS.map((o) => {
            const ativo = ordem === o.valor
            return (
              <button key={o.valor} onClick={() => setOrdem(o.valor)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  ativo ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}>
                {o.label}
              </button>
            )
          })}
          {totalEsfriando > 0 && (
            <button
              onClick={() => setFiltro((v) => (v === 'esfriando' ? 'todos' : 'esfriando'))}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filtro === 'esfriando' ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 bg-white text-red-600 hover:bg-red-50'
              }`}>
              ⚠️ Esfriando <span className={filtro === 'esfriando' ? 'opacity-80' : 'text-red-400'}>({totalEsfriando})</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {nFiltros > 0 && (
              <button onClick={() => setFiltros(FILTROS_VAZIOS)}
                className="text-xs text-slate-500 underline-offset-2 hover:text-brand hover:underline">
                Limpar filtros
              </button>
            )}
            <button onClick={() => setMostrarFiltros((v) => !v)}
              aria-expanded={mostrarFiltros}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                mostrarFiltros || nFiltros > 0 ? 'border-brand bg-brand/5 text-brand' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              }`}>
              <IconGear className="h-4 w-4" /> Personalizar{nFiltros > 0 ? ` (${nFiltros})` : ''}
            </button>
          </div>
        </div>

        <FolhaModal
          aberto={mostrarFiltros}
          titulo="Personalizar filtros"
          descricao="Refina a lista. Os filtros valem sobre as conversas já carregadas."
          onFechar={() => setMostrarFiltros(false)}
          tamanho="lg"
          rodape={
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setFiltros(FILTROS_VAZIOS)} disabled={nFiltros === 0}
                className="text-sm text-slate-500 underline-offset-2 hover:text-brand hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline">
                Limpar tudo
              </button>
              <button onClick={() => setMostrarFiltros(false)}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                Concluir
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">Interesse (mínimo)</span>
              <select value={filtros.interesseMin}
                onChange={(e) => setFiltros((f) => ({ ...f, interesseMin: e.target.value as Filtros['interesseMin'] }))}
                className={CAMPO_SEL}>
                <option value="">Qualquer</option>
                <option value="medio">Médio ou alto</option>
                <option value="alto">Só alto</option>
              </select>
            </label>

            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">WhatsApp</span>
              <select value={filtros.whatsapp}
                onChange={(e) => setFiltros((f) => ({ ...f, whatsapp: e.target.value as Filtros['whatsapp'] }))}
                className={CAMPO_SEL}>
                <option value="">Qualquer</option>
                <option value="sim">Tem WhatsApp</option>
                <option value="nao">Sem WhatsApp</option>
              </select>
            </label>

            {([
              { key: 'nicho', label: 'Nicho', ops: opcoes.nicho, vazio: 'Todos' },
              { key: 'status', label: 'Status', ops: opcoes.status, vazio: 'Todos' },
              { key: 'estagio', label: 'Etapa do funil', ops: opcoes.estagio, vazio: 'Todas' },
              { key: 'instancia', label: 'Instância', ops: opcoes.instancia, vazio: 'Todas' },
            ] as const).map(({ key, label, ops, vazio }) => (
              <label key={key} className="block text-xs">
                <span className="mb-1 block font-medium text-slate-500">{label}</span>
                <select value={filtros[key]}
                  onChange={(e) => setFiltros((f) => ({ ...f, [key]: e.target.value }))}
                  className={CAMPO_SEL}>
                  <option value="">{vazio}</option>
                  {ops.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}

            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">Atendente</span>
              <select value={filtros.atendente}
                onChange={(e) => setFiltros((f) => ({ ...f, atendente: e.target.value }))}
                className={CAMPO_SEL}>
                <option value="">Todos</option>
                <option value="nao_atribuida">Não atribuída</option>
                {opcoes.atendente.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>

            <label className="block text-xs">
              <span className="mb-1 block font-medium text-slate-500">Período (atualização)</span>
              <select value={filtros.periodo}
                onChange={(e) => setFiltros((f) => ({ ...f, periodo: e.target.value as Filtros['periodo'] }))}
                className={CAMPO_SEL}>
                <option value="">Qualquer</option>
                <option value="hoje">Hoje</option>
                <option value="14d">Últimos 14 dias</option>
                <option value="custom">Entre datas…</option>
              </select>
            </label>

            {filtros.periodo === 'custom' && (
              <div className="flex items-end gap-2 text-xs sm:col-span-2 lg:col-span-1">
                <label className="block flex-1">
                  <span className="mb-1 block font-medium text-slate-500">De</span>
                  <input type="date" value={filtros.de}
                    onChange={(e) => setFiltros((f) => ({ ...f, de: e.target.value }))}
                    className={CAMPO_SEL} />
                </label>
                <label className="block flex-1">
                  <span className="mb-1 block font-medium text-slate-500">Até</span>
                  <input type="date" value={filtros.ate}
                    onChange={(e) => setFiltros((f) => ({ ...f, ate: e.target.value }))}
                    className={CAMPO_SEL} />
                </label>
              </div>
            )}
          </div>
        </FolhaModal>

        <DataTableFrame
          className="rounded-b-2xl"
          ariaLabel="Rolagem horizontal da tabela de conversas"
        >
      <table className="w-full min-w-max text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
          <tr>
            <th className="text-left px-4 py-2">Lead</th>
            <th className="text-left px-4 py-2">Telefone</th>
            <th className="text-left px-4 py-2">Temperatura</th>
            <th className="text-left px-4 py-2">Interesse</th>
            <th className="text-left px-4 py-2">Estágio</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-left px-4 py-2">Atendente</th>
            <th className="text-right px-4 py-2">Atualizado</th>
            <th className="text-right px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {carregandoLista ? (
            <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">Buscando conversas…</td></tr>
          ) : visiveis.map(({ c, alerta }) => {
            // Coluna Lead = SÓ nome (resolvido no backend: WhatsApp → Google Maps → vazio).
            // O telefone tem coluna própria ao lado; repeti-lo aqui seria o mesmo dado duas
            // vezes na linha. `identidade` continua servindo a coluna Telefone e a confirmação
            // de remoção, onde o telefone é a identificação de segurança.
            const identidade = identidadeConversa(c)
            const nomeLead = nomeColunaLead(c)
            return (
            <tr key={c.numero} className={`hover:bg-slate-50/70 ${alerta ? 'bg-red-50/60' : ''} ${(numeroAberto === c.numero || ficha?.numero === c.numero) ? 'ring-1 ring-inset ring-brand/40' : ''}`}>
              <td className="px-4 py-3 font-medium text-slate-800">
                {/* Nome clicavel abre a ficha da conversa (ConversaPainel) — mesma porta do botao
                    "Historico", que serve qualquer contato, com prospect ou nao. Sem nome, a
                    coluna fica vazia (o botao "Historico" em Acoes continua abrindo). */}
                {nomeLead ? (
                  <button
                    onClick={() => abrirDetalheDoLead(c)}
                    className="block max-w-[220px] truncate text-left text-brand underline decoration-dotted decoration-brand/40 underline-offset-2 hover:decoration-solid"
                    title="Abrir a ficha do lead"
                  >
                    {nomeLead}
                  </button>
                ) : (
                  <TextoTruncado texto={nomeLead} className="max-w-[220px]" vazio="" />
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600">{identidade.telefone || '—'}</td>
              <td className="px-4 py-3">
                <div className="inline-flex items-center gap-1.5">
                  <TempBadge t={c.temperatura_lead} />
                  {alerta && <span title="Era quente e está esfriando — intervir" className="text-sm">⚠️</span>}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <InteresseBadge c={c} compact />
                  <button
                    onClick={() => { setAbaAberta('interesses'); setNumeroAberto(c.numero) }}
                    className="text-[11px] text-slate-500 underline-offset-2 hover:text-brand hover:underline"
                    title="Abrir a conversa já na aba Interesses"
                  >
                    Detalhes
                  </button>
                </div>
              </td>
              <td className="px-4 py-3">{c.estagio}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs">
                {(() => {
                  const dono = atendenteDaConversa(c, usuarioId)
                  // Instancia SEMPRE visivel: com 3 numeros no pull, e' ela que diz por qual a
                  // conversa e' respondida (a resposta sai pela instancia gravada na conversa).
                  const inst = c.instancia_nome || c.evolution_instance || ''
                  return (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className={
                        dono.estado === 'nao_atribuida' ? 'rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700'
                          : dono.meu ? 'rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700'
                            : 'text-slate-600'
                      }>{dono.rotulo}</span>
                      <span className="text-[11px] text-blue-700">
                        Instância: <strong>{inst || 'não definida'}</strong>
                      </span>
                    </div>
                  )
                })()}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-gray-500">
                {fmtData(c.atualizado_em)}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => { setAbaAberta('chat'); setNumeroAberto(c.numero) }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
                  >
                    Histórico
                  </button>
                  <button
                    onClick={() => removerConversa(c)}
                    title="Remover contato e dados deste número"
                    aria-label="Remover"
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5 transition-colors"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
            )
          })}
          {!carregandoLista && visiveis.length === 0 && (
            <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">
              {buscaNumero.replace(/\D/g, '')
                ? 'Nenhuma conversa encontrada para esse número.'
                : lista.length === 0 ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa neste filtro.'}
              {/* Tela vazia sem explicação parece defeito. Quem não vê todas precisa saber que
                  existe um recorte antes de concluir que não há trabalho. */}
              {lista.length === 0 && !podeVerTodas && alcance && (
                <span className="mt-2 block text-xs text-gray-400">Você está vendo {alcance}.</span>
              )}
            </td></tr>
          )}
        </tbody>
      </table>
        </DataTableFrame>
      </section>

      {numeroAberto && (
        <ConversaPainel
          empresaId={empresaId}
          numero={numeroAberto}
          onFechar={() => setNumeroAberto(null)}
          onAtualizou={() => carregar()}
          abaInicial={abaAberta}
        />
      )}

      {/* Ficha do lead (drawer do Banco de Leads). Somente-leitura aqui: quem tria/edita ICP e'
          o Banco de Leads. Interesses vem dos sinais da conversa. */}
      {ficha && (
        <FichaLead
          lead={ficha.lead}
          conversa={{
            numero: ficha.numero,
            titulo: ficha.titulo,
            leadId: ficha.lead.id,
            mensagemGerada: null,
            rodavel: false,
            status: ficha.status,
            acessos: acessosDoLead(ficha.lead),
          }}
          secao={ficha.secao}
          onTrocarSecao={(s) => setFicha((f) => (f ? { ...f, secao: s } : f))}
          onFechar={() => setFicha(null)}
          empresaId={empresaId}
          // Mesma ficha do Banco de Leads: registrar status/ligação/reunião/proposta, qualificar
          // (ICP) e corrigir telefone — tudo persiste pelos mesmos endpoints. Qualificação só é
          // editável para quem tem a capacidade de triar (senão o autosave tomaria 403).
          podeEditarIcp={temCapacidade(capacidades, 'lead_triar')}
          podeTriarLead={temCapacidade(capacidades, 'lead_triar')}
          onAlterarStatus={alterarStatusFicha}
          onSalvarTelefone={salvarTelefoneFicha}
          onLeadAtualizado={(lead) => setFicha((f) => (f ? { ...f, lead: lead as LeadDetalhavel } : f))}
          interessesConversa={ficha.criterios}
          resumoExtra={
            <ResumoProximaAcao
              empresaId={empresaId}
              leadId={ficha.lead.id}
              onIrConversa={() => setFicha((f) => (f ? { ...f, secao: 'conversa' } : f))}
            />
          }
        />
      )}
    </div>
  )
}
