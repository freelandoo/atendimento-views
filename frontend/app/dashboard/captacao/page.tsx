'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import NeonProgress from '@/components/ui/NeonProgress'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'
import DataTableFrame from '@/components/ui/DataTableFrame'
import { IconEnvelope, IconPlay } from '@/components/ui/icons'

type CampanhaMeta = {
  perfis_semente?: string[]
  usar_cse?: boolean
  usar_snowball?: boolean
  seguir_link_bio?: boolean
  agendamento_ativo?: boolean
  intervalo_horas?: number
  janela_inicio?: string
  janela_fim?: string
  dias_semana?: number[]
}
type Campanha = {
  id: string; fonte: string; termo: string; nicho: string | null; cidade: string | null
  teto_diario: number; ativo: boolean; ultima_coleta_em: string | null
  metadata_json: CampanhaMeta | null
}
type Lead = {
  id: string; origem: string; external_ref: string | null; instagram_handle: string | null; nome: string
  telefone: string | null; email: string | null; nicho: string | null; cidade: string | null
  bio: string | null; link_bio: string | null; categoria_perfil: string | null
  seguidores: number | null; site: string | null; status: string; created_at: string; updated_at: string
  score_cadastro: number | null; score_cadastro_max: number | null
  json_apresentacao: JsonApresentacao | null
}

// Valor de cada coluna pra ordenação (clique no cabeçalho alterna asc/desc).
function valorColunaLead(l: Lead, chave: string): number | string {
  switch (chave) {
    case 'entrou': return l.created_at || ''
    case 'nome': return (l.nome || '').toLowerCase()
    case 'username': return (l.instagram_handle || '').toLowerCase()
    case 'nicho': return (l.nicho || l.categoria_perfil || '').toLowerCase()
    case 'seguidores': return l.seguidores ?? -1
    case 'telefone': return l.telefone || ''
    case 'email': return l.email || ''
    case 'links': return (l.link_bio || l.site) ? 1 : 0
    case 'pontos': return l.score_cadastro ?? 0
    case 'status': return l.status || ''
    default: return 0
  }
}
type Orcamento = {
  teto_diario_global: number; consumido_hoje: number; restante_hoje: number; brightdata_configurado: boolean
}
type Funil = { abas: Record<string, number>; por_status: Record<string, number> }
type Snapshot = {
  id: string; fonte: string; etapa: string; status: string; termo: string | null
  custo_registros: number; total_prospects: number; erro: string | null; created_at: string
}

const ABAS: { valor: string; label: string }[] = [
  { valor: 'entrada', label: 'Entrada' },
  { valor: 'coletados', label: 'Coletados' },
  { valor: 'em_andamento', label: 'Em andamento' },
  { valor: 'descartados', label: 'Descartados' },
]
const STATUS_STYLE: Record<string, string> = {
  coletado: 'bg-slate-100 text-slate-600',
  contato_encontrado: 'bg-amber-100 text-amber-700',
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
  rejeitado: 'bg-red-100 text-red-600',
  nao_contatar: 'bg-red-100 text-red-600',
}

// Estado dos toggles + limite usado pela Agenda e pela edição de campanha.
type Opcoes = { usar_cse: boolean; usar_snowball: boolean; seguir_link_bio: boolean }
const OPCOES_PADRAO: Opcoes = { usar_cse: true, usar_snowball: true, seguir_link_bio: true }

// Agenda de disparo automático (a cada X horas, dentro de janela/dias).
type Agenda = {
  agendamento_ativo: boolean; intervalo_horas: number
  janela_inicio: string; janela_fim: string; dias_semana: number[]
}
const AGENDA_PADRAO: Agenda = {
  agendamento_ativo: false, intervalo_horas: 24,
  janela_inicio: '08:00', janela_fim: '18:00', dias_semana: [1, 2, 3, 4, 5],
}
const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

// Data/hora "Entrou em": registro de quando o lead caiu no funil.
function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function CaptacaoPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/captacao`

  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null)
  const [funil, setFunil] = useState<Funil | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [aba, setAba] = useState('entrada')
  // Ordenação: default = MAIS seguidores no topo. Clique no cabeçalho alterna.
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' }>({ chave: 'seguidores', dir: 'desc' })
  const [jsonAberto, setJsonAberto] = useState<{ titulo: string; json: JsonApresentacao } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [progresso, setProgresso] = useState<number | null>(null)
  const [emailConfigurado, setEmailConfigurado] = useState(false)

  // Barra neon (mesma do login/Places): sobe enquanto qualquer coleta/processamento
  // roda (carregando) e completa em 100% ao terminar.
  useEffect(() => {
    if (!carregando) return
    setProgresso(8)
    const timer = setInterval(() => {
      setProgresso((p) => (p == null || p >= 90 ? p : p + Math.max(1, Math.round((90 - p) * 0.12))))
    }, 400)
    return () => {
      clearInterval(timer)
      setProgresso(100)
      setTimeout(() => setProgresso((p) => (p === 100 ? null : p)), 700)
    }
  }, [carregando])

  // Menu operacional: filtros da coleta e frequência ficam visíveis na própria tela.
  const [agNicho, setAgNicho] = useState('')
  const [agCidade, setAgCidade] = useState('')
  const [agPerfis, setAgPerfis] = useState('')
  const [agLimite, setAgLimite] = useState('')
  const [agOpcoes, setAgOpcoes] = useState<Opcoes>(OPCOES_PADRAO)
  const [agAgenda, setAgAgenda] = useState<Agenda>(AGENDA_PADRAO)

  // Edição de campanha existente
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    nicho: string; cidade: string; perfis: string; teto: string; ativo: boolean; opcoes: Opcoes; agenda: Agenda
  }>({ nicho: '', cidade: '', perfis: '', teto: '50', ativo: true, opcoes: OPCOES_PADRAO, agenda: AGENDA_PADRAO })

  const fb = useFeedback()
  const podeColetar = !!orcamento?.brightdata_configurado

  function ordenarPor(chave: string) {
    setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))
  }
  const leadsOrdenados = [...leads].sort((a, b) => {
    const va = valorColunaLead(a, ordem.chave)
    const vb = valorColunaLead(b, ordem.chave)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
    return ordem.dir === 'asc' ? cmp : -cmp
  })

  const carregarMeta = useCallback(async () => {
    if (!empresaId) return
    try {
      const [c, o, f, s] = await Promise.all([
        apiFetch<Campanha[]>(`${base}/campanhas`),
        apiFetch<Orcamento>(`${base}/orcamento`),
        apiFetch<Funil>(`${base}/funil`),
        apiFetch<Snapshot[]>(`${base}/snapshots`),
      ])
      setCampanhas(c.data || [])
      setOrcamento(o.data)
      setFunil(f.data)
      setSnapshots(s.data || [])
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar.') }
  }, [base, empresaId])

  const carregarLeads = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Lead[]>(`${base}/leads?aba=${aba}`)
      setLeads(r.data || [])
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar leads.') }
  }, [base, aba, empresaId])

  useEffect(() => { carregarMeta() }, [carregarMeta])
  useEffect(() => { carregarLeads() }, [carregarLeads])
  useEffect(() => {
    if (!empresaId) return
    apiFetch<{ configurado: boolean }>(`${base}/email/status`)
      .then((r) => setEmailConfigurado(!!r.data?.configurado)).catch(() => {})
  }, [base, empresaId])

  // Primeiro o Google acha os perfis do nicho, depois o scraping
  // do Instagram roda em bola de neve. Se o agendamento estiver ligado, persiste uma
  // campanha recorrente (a cada X horas) usando o scheduler já existente.
  async function rodarAgenda() {
    if (!agNicho.trim() && !agPerfis.trim()) {
      setErro('Informe um nicho (busca no Google) ou ao menos 1 @perfil semente.')
      return
    }
    setErro(null)
    setCarregando(true)
    try {
      await fb.runTask(async () => {
        // 1) Roda agora: Google (CSE) → bola de neve no Instagram.
        await apiFetch(`${base}/coletar`, {
          method: 'POST',
          body: JSON.stringify({
            fonte: 'instagram',
            nicho: agNicho || undefined,
            cidade: agCidade || undefined,
            perfis: agPerfis || undefined,
            usar_cse: true,
            usar_snowball: true,
            seguir_link_bio: agOpcoes.seguir_link_bio,
            limite: agLimite ? Number(agLimite) : undefined,
          }),
        })
        // 2) Se agendado, salva a campanha recorrente.
        if (agAgenda.agendamento_ativo) {
          await apiFetch(`${base}/campanhas`, {
            method: 'POST',
            body: JSON.stringify({
              fonte: 'instagram',
              nicho: agNicho || undefined,
              cidade: agCidade || undefined,
              perfis_semente: agPerfis || undefined,
              teto_diario: agLimite ? Number(agLimite) : 50,
              ativo: true,
              usar_cse: true,
              usar_snowball: true,
              seguir_link_bio: agOpcoes.seguir_link_bio,
              ...agAgenda,
            }),
          })
        }
      }, {
        pesada: true,
        sucesso: agAgenda.agendamento_ativo ? 'Coleta iniciada e agenda salva' : 'Coleta iniciada',
        detalhe: 'Os perfis aparecem nas abas conforme o scraper responde.',
      })
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCarregando(false) }
  }

  function abrirEdicao(c: Campanha) {
    const m = c.metadata_json || {}
    setEditId(c.id)
    setEditForm({
      nicho: c.nicho || '',
      cidade: c.cidade || '',
      perfis: (m.perfis_semente || []).join('\n'),
      teto: String(c.teto_diario ?? 50),
      ativo: !!c.ativo,
      opcoes: {
        usar_cse: m.usar_cse ?? true,
        usar_snowball: m.usar_snowball ?? true,
        seguir_link_bio: m.seguir_link_bio ?? true,
      },
      agenda: {
        agendamento_ativo: m.agendamento_ativo ?? false,
        intervalo_horas: m.intervalo_horas ?? 24,
        janela_inicio: m.janela_inicio ?? '08:00',
        janela_fim: m.janela_fim ?? '18:00',
        dias_semana: m.dias_semana ?? [1, 2, 3, 4, 5],
      },
    })
  }

  async function salvarEdicao(id: string) {
    try {
      await fb.runTask(() => apiFetch(`${base}/campanhas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nicho: editForm.nicho || undefined,
          cidade: editForm.cidade || undefined,
          perfis_semente: editForm.perfis || undefined,
          teto_diario: Number(editForm.teto) || undefined,
          ativo: editForm.ativo,
          usar_cse: editForm.opcoes.usar_cse,
          usar_snowball: editForm.opcoes.usar_snowball,
          seguir_link_bio: editForm.opcoes.seguir_link_bio,
          ...editForm.agenda,
        }),
      }), { sucesso: 'Campanha atualizada.' })
      setEditId(null)
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function excluirCampanha(id: string) {
    if (!window.confirm('Excluir esta campanha? Os leads já coletados permanecem no funil.')) return
    try {
      await fb.runTask(() => apiFetch(`${base}/campanhas/${id}`, { method: 'DELETE' }), { sucesso: 'Campanha excluída.' })
      if (editId === id) setEditId(null)
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function coletarCampanha(id: string) {
    setCarregando(true)
    try {
      await fb.runTask(() => apiFetch(`${base}/coletar`, { method: 'POST', body: JSON.stringify({ campanha_id: id }) }), {
        pesada: true,
        sucesso: 'Coleta iniciada',
        detalhe: 'Os perfis aparecem nas abas conforme o scraper responde.',
      })
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCarregando(false) }
  }

  async function processar() {
    setCarregando(true)
    try {
      await fb.runTask(async () => {
        await apiFetch(`${base}/processar`, { method: 'POST' })
        await carregarMeta(); await carregarLeads()
      }, { sucesso: 'Coletas atualizadas.' })
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCarregando(false) }
  }

  async function mudarStatus(id: string, status: string) {
    try {
      await fb.runTask(() => apiFetch(`${base}/leads/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
        { sucesso: 'Status atualizado.' })
      setLeads((prev) => prev.filter((l) => l.id !== id))
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`${base}/leads/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, email: email || null } : l)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Captação (Instagram)</h1>
          <p className="text-sm text-slate-500 mt-1">
            O Google encontra perfis do nicho e o worker do Instagram expande a coleta em segundo plano.
          </p>
        </div>
        <button onClick={processar} disabled={carregando}
          className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          {carregando && <Spinner />}
          {carregando ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Modo da coleta</label>
            <select value={agAgenda.agendamento_ativo ? 'automatico' : 'manual'} disabled={carregando}
              onChange={(e) => setAgAgenda((a) => ({ ...a, agendamento_ativo: e.target.value === 'automatico' }))}
              className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60">
              <option value="manual">Manual</option>
              <option value="automatico">Automática</option>
            </select>
            <div className={`mt-2 flex items-start gap-2 text-xs ${agAgenda.agendamento_ativo ? 'text-emerald-700' : 'text-slate-500'}`}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${agAgenda.agendamento_ativo ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span>{agAgenda.agendamento_ativo
                ? 'Ao iniciar, a campanha fica salva e o worker repete a coleta.'
                : 'A coleta acontece somente quando você clicar em Coletar agora.'}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nicho (busca no Google)" value={agNicho} onChange={setAgNicho} placeholder="ex: arquitetura de interiores" />
            <Field label="Cidade" value={agCidade} onChange={setAgCidade} placeholder="ex: São Paulo" />
            <div>
              <label className="block text-xs text-slate-500 mb-1">Limite</label>
              <input type="number" min={1} max={200} value={agLimite} onChange={(e) => setAgLimite(e.target.value)}
                placeholder="orçamento disponível" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-1">@perfis semente (um por linha ou separados por vírgula)</label>
          <textarea value={agPerfis} onChange={(e) => setAgPerfis(e.target.value)} rows={2}
            placeholder="@studioabc, @casadecor"
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono" />
        </div>

        <Toggles value={agOpcoes} onChange={setAgOpcoes} />

        {agAgenda.agendamento_ativo && (
          <AgendaCampanha value={agAgenda} onChange={setAgAgenda} mostrarAtivacao={false} />
        )}

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Google CSE e bola de neve usam o orçamento diário disponível; nenhum WhatsApp é enviado nesta página.</p>
          <button onClick={rodarAgenda} disabled={carregando || !podeColetar}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {carregando ? <Spinner /> : <IconPlay />}{carregando ? 'Iniciando coleta…' : 'Coletar agora'}
          </button>
        </div>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {msg && <p className="text-emerald-600 text-sm">{msg}</p>}

      {orcamento && !orcamento.brightdata_configurado && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Bright Data ainda não configurado (defina <code>BRIGHTDATA_API_TOKEN</code> e os datasets). A coleta fica indisponível até lá.
        </div>
      )}

      {/* Orçamento */}
      {orcamento && (
        <div className="grid grid-cols-3 gap-3">
          <Mini title="Teto diário" value={orcamento.teto_diario_global} />
          <Mini title="Consumido hoje" value={orcamento.consumido_hoje} />
          <Mini title="Restante hoje" value={orcamento.restante_hoje} />
        </div>
      )}

      {/* Campanhas salvas (gestão das agendas já criadas) */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campanhas salvas</p>

        {campanhas.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma campanha salva ainda. Selecione o modo Automática acima e inicie a primeira coleta.</p>
        ) : (
          <div className="space-y-2">
            {campanhas.map((c) => (
              <div key={c.id} className="rounded-xl border p-3">
                {editId === c.id ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Nicho" value={editForm.nicho} onChange={(v) => setEditForm((p) => ({ ...p, nicho: v }))} />
                      <Field label="Cidade" value={editForm.cidade} onChange={(v) => setEditForm((p) => ({ ...p, cidade: v }))} />
                      <div className="w-28">
                        <label className="block text-xs text-slate-500 mb-1">Teto/dia</label>
                        <input type="number" min={1} value={editForm.teto}
                          onChange={(e) => setEditForm((p) => ({ ...p, teto: e.target.value }))}
                          className="w-full border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <label className="flex items-center gap-2 text-sm py-2">
                        <input type="checkbox" checked={editForm.ativo}
                          onChange={(e) => setEditForm((p) => ({ ...p, ativo: e.target.checked }))} /> Ativa
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">@perfis semente</label>
                      <textarea value={editForm.perfis} onChange={(e) => setEditForm((p) => ({ ...p, perfis: e.target.value }))} rows={2}
                        className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                    <Toggles value={editForm.opcoes} onChange={(o) => setEditForm((p) => ({ ...p, opcoes: o }))} />
                    <AgendaCampanha value={editForm.agenda} onChange={(a) => setEditForm((p) => ({ ...p, agenda: a }))} />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg border text-xs">Cancelar</button>
                      <button onClick={() => salvarEdicao(c.id)} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium">Salvar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{c.nicho || c.termo}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${c.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {c.ativo ? 'Ativa' : 'Pausada'}
                        </span>
                        {c.metadata_json?.agendamento_ativo && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-700">
                            ⏱ auto a cada {c.metadata_json.intervalo_horas ?? 24}h
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[c.cidade || '—', `teto ${c.teto_diario}/dia`,
                          (c.metadata_json?.perfis_semente?.length ? `${c.metadata_json.perfis_semente.length} sementes` : null),
                          c.metadata_json?.usar_cse ? 'CSE' : null,
                          c.metadata_json?.usar_snowball ? 'bola de neve' : null,
                          c.metadata_json?.seguir_link_bio ? 'link bio' : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {c.ultima_coleta_em && (
                        <div className="text-[11px] text-slate-400 mt-0.5">última coleta: {new Date(c.ultima_coleta_em).toLocaleString('pt-BR')}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => coletarCampanha(c.id)} disabled={carregando || !podeColetar}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                        Coletar agora
                      </button>
                      <button onClick={() => abrirEdicao(c)} className="px-3 py-1.5 rounded-lg border text-xs hover:bg-slate-50">Editar</button>
                      <button onClick={() => excluirCampanha(c.id)} className="px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-600 hover:bg-red-50">Excluir</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {progresso != null && (
        <div className="space-y-1">
          <NeonProgress value={progresso} tone="magenta" />
          <p className="text-xs text-slate-500">
            {progresso >= 100 ? 'Coleta atualizada.' : 'Coletando perfis…'}
          </p>
        </div>
      )}

      {/* Funil em abas */}
      <div className="bg-white rounded-2xl shadow-sm border">
        <div className="flex gap-1 border-b px-3 pt-3 flex-wrap">
          {ABAS.map((a) => (
            <button key={a.valor} onClick={() => setAba(a.valor)}
              className={`rounded-t-lg px-3 py-2 text-sm font-medium ${aba === a.valor ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {a.label}{funil ? ` (${funil.abas[a.valor] ?? 0})` : ''}
            </button>
          ))}
        </div>
        {leads.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Nenhum lead nesta aba.</p>
        ) : (
          <DataTableFrame ariaLabel="Rolagem horizontal da tabela de captação">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="@username" chave="username" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="Nicho" chave="nicho" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="Seguidores" chave="seguidores" ordem={ordem} onOrdenar={ordenarPor} align="right" />
                  <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="Links" chave="links" ordem={ordem} onOrdenar={ordenarPor} />
                  <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={ordenarPor} align="right" />
                  <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={ordenarPor} />
                  <th className="text-left px-3 py-2">JSON</th>
                  <th className="text-right px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {leadsOrdenados.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{quando(l.created_at)}</td>
                    <td className="px-3 py-2 font-medium text-slate-900 max-w-[200px] truncate" title={l.bio || l.nome}>{l.nome}</td>
                    <td className="px-3 py-2 text-xs">
                      {l.instagram_handle ? (
                        <a href={`https://instagram.com/${l.instagram_handle}`} target="_blank" rel="noreferrer"
                          className="text-brand hover:underline">@{l.instagram_handle}</a>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px] truncate" title={[l.nicho, l.categoria_perfil, l.cidade].filter(Boolean).join(' · ')}>
                      {l.nicho || l.categoria_perfil || '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold">{l.seguidores != null ? l.seguidores.toLocaleString('pt-BR') : '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{l.telefone || '—'}</td>
                    <td className="px-3 py-2 text-xs"><EmailEditavel value={l.email} onSave={(email) => salvarEmail(l.id, email)} /></td>
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
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_STYLE[l.status] || 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {l.json_apresentacao && (
                        <button onClick={() => setJsonAberto({ titulo: l.nome, json: l.json_apresentacao! })}
                          className="text-xs px-2 py-1 rounded-lg border text-brand hover:bg-blue-50"
                          title="Dados unificados + prompt único pro bot gerar a saudação de análise">
                          {'{ }'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {l.status !== 'aprovado' && l.telefone && (
                          <button onClick={() => mudarStatus(l.id, 'aprovado')}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Aprovar p/ WhatsApp</button>
                        )}
                        {emailConfigurado && l.email && (
                          <EmailBotao onEnviar={(assunto, corpo) =>
                            apiFetch(`${base}/leads/${l.id}/email`, { method: 'POST', body: JSON.stringify({ assunto, corpo }) })
                              .then(() => setMsg('E-mail enviado.'))
                              .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao enviar e-mail.'))} />
                        )}
                        {l.status !== 'rejeitado' && (
                          <button onClick={() => mudarStatus(l.id, 'rejeitado')}
                            className="rounded-md border px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">Descartar</button>
                        )}
                        {l.status !== 'nao_contatar' && (
                          <button onClick={() => mudarStatus(l.id, 'nao_contatar')}
                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">Não contatar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableFrame>
        )}
      </div>

      {jsonAberto && (
        <JsonLeadModal titulo={`JSON de apresentação — ${jsonAberto.titulo}`} json={jsonAberto.json} onFechar={() => setJsonAberto(null)} />
      )}

      {/* Coletas recentes */}
      {snapshots.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Coletas recentes</p>
          <div className="space-y-1 text-xs">
            {snapshots.slice(0, 12).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-slate-600 border-t pt-1.5 first:border-0 first:pt-0">
                <span className="truncate">{s.fonte} · {s.etapa} · {s.termo || '—'}</span>
                <span className="flex shrink-0 gap-3">
                  <span>{s.custo_registros} regs</span>
                  <span>{s.total_prospects} leads</span>
                  <span className={s.status === 'falhou' ? 'text-red-600' : s.status === 'concluido' ? 'text-emerald-600' : 'text-slate-500'}>{s.status}</span>
                </span>
              </div>
            ))}
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

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="flex-1 min-w-[160px]">
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border rounded-lg px-3 py-2 text-sm" />
    </div>
  )
}

function Toggles({ value, onChange }: { value: Opcoes; onChange: (o: Opcoes) => void }) {
  const itens: { k: keyof Opcoes; label: string }[] = [
    { k: 'usar_cse', label: 'Usar Google CSE' },
    { k: 'usar_snowball', label: 'Bola de neve' },
    { k: 'seguir_link_bio', label: 'Seguir link da bio' },
  ]
  return (
    <div className="flex flex-wrap gap-4">
      {itens.map(({ k, label }) => (
        <label key={k} className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
          {label}
        </label>
      ))}
    </div>
  )
}

function AgendaCampanha({ value, onChange, mostrarAtivacao = true }: {
  value: Agenda; onChange: (a: Agenda) => void; mostrarAtivacao?: boolean
}) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3 space-y-2">
      {mostrarAtivacao && (
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={value.agendamento_ativo}
            onChange={(e) => onChange({ ...value, agendamento_ativo: e.target.checked })} />
          ⏱ Prospectar automaticamente (a cada X horas)
        </label>
      )}
      {(!mostrarAtivacao || value.agendamento_ativo) && (
        <div className="space-y-2 pl-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32">
              <label className="block text-xs text-slate-500 mb-1">A cada (horas)</label>
              <input type="number" min={1} max={168} value={value.intervalo_horas}
                onChange={(e) => onChange({ ...value, intervalo_horas: Number(e.target.value) || 1 })}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-500 mb-1">Das</label>
              <input type="time" value={value.janela_inicio}
                onChange={(e) => onChange({ ...value, janela_inicio: e.target.value })}
                className="w-full border rounded-lg px-2 py-2 text-sm" />
            </div>
            <div className="w-28">
              <label className="block text-xs text-slate-500 mb-1">Até</label>
              <input type="time" value={value.janela_fim}
                onChange={(e) => onChange({ ...value, janela_fim: e.target.value })}
                className="w-full border rounded-lg px-2 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Dias da semana</label>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_LABEL.map((d, i) => {
                const on = value.dias_semana.includes(i)
                return (
                  <button key={i} type="button"
                    onClick={() => onChange({
                      ...value,
                      dias_semana: on
                        ? value.dias_semana.filter((x) => x !== i)
                        : [...value.dias_semana, i].sort((a, b) => a - b),
                    })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${on ? 'bg-brand text-white border-brand' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {d}
                  </button>
                )
              })}
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Respeita o teto diário da campanha e o orçamento da Bright Data. Lembre que o Google CSE tem free tier de ~100 buscas/dia — use intervalos folgados.
          </p>
        </div>
      )}
    </div>
  )
}

function EmailBotao({ onEnviar }: { onEnviar: (assunto: string, corpo: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')
  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50"><IconEnvelope /> E-mail</button>
    )
  }
  return (
    <div className="w-64 rounded-lg border bg-slate-50 p-2 space-y-1.5">
      <input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto"
        className="w-full border rounded px-2 py-1 text-xs" />
      <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} placeholder="Mensagem" rows={3}
        className="w-full border rounded px-2 py-1 text-xs" />
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setAberto(false)} className="px-2 py-1 rounded border text-xs">Cancelar</button>
        <button
          onClick={() => { onEnviar(assunto, corpo); setAberto(false); setAssunto(''); setCorpo('') }}
          disabled={!assunto || !corpo}
          className="px-2 py-1 rounded bg-brand text-white text-xs font-medium disabled:opacity-50">Enviar</button>
      </div>
    </div>
  )
}
