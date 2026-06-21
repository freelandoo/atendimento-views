'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'

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

  const fb = useFeedback()
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
    setCarregando(true)
    try {
      await fb.runTask(() => apiFetch(`${base}/coletar`, {
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
      }), {
        pesada: true,
        sucesso: 'Coleta iniciada',
        detalhe: 'Os perfis aparecem nas abas conforme o scraper responde.',
      })
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCarregando(false) }
  }

  async function criarCampanha(e: React.FormEvent) {
    e.preventDefault()
    try {
      await fb.runTask(() => apiFetch(`${base}/campanhas`, {
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
      }), { sucesso: 'Campanha salva.' })
      setCNicho(''); setCCidade(''); setCPerfis(''); setCTeto('50'); setCAtivo(true); setCOpcoes(OPCOES_PADRAO)
      setNovaAberta(false)
      carregarMeta()
    } catch { /* erro já exibido pelo feedback */ }
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
            Descubra perfis por nicho/cidade (Google CSE) ou por @perfis semente → contato → mesma pipeline de disparo da prospecção.
          </p>
        </div>
        <button onClick={processar} disabled={carregando}
          className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          {carregando && <Spinner />}
          {carregando ? 'Atualizando…' : '↻ Atualizar coletas'}
        </button>
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

      {/* Coletar agora (ad-hoc) */}
      <form onSubmit={coletarAdHoc} className="bg-white rounded-2xl shadow-sm border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Coletar agora</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Nicho" value={adNicho} onChange={setAdNicho} placeholder="ex: arquitetura de interiores" />
          <Field label="Cidade" value={adCidade} onChange={setAdCidade} placeholder="ex: São Paulo" />
          <div className="w-28">
            <label className="block text-xs text-slate-500 mb-1">Limite</label>
            <input type="number" min={1} value={adLimite} onChange={(e) => setAdLimite(e.target.value)}
              placeholder="auto" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">@perfis semente (um por linha ou separados por vírgula)</label>
          <textarea value={adPerfis} onChange={(e) => setAdPerfis(e.target.value)} rows={3}
            placeholder={'@studioabc, @casadecor\nperfilxyz'}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <Toggles value={adOpcoes} onChange={setAdOpcoes} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Informe um nicho (com CSE) ou ao menos 1 perfil.</p>
          <button type="submit" disabled={carregando || !podeColetar}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
            {carregando && <Spinner />}
            {carregando ? 'Coletando…' : '⚡ Coletar'}
          </button>
        </div>
      </form>

      {/* Campanhas salvas */}
      <div className="bg-white rounded-2xl shadow-sm border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campanhas salvas</p>
          <button onClick={() => setNovaAberta((v) => !v)} className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-slate-50">
            {novaAberta ? 'Cancelar' : '+ Nova campanha'}
          </button>
        </div>

        {novaAberta && (
          <form onSubmit={criarCampanha} className="rounded-xl border bg-slate-50/60 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Nicho" value={cNicho} onChange={setCNicho} placeholder="ex: arquitetura de interiores" />
              <Field label="Cidade" value={cCidade} onChange={setCCidade} placeholder="ex: São Paulo" />
              <div className="w-28">
                <label className="block text-xs text-slate-500 mb-1">Teto/dia</label>
                <input type="number" min={1} value={cTeto} onChange={(e) => setCTeto(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm py-2">
                <input type="checkbox" checked={cAtivo} onChange={(e) => setCAtivo(e.target.checked)} /> Ativa
              </label>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">@perfis semente (um por linha ou separados por vírgula)</label>
              <textarea value={cPerfis} onChange={(e) => setCPerfis(e.target.value)} rows={2}
                placeholder={'@studioabc, @casadecor'} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <Toggles value={cOpcoes} onChange={setCOpcoes} />
            <div className="flex justify-end">
              <button type="submit" className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium">Salvar campanha</button>
            </div>
          </form>
        )}

        {campanhas.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma campanha salva ainda.</p>
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
        <div className="divide-y">
          {leads.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">Nenhum lead nesta aba.</p>}
          {leads.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-900">{l.nome}</span>
                  {l.instagram_handle && (
                    <a href={`https://instagram.com/${l.instagram_handle}`} target="_blank" rel="noreferrer"
                      className="text-xs text-slate-400 hover:underline">@{l.instagram_handle}</a>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_STYLE[l.status] || 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {[l.nicho, l.cidade, l.categoria_perfil, l.seguidores != null ? `${l.seguidores} seguidores` : null].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  {l.telefone && <span className="text-emerald-700">📱 {l.telefone}</span>}
                  <EmailEditavel value={l.email} onSave={(email) => salvarEmail(l.id, email)} />
                  {l.link_bio && <a href={l.link_bio} target="_blank" rel="noreferrer" className="text-slate-500 underline">link da bio</a>}
                </div>
              </div>
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
            </div>
          ))}
        </div>
      </div>

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

function EmailBotao({ onEnviar }: { onEnviar: (assunto: string, corpo: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [assunto, setAssunto] = useState('')
  const [corpo, setCorpo] = useState('')
  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        className="rounded-md border px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50">✉ E-mail</button>
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
