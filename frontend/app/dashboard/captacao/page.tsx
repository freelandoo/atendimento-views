'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import NeonCard from '@/components/ui/NeonCard'
import NeonButton from '@/components/ui/NeonButton'
import NeonProgress from '@/components/ui/NeonProgress'
import StatusPill from '@/components/ui/StatusPill'
import KpiCounter from '@/components/ui/KpiCounter'

type CampanhaMeta = {
  perfis_semente?: string[]
  usar_cse?: boolean
  usar_snowball?: boolean
  seguir_link_bio?: boolean
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

// Estado dos toggles + limite usado pelo painel ad-hoc e pelo form de campanha.
type Opcoes = { usar_cse: boolean; usar_snowball: boolean; seguir_link_bio: boolean }
const OPCOES_PADRAO: Opcoes = { usar_cse: true, usar_snowball: true, seguir_link_bio: true }

export default function CaptacaoPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/captacao`

  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [orcamento, setOrcamento] = useState<Orcamento | null>(null)
  const [funil, setFunil] = useState<Funil | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [aba, setAba] = useState('entrada')
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [emailConfigurado, setEmailConfigurado] = useState(false)

  // Painel "Coletar agora" (ad-hoc)
  const [adNicho, setAdNicho] = useState('')
  const [adCidade, setAdCidade] = useState('')
  const [adPerfis, setAdPerfis] = useState('')
  const [adLimite, setAdLimite] = useState('')
  const [adOpcoes, setAdOpcoes] = useState<Opcoes>(OPCOES_PADRAO)

  // Form nova campanha
  const [novaAberta, setNovaAberta] = useState(false)
  const [cNicho, setCNicho] = useState('')
  const [cCidade, setCCidade] = useState('')
  const [cPerfis, setCPerfis] = useState('')
  const [cTeto, setCTeto] = useState('50')
  const [cAtivo, setCAtivo] = useState(true)
  const [cOpcoes, setCOpcoes] = useState<Opcoes>(OPCOES_PADRAO)

  // Edição de campanha existente
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    nicho: string; cidade: string; perfis: string; teto: string; ativo: boolean; opcoes: Opcoes
  }>({ nicho: '', cidade: '', perfis: '', teto: '50', ativo: true, opcoes: OPCOES_PADRAO })

  const podeColetar = !!orcamento?.brightdata_configurado

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

  async function coletarAdHoc(e: React.FormEvent) {
    e.preventDefault()
    setErro(null); setMsg(null); setCarregando(true)
    try {
      await apiFetch(`${base}/coletar`, {
        method: 'POST',
        body: JSON.stringify({
          fonte: 'instagram',
          nicho: adNicho || undefined,
          cidade: adCidade || undefined,
          perfis: adPerfis || undefined,
          usar_cse: adOpcoes.usar_cse,
          usar_snowball: adOpcoes.usar_snowball,
          seguir_link_bio: adOpcoes.seguir_link_bio,
          limite: adLimite ? Number(adLimite) : undefined,
        }),
      })
      setMsg('Coleta iniciada — os perfis aparecem nas abas conforme o scraper responde.')
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao coletar.') }
    finally { setCarregando(false) }
  }

  async function criarCampanha(e: React.FormEvent) {
    e.preventDefault()
    setErro(null); setMsg(null)
    try {
      await apiFetch(`${base}/campanhas`, {
        method: 'POST',
        body: JSON.stringify({
          fonte: 'instagram',
          nicho: cNicho || undefined,
          cidade: cCidade || undefined,
          perfis_semente: cPerfis || undefined,
          teto_diario: Number(cTeto) || 50,
          ativo: cAtivo,
          usar_cse: cOpcoes.usar_cse,
          usar_snowball: cOpcoes.usar_snowball,
          seguir_link_bio: cOpcoes.seguir_link_bio,
        }),
      })
      setCNicho(''); setCCidade(''); setCPerfis(''); setCTeto('50'); setCAtivo(true); setCOpcoes(OPCOES_PADRAO)
      setNovaAberta(false)
      setMsg('Campanha salva.')
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar campanha.') }
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
    })
  }

  async function salvarEdicao(id: string) {
    setErro(null); setMsg(null)
    try {
      await apiFetch(`${base}/campanhas/${id}`, {
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
        }),
      })
      setEditId(null)
      setMsg('Campanha atualizada.')
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao atualizar campanha.') }
  }

  async function excluirCampanha(id: string) {
    if (!window.confirm('Excluir esta campanha? Os leads já coletados permanecem no funil.')) return
    setErro(null); setMsg(null)
    try {
      await apiFetch(`${base}/campanhas/${id}`, { method: 'DELETE' })
      if (editId === id) setEditId(null)
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao excluir campanha.') }
  }

  async function coletarCampanha(id: string) {
    setErro(null); setMsg(null); setCarregando(true)
    try {
      await apiFetch(`${base}/coletar`, { method: 'POST', body: JSON.stringify({ campanha_id: id }) })
      setMsg('Coleta iniciada — os perfis aparecem nas abas conforme o scraper responde.')
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao coletar.') }
    finally { setCarregando(false) }
  }

  async function processar() {
    setErro(null); setMsg(null); setCarregando(true)
    try {
      await apiFetch(`${base}/processar`, { method: 'POST' })
      await carregarMeta(); await carregarLeads()
      setMsg('Coletas atualizadas.')
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao processar.') }
    finally { setCarregando(false) }
  }

  async function mudarStatus(id: string, status: string) {
    setErro(null)
    try {
      await apiFetch(`${base}/leads/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) })
      setLeads((prev) => prev.filter((l) => l.id !== id))
      carregarMeta()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao atualizar status.') }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Command Deck</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-hi">Captação · Instagram</h1>
          <p className="mt-1 text-sm text-lo">
            Descubra perfis por nicho/cidade (Google CSE) ou por @perfis semente → contato → mesma pipeline de disparo.
          </p>
        </div>
        <NeonButton variant="ghost" onClick={processar} disabled={carregando} className="shrink-0">
          {carregando ? 'Atualizando…' : '↻ Atualizar coletas'}
        </NeonButton>
      </div>

      {erro && <p className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">{erro}</p>}
      {msg && <p className="rounded-lg border border-neon-lime/30 bg-neon-lime/10 px-3 py-2 text-sm text-neon-lime">{msg}</p>}

      {orcamento && !orcamento.brightdata_configurado && (
        <div className="rounded-xl border border-neon-amber/30 bg-neon-amber/10 px-4 py-3 text-sm text-neon-amber">
          Bright Data ainda não configurado (defina <code className="font-mono">BRIGHTDATA_API_TOKEN</code> e os datasets). A coleta fica indisponível até lá.
        </div>
      )}

      {/* Orçamento */}
      {orcamento && (
        <div className="grid grid-cols-3 gap-3">
          <Mini title="Teto diário" value={orcamento.teto_diario_global} tone="text-neon-cyan" />
          <Mini title="Consumido hoje" value={orcamento.consumido_hoje} tone="text-neon-amber" />
          <Mini title="Restante hoje" value={orcamento.restante_hoje} tone="text-neon-lime" />
        </div>
      )}

      {/* Coletar agora (ad-hoc) */}
      <form onSubmit={coletarAdHoc}>
        <NeonCard tone="cyan" className="space-y-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-lo">Coletar agora</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nicho" value={adNicho} onChange={setAdNicho} placeholder="ex: arquitetura de interiores" />
            <Field label="Cidade" value={adCidade} onChange={setAdCidade} placeholder="ex: São Paulo" />
            <div className="w-28">
              <label className="mb-1 block text-xs text-lo">Limite</label>
              <input type="number" min={1} value={adLimite} onChange={(e) => setAdLimite(e.target.value)} placeholder="auto" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-lo">@perfis semente (um por linha ou separados por vírgula)</label>
            <textarea value={adPerfis} onChange={(e) => setAdPerfis(e.target.value)} rows={3}
              placeholder={'@studioabc, @casadecor\nperfilxyz'} className={`${inputCls} font-mono`} />
          </div>
          <Toggles value={adOpcoes} onChange={setAdOpcoes} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-lo">Informe um nicho (com CSE) ou ao menos 1 perfil.</p>
            <NeonButton type="submit" disabled={carregando || !podeColetar}>
              {carregando ? 'Coletando…' : '⚡ Coletar'}
            </NeonButton>
          </div>
        </NeonCard>
      </form>

      {/* Campanhas salvas */}
      <NeonCard className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-lo">Campanhas salvas</p>
          <NeonButton variant="ghost" onClick={() => setNovaAberta((v) => !v)} className="px-3 py-1.5 text-xs">
            {novaAberta ? 'Cancelar' : '+ Nova campanha'}
          </NeonButton>
        </div>

        {novaAberta && (
          <form onSubmit={criarCampanha} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Nicho" value={cNicho} onChange={setCNicho} placeholder="ex: arquitetura de interiores" />
              <Field label="Cidade" value={cCidade} onChange={setCCidade} placeholder="ex: São Paulo" />
              <div className="w-28">
                <label className="mb-1 block text-xs text-lo">Teto/dia</label>
                <input type="number" min={1} value={cTeto} onChange={(e) => setCTeto(e.target.value)} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 py-2 text-sm text-mid">
                <input type="checkbox" checked={cAtivo} onChange={(e) => setCAtivo(e.target.checked)} className="accent-[var(--neon-cyan)]" /> Ativa
              </label>
            </div>
            <div>
              <label className="mb-1 block text-xs text-lo">@perfis semente (um por linha ou separados por vírgula)</label>
              <textarea value={cPerfis} onChange={(e) => setCPerfis(e.target.value)} rows={2}
                placeholder={'@studioabc, @casadecor'} className={`${inputCls} font-mono`} />
            </div>
            <Toggles value={cOpcoes} onChange={setCOpcoes} />
            <div className="flex justify-end">
              <NeonButton type="submit">Salvar campanha</NeonButton>
            </div>
          </form>
        )}

        {campanhas.length === 0 ? (
          <p className="text-sm text-lo">Nenhuma campanha salva ainda.</p>
        ) : (
          <div className="space-y-2">
            {campanhas.map((c) => (
              <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                {editId === c.id ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Nicho" value={editForm.nicho} onChange={(v) => setEditForm((p) => ({ ...p, nicho: v }))} />
                      <Field label="Cidade" value={editForm.cidade} onChange={(v) => setEditForm((p) => ({ ...p, cidade: v }))} />
                      <div className="w-28">
                        <label className="mb-1 block text-xs text-lo">Teto/dia</label>
                        <input type="number" min={1} value={editForm.teto}
                          onChange={(e) => setEditForm((p) => ({ ...p, teto: e.target.value }))} className={inputCls} />
                      </div>
                      <label className="flex items-center gap-2 py-2 text-sm text-mid">
                        <input type="checkbox" checked={editForm.ativo}
                          onChange={(e) => setEditForm((p) => ({ ...p, ativo: e.target.checked }))} className="accent-[var(--neon-cyan)]" /> Ativa
                      </label>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-lo">@perfis semente</label>
                      <textarea value={editForm.perfis} onChange={(e) => setEditForm((p) => ({ ...p, perfis: e.target.value }))} rows={2} className={`${inputCls} font-mono`} />
                    </div>
                    <Toggles value={editForm.opcoes} onChange={(o) => setEditForm((p) => ({ ...p, opcoes: o }))} />
                    <div className="flex justify-end gap-2">
                      <NeonButton variant="ghost" onClick={() => setEditId(null)} className="px-3 py-1.5 text-xs">Cancelar</NeonButton>
                      <NeonButton onClick={() => salvarEdicao(c.id)} className="px-3 py-1.5 text-xs">Salvar</NeonButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-hi">{c.nicho || c.termo}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${c.ativo ? 'border-neon-lime/40 bg-neon-lime/10 text-neon-lime' : 'border-white/15 bg-white/5 text-lo'}`}>
                          {c.ativo ? 'Ativa' : 'Pausada'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-lo">
                        {[c.cidade || '—', `teto ${c.teto_diario}/dia`,
                          (c.metadata_json?.perfis_semente?.length ? `${c.metadata_json.perfis_semente.length} sementes` : null),
                          c.metadata_json?.usar_cse ? 'CSE' : null,
                          c.metadata_json?.usar_snowball ? 'bola de neve' : null,
                          c.metadata_json?.seguir_link_bio ? 'link bio' : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {c.ultima_coleta_em && (
                        <div className="mt-0.5 text-[11px] text-lo">última coleta: {new Date(c.ultima_coleta_em).toLocaleString('pt-BR')}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <NeonButton variant="success" onClick={() => coletarCampanha(c.id)} disabled={carregando || !podeColetar} className="px-3 py-1.5 text-xs">
                        Coletar agora
                      </NeonButton>
                      <NeonButton variant="ghost" onClick={() => abrirEdicao(c)} className="px-3 py-1.5 text-xs">Editar</NeonButton>
                      <NeonButton variant="danger" onClick={() => excluirCampanha(c.id)} className="px-3 py-1.5 text-xs">Excluir</NeonButton>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </NeonCard>

      {/* Funil em abas */}
      <NeonCard className="overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-white/10 px-3 pt-3">
          {ABAS.map((a) => (
            <button key={a.valor} onClick={() => setAba(a.valor)}
              className={`rounded-t-lg px-3 py-2 text-sm font-medium transition ${aba === a.valor ? 'border border-b-0 border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan' : 'text-mid hover:bg-white/5'}`}>
              {a.label}{funil ? ` (${funil.abas[a.valor] ?? 0})` : ''}
            </button>
          ))}
        </div>
        <div className="divide-y divide-white/5">
          {leads.length === 0 && <p className="px-5 py-8 text-center text-sm text-lo">Nenhum lead nesta aba.</p>}
          {leads.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-hi">{l.nome}</span>
                  {l.instagram_handle && (
                    <a href={`https://instagram.com/${l.instagram_handle}`} target="_blank" rel="noreferrer"
                      className="text-xs text-lo hover:text-neon-cyan hover:underline">@{l.instagram_handle}</a>
                  )}
                  <StatusPill status={l.status} />
                </div>
                <div className="mt-0.5 truncate text-xs text-lo">
                  {[l.nicho, l.cidade, l.categoria_perfil, l.seguidores != null ? `${l.seguidores} seguidores` : null].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  {l.telefone && <span className="font-mono text-neon-lime">📱 {l.telefone}</span>}
                  {l.email && <span className="text-neon-cyan">✉ {l.email}</span>}
                  {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-lo underline hover:text-neon-cyan">link da bio</a>}
                  {!l.telefone && !l.email && <span className="text-lo">sem contato</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                {l.status !== 'aprovado' && l.telefone && (
                  <NeonButton variant="success" onClick={() => mudarStatus(l.id, 'aprovado')} className="px-2.5 py-1 text-xs">Aprovar p/ WhatsApp</NeonButton>
                )}
                {emailConfigurado && l.email && (
                  <EmailBotao onEnviar={(assunto, corpo) =>
                    apiFetch(`${base}/leads/${l.id}/email`, { method: 'POST', body: JSON.stringify({ assunto, corpo }) })
                      .then(() => setMsg('E-mail enviado.'))
                      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao enviar e-mail.'))} />
                )}
                {l.status !== 'rejeitado' && (
                  <NeonButton variant="ghost" onClick={() => mudarStatus(l.id, 'rejeitado')} className="px-2.5 py-1 text-xs">Descartar</NeonButton>
                )}
                {l.status !== 'nao_contatar' && (
                  <NeonButton variant="danger" onClick={() => mudarStatus(l.id, 'nao_contatar')} className="px-2.5 py-1 text-xs">Não contatar</NeonButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </NeonCard>

      {/* Coletas recentes */}
      {snapshots.length > 0 && (
        <NeonCard className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-lo">Coletas recentes</p>
          <div className="space-y-1 text-xs">
            {snapshots.slice(0, 12).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-t border-white/5 pt-1.5 text-mid first:border-0 first:pt-0">
                <span className="truncate">{s.fonte} · {s.etapa} · {s.termo || '—'}</span>
                <span className="flex shrink-0 gap-3 font-mono">
                  <span>{s.custo_registros} regs</span>
                  <span>{s.total_prospects} leads</span>
                  <span className={s.status === 'falhou' ? 'text-neon-red' : s.status === 'concluido' ? 'text-neon-lime' : 'text-lo'}>{s.status}</span>
                </span>
              </div>
            ))}
          </div>
        </NeonCard>
      )}
    </div>
  )
}

function Mini({ title, value, tone = 'text-hi' }: { title: string; value: number; tone?: string }) {
  return (
    <NeonCard className="p-3">
      <p className="text-[10px] uppercase tracking-wide text-lo">{title}</p>
      <p className={`mt-0.5 font-display text-xl font-bold ${tone}`}><KpiCounter value={value} /></p>
    </NeonCard>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="min-w-[160px] flex-1">
      <label className="mb-1 block text-xs text-lo">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-hi outline-none transition focus:border-neon-cyan" />
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
        <label key={k} className="flex items-center gap-2 text-sm text-mid">
          <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} className="accent-[var(--neon-cyan)]" />
          {label}
        </label>
      ))}
    </div>
  )
}

function EmailBotao({ onEnviar }: { onEnviar: (assunto: string, corpo: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')
  if (!aberto) {
    return <NeonButton variant="ghost" onClick={() => setAberto(true)} className="px-2.5 py-1 text-xs text-neon-cyan">✉ E-mail</NeonButton>
  }
  const cls = 'w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-hi outline-none focus:border-neon-cyan'
  return (
    <div className="w-64 space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2">
      <input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto" className={cls} />
      <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} placeholder="Mensagem" rows={3} className={cls} />
      <div className="flex justify-end gap-1.5">
        <NeonButton variant="ghost" onClick={() => setAberto(false)} className="px-2 py-1 text-xs">Cancelar</NeonButton>
        <NeonButton onClick={() => { onEnviar(assunto, corpo); setAberto(false); setAssunto(''); setCorpo('') }}
          disabled={!assunto || !corpo} className="px-2 py-1 text-xs">Enviar</NeonButton>
      </div>
    </div>
  )
}
