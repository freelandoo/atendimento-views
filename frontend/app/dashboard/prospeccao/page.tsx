'use client'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconTrash, IconStar, IconUndo, IconPlay } from '@/components/ui/icons'

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
  tem_site: boolean
  site: string | null
  maps_url: string | null
  status: string
  score: number | null
  score_cadastro: number | null
  score_cadastro_max: number | null
  json_apresentacao: JsonApresProspect | null
  created_at: string | null
}
type Metricas = {
  total: string; aguardando: string; aprovados: string; rejeitados: string
  enviados: string; responderam: string; taxa_resposta: number
}
type Config = {
  ativo: boolean; modo: string
  categoria_padrao: string | null; cidade_padrao: string | null
  estado_padrao: string | null; regiao_padrao: string | null
  limite_diario: number; intervalo_envio_minutos: number
  horario_inicio: string; horario_fim: string
  gerar_mensagem_ia: boolean; envio_real_habilitado: boolean
  // "Agenda": re-busca automática do Google Places a cada X horas.
  agendamento_busca_ativo: boolean; busca_intervalo_horas: number
  ultima_busca_em: string | null
  modo_busca: 'manual' | 'automatico_fixo' | 'ia'
  busca_max_diaria: 1 | 2
  busca_estrategia: 'conservadora' | 'equilibrada' | 'exploratoria'
  busca_nichos_permitidos: string[]
  busca_localizacoes_permitidas: string[]
  busca_permitir_nichos_relacionados: boolean
  busca_estado: 'aguardando' | 'escolhendo' | 'coletando' | 'processando' | 'esgotado' | 'sem_mercados' | 'limite_diario' | 'erro' | 'pausado'
  busca_mensagem: string | null
  busca_mercado_atual: { nicho?: string; cidade?: string; motivo?: string; confianca?: number } | null
  busca_zero_consecutivos: number
  busca_ultima_decisao_em: string | null
}
type ConfigPatch = Partial<Config> & { retomar_busca?: boolean }
type Agenda = {
  total_slots: number; primeiro_slot: string | null; ultimo_slot: string | null
  envio_real_habilitado?: boolean; observacao?: string
}
type ConfigResp = { config: Config; agenda: Agenda; escopo: string }
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

const FILTROS: { valor: string; label: string }[] = [
  { valor: '', label: 'Todos' },
  { valor: 'aguardando', label: 'Aguardando' },
  { valor: 'aprovado', label: 'Marcados' },
  { valor: 'rejeitado', label: 'Descartados' },
  { valor: 'enviado', label: 'Enviados' },
  { valor: 'respondeu', label: 'Responderam' },
]

const LEADS_POR_BUSCA = 200
const BUSCA_ESTADO_LABEL: Record<Config['busca_estado'], string> = {
  aguardando: 'Aguardando próximo ciclo', escolhendo: 'IA escolhendo mercado',
  coletando: 'Coleta em andamento', processando: 'Processando resultados',
  esgotado: 'Mercado esgotado', sem_mercados: 'Nenhum mercado novo encontrado',
  limite_diario: 'Limite diário atingido', erro: 'Busca pausada por erro', pausado: 'Pausado',
}

// Temperatura do lead pela pontuação (score): quente = mais dor digital / maior chance.
function temperatura(score: number | null): { emoji: string; label: string } {
  const s = score ?? 0
  if (s >= 70) return { emoji: '🔥', label: 'Quente' }
  if (s >= 40) return { emoji: '🌡️', label: 'Morno' }
  return { emoji: '❄️', label: 'Frio' }
}

// Data/hora "Entrou em" (1ª coluna): registro de quando o lead caiu na carteira.
function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Valor de cada coluna pra ordenação (clique no cabeçalho alterna asc/desc).
function valorColuna(p: Prospect, chave: string): number | string {
  switch (chave) {
    case 'entrou': return p.created_at || ''
    case 'nome': return (p.nome || '').toLowerCase()
    case 'telefone': return p.telefone || ''
    case 'email': return p.email || ''
    case 'endereco': return (p.endereco || '').toLowerCase()
    case 'nicho': return `${p.nicho || ''} ${p.cidade || ''}`.toLowerCase()
    case 'aval': return p.avaliacoes ?? -1
    case 'nota': return p.rating ?? -1
    case 'horario': return p.json_apresentacao?.empresa?.horario_funcionamento ? 1 : 0
    case 'site': return p.tem_site ? 1 : 0
    case 'pontos': return p.score_cadastro ?? 0
    case 'status': return p.status || ''
    default: return 0
  }
}

function compararProspects(a: Prospect, b: Prospect, ordem: { chave: string; dir: 'asc' | 'desc' }): number {
  const va = valorColuna(a, ordem.chave)
  const vb = valorColuna(b, ordem.chave)
  const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
  return ordem.dir === 'asc' ? cmp : -cmp
}

export default function ProspeccaoPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [rotina, setRotina] = useState<ConfigResp | null>(null)
  const [resultados, setResultados] = useState<ResultadosResp | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [buscas, setBuscas] = useState<Busca[]>([])
  const emAndamentoRef = useRef<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const [agindo, setAgindo] = useState<string | null>(null)
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [form, setForm] = useState<Partial<Config>>({})
  // Ordenação da tabela: default = MENOS pontos de cadastro no topo (mais
  // oportunidade de venda). Clicar no cabeçalho alterna asc/desc por coluna.
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' }>({ chave: 'pontos', dir: 'asc' })
  const [jsonAberto, setJsonAberto] = useState<{ titulo: string; json: JsonApresProspect } | null>(null)
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function ordenarPor(chave: string) {
    setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))
  }

  function carregar() {
    if (!empresaId) return
    const qs = filtro ? `&status=${encodeURIComponent(filtro)}` : ''
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?limit=100${qs}`)
      .then((r) => setProspects(r.data || [])).catch((e) => setErro(e.message))
    apiFetch<Metricas>(`/api/empresas/${empresaId}/prospeccao/metricas`)
      .then((r) => setMetricas(r.data)).catch(() => {})
    apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`)
      .then((r) => {
        setRotina(r.data)
        setForm({ ...r.data.config, limite_diario: LEADS_POR_BUSCA })
      }).catch(() => {})
    apiFetch<ResultadosResp>(`/api/empresas/${empresaId}/prospeccao/resultados`)
      .then((r) => setResultados(r.data)).catch(() => {})
    apiFetch<Analytics>(`/api/empresas/${empresaId}/prospeccao/analytics`)
      .then((r) => setAnalytics(r.data)).catch(() => {})
  }
  useEffect(() => { carregar() }, [empresaId, filtro])

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
      const configAtual = await apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`)
      setRotina(configAtual.data)
      setForm((atual) => ({
        ...atual,
        modo_busca: configAtual.data.config.modo_busca,
        agendamento_busca_ativo: configAtual.data.config.agendamento_busca_ativo,
        busca_estado: configAtual.data.config.busca_estado,
        busca_mensagem: configAtual.data.config.busca_mensagem,
        busca_mercado_atual: configAtual.data.config.busca_mercado_atual,
        busca_zero_consecutivos: configAtual.data.config.busca_zero_consecutivos,
        busca_ultima_decisao_em: configAtual.data.config.busca_ultima_decisao_em,
      }))
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

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, email: email || null } : p)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  function setF<K extends keyof Config>(k: K, v: Config[K]) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  const ordenados = [...prospects].sort((a, b) => compararProspects(a, b, ordem))

  function payloadConfiguracao(patch: ConfigPatch = {}) {
    return {
      ...form,
      ...patch,
      // Aquisição nunca religa o disparo legado; a busca recorrente tem flag própria.
      ativo: false,
      modo: 'manual',
      limite_diario: LEADS_POR_BUSCA,
      envio_real_habilitado: false,
      gerar_mensagem_ia: false,
    }
  }

  async function persistirConfiguracao(patch: ConfigPatch = {}) {
    if (!empresaId) return null
    setSalvandoConfig(true)
    try {
      const r = await apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`, {
        method: 'PUT',
        body: JSON.stringify(payloadConfiguracao(patch)),
      })
      setRotina(r.data)
      const chaves = Object.keys(patch).filter((chave) => chave in r.data.config) as (keyof Config)[]
      if (chaves.length === 0) {
        setForm({ ...r.data.config, limite_diario: LEADS_POR_BUSCA })
      } else {
        // Atualiza somente os campos persistidos; não apaga outro input que o operador
        // esteja digitando enquanto uma gravação onBlur termina.
        setForm((atual) => {
          const normalizados: Partial<Config> = {}
          for (const chave of chaves) normalizados[chave] = r.data.config[chave] as never
          return { ...atual, ...normalizados, limite_diario: LEADS_POR_BUSCA }
        })
      }
      return r.data
    } finally {
      setSalvandoConfig(false)
    }
  }

  async function salvarAjuste(patch: ConfigPatch) {
    try {
      setErro('')
      const mudouMercadoFixo = form.modo_busca === 'automatico_fixo' && ('categoria_padrao' in patch || 'cidade_padrao' in patch || 'estado_padrao' in patch)
      await persistirConfiguracao(mudouMercadoFixo ? { ...patch, retomar_busca: true } : patch)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a configuração da busca.')
    }
  }

  async function trocarModoBusca(modo: Config['modo_busca']) {
    if (modo === 'automatico_fixo' && (!(form.categoria_padrao || '').trim() || !(form.cidade_padrao || '').trim())) {
      fb.toast('Informe nicho e cidade antes de ligar o automático fixo.', 'error')
      return
    }
    try {
      setErro('')
      await persistirConfiguracao({
        modo_busca: modo,
        agendamento_busca_ativo: modo !== 'manual',
        retomar_busca: modo !== 'manual',
      })
      fb.toast(modo === 'manual' ? 'Modo manual ativado.' : modo === 'ia' ? 'Busca IA ativada.' : 'Automático fixo ativado.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao alterar o modo da busca.')
    }
  }

  // Executa uma busca imediata e salva os mesmos parâmetros usados pelo automático.
  async function rodar() {
    if (!empresaId) return
    const nicho = (form.categoria_padrao || '').trim()
    const cidade = (form.cidade_padrao || '').trim()
    if (!nicho || !cidade) { setErro('Informe nicho e cidade para buscar.'); return }

    setErro('')
    setBuscando(true)
    try {
      await persistirConfiguracao()
      // 2) Enfileira a busca (Bright Data Maps é assíncrona — leva alguns minutos).
      await apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
        method: 'POST',
        body: JSON.stringify({ nicho, cidade }),
      })
      fb.toast(`Busca de até ${LEADS_POR_BUSCA} leads em andamento. A lista atualiza sozinha.`, 'info')
      carregarBuscas()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao rodar a agenda.')
    } finally {
      setBuscando(false)
    }
  }

  const cfg = rotina?.config
  async function retomarBusca() {
    try {
      setErro('')
      await persistirConfiguracao({ retomar_busca: true })
      fb.toast('Busca retomada. O worker seguirá a janela e o intervalo.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao retomar a busca.')
    }
  }

  const modoBusca = form.modo_busca || (form.agendamento_busca_ativo ? 'ia' : 'manual')
  const modoAutomatico = modoBusca !== 'manual'
  const estadoBloqueado = ['sem_mercados', 'erro'].includes(cfg?.busca_estado || '')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prospecção</h1>
        <p className="text-sm text-slate-500 mt-1">Configure a origem da busca e deixe o worker alimentar o Banco de Leads, mesmo fora desta tela.</p>
      </div>

      <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Modo da busca</label>
            <select value={modoBusca} disabled={salvandoConfig}
              onChange={(e) => trocarModoBusca(e.target.value as Config['modo_busca'])}
              className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60">
              <option value="manual">Manual</option>
              <option value="automatico_fixo">Automático fixo</option>
              <option value="ia">Busca IA</option>
            </select>
            <div className={`mt-2 flex items-start gap-2 text-xs ${modoAutomatico ? 'text-emerald-700' : 'text-slate-500'}`}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${modoAutomatico ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              <span>{modoBusca === 'ia'
                ? 'A IA escolhe um mercado novo dentro das suas preferências.'
                : modoBusca === 'automatico_fixo'
                  ? 'Repete o nicho e a cidade até não encontrar mais leads novos.'
                  : 'A busca acontece somente quando você clicar em Buscar agora.'}</span>
            </div>
          </div>

          {modoBusca !== 'ia' && <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Nicho"><input value={form.categoria_padrao || ''}
              onChange={(e) => setF('categoria_padrao', e.target.value)}
              onBlur={(e) => salvarAjuste({ categoria_padrao: e.target.value })}
              placeholder="ex: dentista" className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
            <Campo label="Cidade"><input value={form.cidade_padrao || ''}
              onChange={(e) => setF('cidade_padrao', e.target.value)}
              onBlur={(e) => salvarAjuste({ cidade_padrao: e.target.value })}
              placeholder="ex: Campinas" className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
            <Campo label="Estado (UF)"><input value={form.estado_padrao || ''} maxLength={2}
              onChange={(e) => setF('estado_padrao', e.target.value.toUpperCase())}
              onBlur={(e) => salvarAjuste({ estado_padrao: e.target.value.toUpperCase() })}
              placeholder="SP" className="w-full rounded-lg border px-3 py-2 text-sm uppercase" /></Campo>
          </div>}
        </div>

        {modoAutomatico && (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo label="Buscar a cada (horas)"><input type="number" min={6} max={168}
              value={form.busca_intervalo_horas ?? 6}
              onChange={(e) => setF('busca_intervalo_horas', Math.max(6, Number(e.target.value) || 6))}
              onBlur={(e) => salvarAjuste({ busca_intervalo_horas: Math.max(6, Number(e.target.value) || 6) })}
              className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
            <Campo label="Máximo por dia"><select value={form.busca_max_diaria ?? 2}
              onChange={(e) => salvarAjuste({ busca_max_diaria: Number(e.target.value) as 1 | 2 })}
              className="w-full rounded-lg border px-3 py-2 text-sm">
              <option value={1}>1 busca por dia</option>
              <option value={2}>2 buscas por dia</option>
            </select></Campo>
            <Campo label="Início da janela"><input type="time" value={form.horario_inicio || '08:00'}
              onChange={(e) => setF('horario_inicio', e.target.value)}
              onBlur={(e) => salvarAjuste({ horario_inicio: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
            <Campo label="Fim da janela"><input type="time" value={form.horario_fim || '17:00'}
              onChange={(e) => setF('horario_fim', e.target.value)}
              onBlur={(e) => salvarAjuste({ horario_fim: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
          </div>
        )}

        {modoBusca === 'ia' && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Campo label="Estratégia"><select value={form.busca_estrategia || 'equilibrada'}
                onChange={(e) => salvarAjuste({ busca_estrategia: e.target.value as Config['busca_estrategia'] })}
                className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="conservadora">Conservadora</option>
                <option value="equilibrada">Equilibrada — recomendada</option>
                <option value="exploratoria">Exploratória</option>
              </select></Campo>
              <Campo label="Nichos permitidos"><input
                value={(form.busca_nichos_permitidos || []).join(', ')}
                onChange={(e) => setF('busca_nichos_permitidos', e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                onBlur={(e) => salvarAjuste({ busca_nichos_permitidos: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                placeholder="ex: dentistas, clínicas, arquitetos"
                className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
              <Campo label="Regiões permitidas"><input
                value={(form.busca_localizacoes_permitidas || []).join(', ')}
                onChange={(e) => setF('busca_localizacoes_permitidas', e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                onBlur={(e) => salvarAjuste({ busca_localizacoes_permitidas: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                placeholder="ex: SP, Campinas, Paraná"
                className="w-full rounded-lg border px-3 py-2 text-sm" /></Campo>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={form.busca_permitir_nichos_relacionados !== false}
                onChange={(e) => salvarAjuste({ busca_permitir_nichos_relacionados: e.target.checked })} />
              <span><b>Permitir nichos relacionados</b><span className="block text-xs text-slate-500">A IA pode explorar variações próximas dos nichos informados.</span></span>
            </label>
          </div>
        )}

        {modoAutomatico && cfg?.busca_estado && (
          <div className={`rounded-xl border px-3 py-2.5 text-sm ${['esgotado', 'sem_mercados', 'erro'].includes(cfg.busca_estado) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{BUSCA_ESTADO_LABEL[cfg.busca_estado]}</b>
              {cfg.busca_mercado_atual?.nicho && <span className="text-xs">Último mercado: {cfg.busca_mercado_atual.nicho} · {cfg.busca_mercado_atual.cidade}</span>}
            </div>
            {cfg.busca_mensagem && <p className="mt-1 text-xs">{cfg.busca_mensagem}</p>}
            {modoBusca === 'ia' && cfg.busca_mercado_atual?.motivo && <p className="mt-1 text-xs opacity-80">Decisão da IA: {cfg.busca_mercado_atual.motivo}</p>}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            <p><b className="text-slate-700">Até {LEADS_POR_BUSCA} leads por busca.</b> Os resultados entram no Banco de Leads; nenhum WhatsApp é enviado aqui.</p>
            {cfg?.ultima_busca_em && <p className="mt-1">Última busca automática: {quando(cfg.ultima_busca_em)}</p>}
            {salvandoConfig && <p className="mt-1 text-brand">Salvando configuração…</p>}
          </div>
          {modoBusca !== 'ia' ? (
            <button onClick={rodar} disabled={buscando || salvandoConfig || !rotina}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {buscando ? <Spinner /> : <IconPlay />}{buscando ? 'Iniciando busca…' : `Buscar ${LEADS_POR_BUSCA} agora`}
            </button>
          ) : estadoBloqueado ? (
            <button onClick={retomarBusca} disabled={salvandoConfig}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              <IconPlay /> Tentar novamente
            </button>
          ) : (
            <span className="text-xs font-medium text-emerald-700">Busca IA ativa em segundo plano</span>
          )}
        </div>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor || 'todos'}
            onClick={() => setFiltro(f.valor)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${filtro === f.valor ? 'bg-brand text-white border-brand' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {metricas && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Mini title="Total" value={metricas.total} />
          <Mini title="Aguardando" value={metricas.aguardando} />
          <Mini title="Marcados" value={metricas.aprovados} />
          <Mini title="Enviados" value={metricas.enviados} />
          <Mini title="Responderam" value={metricas.responderam} />
          <Mini title="Taxa resp." value={`${metricas.taxa_resposta}%`} />
        </div>
      )}

      {buscas.filter((b) => b.status === 'pendente' || b.status === 'processando').map((b) => (
        <div key={b.id} className="flex items-center gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
          <Spinner />
          <span>
            <strong>Busca em andamento</strong> — {b.nicho} em {b.cidade}. Os leads aparecem em alguns minutos; a lista atualiza sozinha.
          </span>
        </div>
      ))}

      <DataTableFrame
        className="overflow-hidden rounded-xl border bg-white shadow-sm"
        ariaLabel="Rolagem horizontal da tabela de prospecção"
      >
      <table className="w-full min-w-max text-sm">
        <thead className="bg-gray-100">
          <tr>
            <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Endereço" chave="endereco" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Aval." chave="aval" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Nota" chave="nota" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Horário" chave="horario" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Site" chave="site" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={ordenarPor} />
            <th className="text-left px-3 py-2">JSON</th>
            <th className="text-right px-3 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((p) => {
            const t = temperatura(p.score)
            const horario = !!p.json_apresentacao?.empresa?.horario_funcionamento
            return (
            <tr key={p.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{quando(p.created_at)}</td>
              <td className="px-3 py-2 font-medium">
                <span title={t.label} className="mr-1">{t.emoji}</span>
                {p.maps_url ? (
                  <a href={p.maps_url} target="_blank" rel="noreferrer"
                    className="text-brand hover:underline inline-flex items-center gap-1"
                    title="Ver ficha no Google Maps">
                    {p.nome} <span className="text-xs text-slate-400">↗</span>
                  </a>
                ) : p.nome}
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.telefone || '—'}</td>
              <td className="px-3 py-2 text-xs"><EmailEditavel value={p.email} onSave={(email) => salvarEmail(p.id, email)} /></td>
              <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate" title={p.endereco || ''}>{p.endereco || '—'}</td>
              <td className="px-3 py-2 text-slate-600 text-xs">{p.nicho} · {p.cidade}</td>
              <td className="px-3 py-2 text-right text-xs">{p.avaliacoes ?? '—'}</td>
              <td className="px-3 py-2 text-right text-xs">{p.rating != null ? Number(p.rating).toFixed(1) : '—'}</td>
              <td className="px-3 py-2 text-center">{horario ? '✅' : '❌'}</td>
              <td className="px-3 py-2">
                {p.site ? (
                  <a href={p.site} target="_blank" rel="noreferrer" className="hover:underline" title={p.site}>✅ <span className="text-xs text-brand">site</span></a>
                ) : p.tem_site ? '✅' : '❌'}
              </td>
              <td className="px-3 py-2 text-right">
                <span className={`font-semibold ${((p.score_cadastro ?? 0) <= 40) ? 'text-red-600' : (p.score_cadastro ?? 0) <= 70 ? 'text-amber-600' : 'text-emerald-600'}`}
                  title="Pontuação do cadastro (0-100): site 20 · fotos, endereço, telefone, e-mail, horário, links extras, avaliações e nota>4 valem 10 cada">
                  {p.score_cadastro ?? 0}
                </span>
                <span className="text-[10px] text-slate-400">/100</span>
              </td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[p.status] || p.status}</span>
              </td>
              <td className="px-3 py-2">
                {p.json_apresentacao && (
                  <button onClick={() => setJsonAberto({ titulo: p.nome, json: p.json_apresentacao! })}
                    className="text-xs px-2 py-1 rounded-lg border text-brand hover:bg-blue-50"
                    title="Dados unificados + prompt único pro bot gerar a saudação de análise">
                    {'{ }'}
                  </button>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {p.status === 'rejeitado' ? (
                  <button disabled={agindo === p.id}
                    onClick={() => acao(p.id, 'aprovar', 'Lead restaurado — voltou para a fila de disparo.')}
                    title="Traz o lead de volta para a fila de disparo (sai dos Descartados)."
                    className="inline-flex items-center gap-1.5 text-emerald-600 hover:underline disabled:opacity-40">
                    <IconUndo /> Restaurar</button>
                ) : (
                  <div className="inline-flex items-center gap-3">
                    {p.status === 'aguardando' && (
                      <button disabled={agindo === p.id}
                        onClick={() => acao(p.id, 'aprovar', 'Lead marcado como bom.')}
                        title="Marca como lead bom (opcional — ele já pode ser disparado sem isso)."
                        className="inline-flex items-center gap-1.5 text-emerald-600 hover:underline disabled:opacity-40">
                        <IconStar /> Marcar</button>
                    )}
                    <button disabled={agindo === p.id}
                      onClick={() => acao(p.id, 'rejeitar', 'Lead descartado — foi para a aba Descartados.')}
                      title="Remove o lead do disparo — vai para a aba Descartados no Banco de Leads."
                      className="inline-flex items-center gap-1.5 text-red-600 hover:underline disabled:opacity-40">
                      <IconTrash /> Descartar</button>
                  </div>
                )}
              </td>
            </tr>
            )
          })}
          {ordenados.length === 0 && (
            <tr><td colSpan={14} className="px-4 py-6 text-center text-gray-400">Nenhum prospect ainda. Configure a busca acima e clique em Buscar agora.</td></tr>
          )}
        </tbody>
      </table>
      </DataTableFrame>

      {jsonAberto && (
        <JsonLeadModal titulo={`JSON de apresentação — ${jsonAberto.titulo}`} json={jsonAberto.json} onFechar={() => setJsonAberto(null)} />
      )}

      {analytics && analytics.metricas.mensagens_enviadas > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border p-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analytics da prospecção · esta empresa</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Mini title="Enviados" value={analytics.metricas.mensagens_enviadas} />
            <Mini title="Respostas" value={analytics.metricas.respostas} />
            <Mini title="Taxa resp." value={`${analytics.metricas.taxa_resposta}%`} />
            <Mini title="Diagnóstico" value={analytics.metricas.diagnostico} />
            <Mini title="Reuniões" value={analytics.metricas.reunioes} />
            <Mini title="Fechados" value={analytics.metricas.fechados} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Destaque title="Melhor nicho" rank={analytics.melhores.categoria} />
            <Destaque title="Melhor cidade" rank={analytics.melhores.cidade} />
            <Destaque title="Melhor horário" rank={analytics.melhores.horario} />
          </div>
        </div>
      )}

      {resultados && (resultados.por_mercado.length > 0 || resultados.recentes.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Desempenho por mercado</p>
            {resultados.por_mercado.length === 0 ? (
              <p className="text-sm text-gray-400">Sem dados ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500">
                  <th className="py-1">Nicho / Cidade</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Enviados</th><th className="py-1 text-right">Resp.</th>
                </tr></thead>
                <tbody>
                  {resultados.por_mercado.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{m.nicho} · {m.cidade}</td>
                      <td className="py-1.5 text-right">{m.total}</td>
                      <td className="py-1.5 text-right">{m.enviados}</td>
                      <td className="py-1.5 text-right font-semibold text-orange-600">{m.responderam}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Responderam recentemente</p>
            {resultados.recentes.length === 0 ? (
              <p className="text-sm text-gray-400">Ninguém respondeu ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {resultados.recentes.map((r, i) => (
                  <li key={i} className="flex items-center justify-between text-sm border-t pt-1.5 first:border-0 first:pt-0">
                    <span><span className="font-medium">{r.nome}</span> <span className="text-slate-500">· {r.nicho} / {r.cidade}</span></span>
                    <span className="font-mono text-xs text-slate-500">{r.telefone || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

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

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-slate-500 mb-0.5">{label}</label>
      {children}
    </div>
  )
}
