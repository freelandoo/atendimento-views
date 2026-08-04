'use client'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'
import DataTableFrame from '@/components/ui/DataTableFrame'
import RotinasAquisicao, { type RotinasResp } from '@/components/RotinasAquisicao'
import AssistenteOportunidades from '@/components/AssistenteOportunidades'
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
type OpcaoFiltroMercado = { valor: string; total: number }
type FiltrosMercado = {
  nichos: OpcaoFiltroMercado[]
  categorias: OpcaoFiltroMercado[]
  cidades: OpcaoFiltroMercado[]
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

const LEADS_POR_BUSCA = 200
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
  const [buscas, setBuscas] = useState<Busca[]>([])
  const emAndamentoRef = useRef<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const [buscaDados, setBuscaDados] = useState('')
  const [mercado, setMercado] = useState('')
  const [cidadeFiltro, setCidadeFiltro] = useState('')
  const [filtrosMercado, setFiltrosMercado] = useState<FiltrosMercado | null>(null)
  const [agindo, setAgindo] = useState<string | null>(null)
  const [salvandoConfig, setSalvandoConfig] = useState(false)
  const [form, setForm] = useState<Partial<Config>>({})
  // As rotinas já carregadas pelo painel de rotinas, reaproveitadas pelo assistente
  // (que precisa dos valores atuais para pré-preencher um ajuste sem sobrescrever nada).
  const [dadosRotinas, setDadosRotinas] = useState<RotinasResp | null>(null)
  const [recarregarRotinas, setRecarregarRotinas] = useState(0)
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
    const p = new URLSearchParams({ limit: '100' })
    if (filtro) p.set('status', filtro)
    if (buscaDados.trim()) p.set('busca', buscaDados.trim())
    if (mercado) p.set('mercado', mercado)
    if (cidadeFiltro) p.set('cidade', cidadeFiltro)
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?${p.toString()}`)
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
  useEffect(() => { carregar() }, [empresaId, filtro, buscaDados, mercado, cidadeFiltro])
  useEffect(() => {
    if (!empresaId) return
    const p = new URLSearchParams()
    if (filtro) p.set('status', filtro)
    apiFetch<FiltrosMercado>(`/api/empresas/${empresaId}/prospeccao/filtros?${p.toString()}`)
      .then((r) => setFiltrosMercado(r.data || null)).catch(() => {})
  }, [empresaId, filtro])

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
      await persistirConfiguracao(patch)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a configuração da busca.')
    }
  }

  const mercadoOpcoes = opcoesMercado(filtrosMercado)
  const cidadeOpcoes = filtrosMercado?.cidades || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prospecção</h1>
        <p className="text-sm text-slate-500 mt-1">Configure a origem da busca e deixe o worker alimentar o Banco de Leads, mesmo fora desta tela.</p>
      </div>

      <RotinasAquisicao
        empresaId={empresaId}
        onColetaIniciada={carregarBuscas}
        onDados={setDadosRotinas}
        recarregarChave={recarregarRotinas}
      />

      <AssistenteOportunidades
        empresaId={empresaId}
        rotinas={dadosRotinas?.rotinas || []}
        limites={dadosRotinas?.limites}
        onRotinasAlteradas={() => setRecarregarRotinas((n) => n + 1)}
      />

      {/* Preferências que o assistente respeita ao propor um mercado NOVO. Elas já
          existiam (eram da Busca IA automática) e continuam valendo — o que mudou é que
          agora orientam uma sugestão, não uma coleta disparada sozinha. */}
      <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">Preferências do assistente</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Onde o assistente pode procurar oportunidades novas. Deixe em branco para não limitar.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Campo label="Estratégia"><select value={form.busca_estrategia || 'equilibrada'}
            onChange={(e) => salvarAjuste({ busca_estrategia: e.target.value as Config['busca_estrategia'] })}
            className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="conservadora">Conservadora — perto do que já funciona</option>
            <option value="equilibrada">Equilibrada — recomendada</option>
            <option value="exploratoria">Exploratória — testa mais mercados novos</option>
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
          <span><b>Permitir nichos relacionados</b>
            <span className="block text-xs text-slate-500">O assistente pode propor variações próximas dos nichos informados.</span>
          </span>
        </label>
        {salvandoConfig && <p className="text-xs text-brand">Salvando preferências…</p>}
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

      <div className="rounded-xl border bg-white px-3 py-3 shadow-sm">
        <div className="mb-2 text-xs font-medium text-slate-500">Filtrar leads encontrados</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 mb-1">Buscar dados</label>
            <input value={buscaDados} onChange={(e) => setBuscaDados(e.target.value)}
              placeholder="nome, telefone, endereço ou mercado" className="w-full border rounded-lg px-3 py-2 text-sm" />
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
          {(mercado || cidadeFiltro || buscaDados.trim()) && (
            <button onClick={() => { setMercado(''); setCidadeFiltro(''); setBuscaDados('') }}
              className="border rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Limpar filtros
            </button>
          )}
        </div>
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
