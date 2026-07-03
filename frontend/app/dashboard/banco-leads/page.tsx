'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiDownload, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'

// Banco de Leads — as duas origens em tabelas separadas (Google Places e
// Instagram), com as MESMAS colunas/pontuação/ordenação/JSON da Aquisição,
// agrupadas nos 3 estágios do funil. Consome /api/empresas/:id/banco-leads.
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
  score_cadastro: number | null; score_cadastro_max: number | null
  json_apresentacao: JsonApresLead | null
  created_at: string; updated_at: string
  bloqueado_ate: string | null; bloqueio_motivo: string | null
  rodado_em: string | null; rodado_por: string | null
}
type Ordem = { chave: string; dir: 'asc' | 'desc' }
type Resumo = { abas: Record<string, number>; por_status: Record<string, number> }
type Instancia = {
  id: string; evolution_instance: string; nome?: string | null
  ativo: boolean; config_json?: { saudacao?: string } | null
}
type RodarResumo = {
  rodada: boolean
  aceitos: { id: string; nome: string }[]
  pulados: { id: string; motivo: string }[]
  teto_restante: number
  total_dia: number
}

const MAX_LOTE = 15
const STATUS_RODAVEL = new Set(['coletado', 'contato_encontrado', 'aguardando', 'aprovado'])

const ABAS: { valor: string; label: string }[] = [
  { valor: 'sem_contato', label: 'Sem contato ainda' },
  { valor: 'conversou', label: 'Já conversou' },
  { valor: 'fecharam', label: 'Fecharam' },
]
const ORIGENS: { valor: string; label: string }[] = [
  { valor: '', label: 'Todas as origens' },
  { valor: 'places', label: 'Google Places' },
  { valor: 'social', label: 'Instagram' },
]
const STATUS_STYLE: Record<string, string> = {
  coletado: 'bg-slate-100 text-slate-600',
  contato_encontrado: 'bg-amber-100 text-amber-700',
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
  fechado: 'bg-violet-100 text-violet-700',
}
const MOTIVO_LABEL: Record<string, string> = {
  rejeicao: 'rejeição', sem_resposta: 'sem resposta',
}

function isLocked(l: Lead): boolean {
  return !!(l.bloqueado_ate && new Date(l.bloqueado_ate).getTime() > Date.now())
}
function isRodavel(l: Lead): boolean {
  return STATUS_RODAVEL.has(l.status) && !isLocked(l) && !!String(l.telefone || '').trim()
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
    case 'pontos': return l.score_cadastro ?? 0
    case 'status': return l.status || ''
    default: return 0
  }
}

function ordenarLeads(lista: Lead[], ordem: Ordem): Lead[] {
  return [...lista].sort((a, b) => {
    const va = valorColuna(a, ordem.chave)
    const vb = valorColuna(b, ordem.chave)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
    return ordem.dir === 'asc' ? cmp : -cmp
  })
}

export default function BancoLeadsPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/banco-leads`

  const [aba, setAba] = useState('sem_contato')
  const [origem, setOrigem] = useState('')
  const [busca, setBusca] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [limpando, setLimpando] = useState(false)
  // Rodar leads
  const [instancias, setInstancias] = useState<Instancia[]>([])
  const [instanciaId, setInstanciaId] = useState('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [rodando, setRodando] = useState(false)
  const [saudacaoOpen, setSaudacaoOpen] = useState(false)
  const [cadastroOpen, setCadastroOpen] = useState(false)
  // Ordenação independente por tabela — mesmos defaults da Aquisição:
  // Places = menos pontos no topo; Instagram = mais seguidores no topo.
  const [ordemPlaces, setOrdemPlaces] = useState<Ordem>({ chave: 'pontos', dir: 'asc' })
  const [ordemIg, setOrdemIg] = useState<Ordem>({ chave: 'seguidores', dir: 'desc' })
  const [jsonAberto, setJsonAberto] = useState<{ titulo: string; json: JsonApresLead } | null>(null)
  const fb = useFeedback()

  function query() {
    const p = new URLSearchParams({ aba })
    if (origem) p.set('origem', origem)
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

  const carregarLeads = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    try {
      const p = new URLSearchParams({ aba })
      if (origem) p.set('origem', origem)
      if (busca.trim()) p.set('busca', busca.trim())
      const r = await apiFetch<Lead[]>(`${base}/leads?${p.toString()}`)
      setLeads(r.data || [])
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar leads.') }
    finally { setCarregando(false) }
  }, [base, empresaId, aba, origem, busca])

  const carregarInstancias = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Instancia[]>(`/api/empresas/${empresaId}/whatsapp`)
      const ativas = (r.data || []).filter((i) => i.ativo)
      setInstancias(ativas)
      setInstanciaId((cur) => cur || (ativas[0]?.id ?? ''))
    } catch { /* silencioso */ }
  }, [empresaId])

  useEffect(() => { carregarResumo() }, [carregarResumo])
  useEffect(() => { carregarLeads() }, [carregarLeads])
  useEffect(() => { carregarInstancias() }, [carregarInstancias])
  // Limpa a seleção ao trocar de aba/filtro (os ids podem sair da lista).
  useEffect(() => { setSelecionados(new Set()) }, [aba, origem, busca])

  const instanciaSel = useMemo(() => instancias.find((i) => i.id === instanciaId) || null, [instancias, instanciaId])
  const rodaveis = useMemo(() => leads.filter(isRodavel), [leads])
  // Divisão por origem: Places (manual/automático) × Instagram (social).
  const leadsPlaces = useMemo(() => ordenarLeads(leads.filter((l) => ORIGENS_PLACES.has(l.origem)), ordemPlaces), [leads, ordemPlaces])
  const leadsIg = useMemo(() => ordenarLeads(leads.filter((l) => !ORIGENS_PLACES.has(l.origem)), ordemIg), [leads, ordemIg])

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

  async function rodar() {
    if (!instanciaId) { fb.toast('Escolha uma instância para rodar.', 'error'); return }
    const ids = [...selecionados]
    if (!ids.length) { fb.toast('Selecione ao menos um lead.', 'error'); return }
    setRodando(true)
    try {
      const r = await apiFetch<RodarResumo>(`${base}/rodar`, {
        method: 'POST',
        body: JSON.stringify({ instancia_id: instanciaId, prospect_ids: ids }),
      })
      const d = r.data
      const puladosTxt = d.pulados.length ? ` · ${d.pulados.length} pulado(s)` : ''
      fb.sucessoModal(
        'Rodada iniciada',
        `${d.aceitos.length} lead(s) entrando na fila de envio${puladosTxt}. Restam ${d.teto_restante} disparos hoje nesta instância.`
      )
      setSelecionados(new Set())
      // Os envios saem em background com espaçamento — recarrega depois de um tempo.
      setTimeout(() => { carregarLeads(); carregarResumo() }, 3000)
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Falha ao rodar leads.', 'error')
    } finally { setRodando(false) }
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Banco de Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            Todos os leads das duas origens em um só lugar: quem ainda não foi abordado,
            quem já conversou e quem fechou. Selecione e rode a saudação pela instância escolhida.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setCadastroOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark">
            ＋ Adicionar cadastro
          </button>
          <button onClick={limpar} disabled={limpando}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            title="Apaga todos os leads sem e-mail e sem telefone (negócios fechados são preservados)">
            {limpando && <Spinner />}
            {limpando ? 'Limpando…' : '🧹 Limpeza'}
          </button>
          <button onClick={exportar} disabled={exportando || !leads.length}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {exportando && <Spinner />}
            {exportando ? 'Gerando…' : '⬇ Exportar CSV'}
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

      {/* Barra "Rodar leads" — só na aba Sem contato */}
      {mostrarRodar && (
        <div className="bg-white border rounded-2xl shadow-sm p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Rodar leads com</label>
            <select value={instanciaId} onChange={(e) => setInstanciaId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm min-w-[200px]">
              {!instancias.length && <option value="">Nenhuma instância ativa</option>}
              {instancias.map((i) => (
                <option key={i.id} value={i.id}>{i.nome || i.evolution_instance}</option>
              ))}
            </select>
          </div>
          <button onClick={() => setSaudacaoOpen(true)} disabled={!instanciaId}
            className="px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            ✏️ Saudação — teste e edição
          </button>
          <button onClick={selecionarLote} disabled={!rodaveis.length}
            className="px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            Selecionar {Math.min(MAX_LOTE, rodaveis.length)}
          </button>
          <div className="flex-1" />
          <button onClick={rodar} disabled={rodando || !selecionados.size || !instanciaId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50">
            {rodando && <Spinner />}
            {rodando ? 'Rodando…' : `▶ Rodar (${selecionados.size})`}
          </button>
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
      </div>

      {/* Tabelas por origem — mesmas colunas/pontuação/ordenação/JSON da Aquisição */}
      {carregando && !leads.length ? (
        <p className="text-sm text-slate-400 text-center py-8">Carregando…</p>
      ) : !leads.length ? (
        <p className="text-sm text-slate-400 text-center py-8">Nenhum lead nesta aba.</p>
      ) : (
        <>
          {leadsPlaces.length > 0 && (
            <TabelaPlacesBanco
              leads={leadsPlaces}
              ordem={ordemPlaces}
              onOrdenar={(chave) => setOrdemPlaces((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))}
              mostrarRodar={mostrarRodar}
              selecionados={selecionados}
              onToggleSel={toggleSel}
              onSalvarEmail={salvarEmail}
              onFechar={fechar}
              onReabrir={reabrir}
              onAbrirJson={(l) => l.json_apresentacao && setJsonAberto({ titulo: l.nome, json: l.json_apresentacao })}
            />
          )}
          {leadsIg.length > 0 && (
            <TabelaInstagramBanco
              leads={leadsIg}
              ordem={ordemIg}
              onOrdenar={(chave) => setOrdemIg((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))}
              mostrarRodar={mostrarRodar}
              selecionados={selecionados}
              onToggleSel={toggleSel}
              onSalvarEmail={salvarEmail}
              onFechar={fechar}
              onReabrir={reabrir}
              onAbrirJson={(l) => l.json_apresentacao && setJsonAberto({ titulo: l.nome, json: l.json_apresentacao })}
            />
          )}
        </>
      )}

      {jsonAberto && (
        <JsonLeadModal titulo={`JSON de apresentação — ${jsonAberto.titulo}`} json={jsonAberto.json} onFechar={() => setJsonAberto(null)} />
      )}

      {cadastroOpen && (
        <CadastroModal
          base={base}
          onClose={() => setCadastroOpen(false)}
          onSaved={() => { setCadastroOpen(false); carregarLeads(); carregarResumo() }}
        />
      )}

      {saudacaoOpen && instanciaSel && (
        <SaudacaoModal
          empresaId={empresaId}
          instancia={instanciaSel}
          onClose={() => setSaudacaoOpen(false)}
          onSaved={(texto) => {
            setInstancias((prev) => prev.map((i) => (i.id === instanciaSel.id ? { ...i, config_json: { ...(i.config_json || {}), saudacao: texto } } : i)))
          }}
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
  selecionados: Set<string>
  onToggleSel: (id: string) => void
  onSalvarEmail: (id: string, email: string) => Promise<void>
  onFechar: (id: string) => void
  onReabrir: (id: string) => void
  onAbrirJson: (l: Lead) => void
}

// Célula de status compartilhada (badge + trava + último disparo).
function StatusCelula({ l }: { l: Lead }) {
  const locked = isLocked(l)
  return (
    <td className="px-3 py-2">
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[l.status] || 'bg-slate-100 text-slate-600'}`}>
        {l.status}
      </span>
      {locked && (
        <div className="text-[11px] text-red-600 mt-1">
          🔒 travado até {fmtData(l.bloqueado_ate)}{l.bloqueio_motivo ? ` (${MOTIVO_LABEL[l.bloqueio_motivo] || l.bloqueio_motivo})` : ''}
        </div>
      )}
      {l.rodado_em && (
        <div className="text-[11px] text-slate-400 mt-0.5">
          rodado{l.rodado_por ? ` por ${l.rodado_por}` : ''} em {fmtData(l.rodado_em)}
        </div>
      )}
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

function AcaoCelula({ l, onFechar, onReabrir }: { l: Lead; onFechar: (id: string) => void; onReabrir: (id: string) => void }) {
  return (
    <td className="px-3 py-2 text-right whitespace-nowrap">
      {l.status === 'fechado' ? (
        <button onClick={() => onReabrir(l.id)}
          className="px-2.5 py-1 rounded-lg border text-xs font-medium hover:bg-slate-50">
          Reabrir
        </button>
      ) : (
        <button onClick={() => onFechar(l.id)}
          className="px-2.5 py-1 rounded-lg border border-violet-300 text-violet-700 text-xs font-medium hover:bg-violet-50">
          ✓ Fechou
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

function TabelaPlacesBanco({ leads, ordem, onOrdenar, mostrarRodar, selecionados, onToggleSel, onSalvarEmail, onFechar, onReabrir, onAbrirJson }: TabelaProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <h2 className="text-sm font-semibold">Google Places</h2>
        <span className="text-xs text-slate-400">{leads.length} lead{leads.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {mostrarRodar && <th className="px-3 py-2 w-8" />}
              <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Endereço" chave="endereco" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Aval." chave="aval" ordem={ordem} onOrdenar={onOrdenar} align="right" />
              <ThOrdenavel label="Nota" chave="nota" ordem={ordem} onOrdenar={onOrdenar} align="right" />
              <ThOrdenavel label="Horário" chave="horario" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Site" chave="site" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={onOrdenar} align="right" />
              <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={onOrdenar} />
              <th className="text-left px-3 py-2">JSON</th>
              <th className="text-right px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => {
              const horario = !!l.json_apresentacao?.empresa?.horario_funcionamento
              return (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  {mostrarRodar && <SelCelula l={l} selecionados={selecionados} onToggleSel={onToggleSel} />}
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDataHora(l.created_at)}</td>
                  <td className="px-3 py-2 font-medium">
                    {l.maps_url ? (
                      <a href={l.maps_url} target="_blank" rel="noreferrer"
                        className="text-brand hover:underline inline-flex items-center gap-1" title="Ver ficha no Google Maps">
                        {l.nome} <span className="text-xs text-slate-400">↗</span>
                      </a>
                    ) : (l.nome || '—')}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{l.telefone || '—'}</td>
                  <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => onSalvarEmail(l.id, email)} /></td>
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate" title={l.endereco || ''}>{l.endereco || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">{[l.nicho, l.cidade].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs">{l.avaliacoes ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs">{l.rating != null ? Number(l.rating).toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-center">{horario ? '✅' : '❌'}</td>
                  <td className="px-3 py-2">
                    {l.site ? (
                      <a href={l.site} target="_blank" rel="noreferrer" className="hover:underline" title={l.site}>✅ <span className="text-xs text-brand">site</span></a>
                    ) : l.tem_site ? '✅' : '❌'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-semibold ${((l.score_cadastro ?? 0) <= 40) ? 'text-red-600' : (l.score_cadastro ?? 0) <= 70 ? 'text-amber-600' : 'text-emerald-600'}`}
                      title="Pontuação do cadastro (0-100): site 20 · fotos, endereço, telefone, e-mail, horário, links extras, avaliações e nota>4 valem 10 cada">
                      {l.score_cadastro ?? 0}
                    </span>
                    <span className="text-[10px] text-slate-400">/100</span>
                  </td>
                  <StatusCelula l={l} />
                  <JsonCelula l={l} onAbrirJson={onAbrirJson} />
                  <AcaoCelula l={l} onFechar={onFechar} onReabrir={onReabrir} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabelaInstagramBanco({ leads, ordem, onOrdenar, mostrarRodar, selecionados, onToggleSel, onSalvarEmail, onFechar, onReabrir, onAbrirJson }: TabelaProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <h2 className="text-sm font-semibold">Instagram</h2>
        <span className="text-xs text-slate-400">{leads.length} lead{leads.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {mostrarRodar && <th className="px-3 py-2 w-8" />}
              <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="@username" chave="username" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Nicho" chave="nicho" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Seguidores" chave="seguidores" ordem={ordem} onOrdenar={onOrdenar} align="right" />
              <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Links" chave="links" ordem={ordem} onOrdenar={onOrdenar} />
              <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={onOrdenar} align="right" />
              <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={onOrdenar} />
              <th className="text-left px-3 py-2">JSON</th>
              <th className="text-right px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60 align-top">
                {mostrarRodar && <SelCelula l={l} selecionados={selecionados} onToggleSel={onToggleSel} />}
                <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDataHora(l.created_at)}</td>
                <td className="px-3 py-2 font-medium text-slate-900 max-w-[200px] truncate" title={l.bio || l.nome}>{l.nome || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {l.instagram_handle ? (
                    <a href={`https://instagram.com/${l.instagram_handle.replace(/^@/, '')}`} target="_blank" rel="noreferrer"
                      className="text-brand hover:underline">@{l.instagram_handle.replace(/^@/, '')}</a>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={[l.nicho, l.categoria_perfil, l.cidade].filter(Boolean).join(' · ')}>
                  {l.nicho || l.categoria_perfil || '—'}
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold">{l.seguidores != null ? l.seguidores.toLocaleString('pt-BR') : '—'}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{l.telefone || '—'}</td>
                <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => onSalvarEmail(l.id, email)} /></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-slate-500 underline mr-2">bio</a>}
                  {l.site && <a href={l.site} target="_blank" rel="noreferrer" className="text-slate-500 underline">site</a>}
                  {!l.link_bio && !l.site && '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-semibold ${((l.score_cadastro ?? 0) <= 20) ? 'text-red-600' : (l.score_cadastro ?? 0) <= 40 ? 'text-amber-600' : 'text-emerald-600'}`}
                    title="Pontuação do cadastro: 10 pontos por coluna (nicho, seguidores, telefone, e-mail, links, @username)">
                    {l.score_cadastro ?? 0}
                  </span>
                  <span className="text-[10px] text-slate-400">/{l.score_cadastro_max ?? 60}</span>
                </td>
                <StatusCelula l={l} />
                <JsonCelula l={l} onAbrirJson={onAbrirJson} />
                <AcaoCelula l={l} onFechar={onFechar} onReabrir={onReabrir} />
              </tr>
            ))}
          </tbody>
        </table>
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

// ─── Modal Saudação — editar template da instância + testar no seu número ──────
function SaudacaoModal({ empresaId, instancia, onClose, onSaved }: {
  empresaId: string
  instancia: Instancia
  onClose: () => void
  onSaved: (texto: string) => void
}) {
  const [texto, setTexto] = useState(instancia.config_json?.saudacao || '')
  const [numeroTeste, setNumeroTeste] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const fb = useFeedback()
  const baseInst = `/api/empresas/${empresaId}/whatsapp/${instancia.id}`

  async function salvar() {
    setSalvando(true)
    try {
      await fb.runTask(() => apiFetch(baseInst, { method: 'PATCH', body: JSON.stringify({ saudacao: texto }) }),
        { sucesso: 'Saudação salva.' })
      onSaved(texto)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSalvando(false) }
  }

  async function testar() {
    if (numeroTeste.replace(/\D/g, '').length < 10) { fb.toast('Informe um número de teste com DDD.', 'error'); return }
    setTestando(true)
    try {
      await fb.runTask(() => apiFetch(`${baseInst}/saudacao/testar`, {
        method: 'POST', body: JSON.stringify({ numero_teste: numeroTeste, saudacao: texto }),
      }), { sucesso: 'Mensagem de teste enviada pro seu WhatsApp.' })
    } catch { /* erro já exibido pelo feedback */ }
    finally { setTestando(false) }
  }

  const preview = texto
    .replace(/\{nome\}/gi, 'Padaria Exemplo').replace(/\{empresa\}/gi, 'Padaria Exemplo')
    .replace(/\{cidade\}/gi, 'São Paulo').replace(/\{nicho\}/gi, 'padaria').trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Saudação — {instancia.nome || instancia.evolution_instance}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Primeira mensagem enviada ao rodar os leads por esta instância.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">Texto da saudação</label>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5}
            placeholder="Oi {nome}, tudo bem? Vi a {empresa} aqui em {cidade}…"
            className="w-full border rounded-lg px-3 py-2 text-sm" />
          <p className="text-[11px] text-slate-400 mt-1">
            Variáveis: <code>{'{nome}'}</code> <code>{'{empresa}'}</code> <code>{'{cidade}'}</code> <code>{'{nicho}'}</code>
          </p>
        </div>

        {preview && (
          <div className="rounded-lg bg-slate-50 border px-3 py-2 text-xs text-slate-600">
            <span className="text-slate-400">Preview: </span>{preview}
          </div>
        )}

        <div className="flex items-end gap-2 border-t pt-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Seu número (teste)</label>
            <input value={numeroTeste} onChange={(e) => setNumeroTeste(e.target.value)}
              placeholder="ex: 5511999998888" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={testar} disabled={testando}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            {testando && <Spinner size={13} />}
            {testando ? 'Enviando…' : 'Testar'}
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border text-sm">Fechar</button>
          <button onClick={salvar} disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-dark disabled:opacity-50">
            {salvando && <Spinner size={13} />}
            {salvando ? 'Salvando…' : 'Salvar saudação'}
          </button>
        </div>
      </div>
    </div>
  )
}
