'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiDownload, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'

// Banco de Leads — visão unificada das duas origens (Google Places + Instagram),
// agrupada nos 3 estágios do funil. Consome /api/empresas/:id/banco-leads.
type Lead = {
  id: string; origem: string; status: string; nome: string
  telefone: string | null; email: string | null; instagram_handle: string | null
  nicho: string | null; cidade: string | null; site: string | null
  seguidores: number | null; categoria_perfil: string | null
  created_at: string; updated_at: string
}
type Resumo = { abas: Record<string, number>; por_status: Record<string, number> }

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
const ORIGEM_LABEL: Record<string, string> = {
  manual: 'Places', automatico: 'Places', instagram: 'Instagram', linkedin: 'LinkedIn',
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

  useEffect(() => { carregarResumo() }, [carregarResumo])
  useEffect(() => { carregarLeads() }, [carregarLeads])

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

  async function exportar() {
    setExportando(true)
    try {
      const nome = `banco-leads-${aba}-${new Date().toISOString().slice(0, 10)}.csv`
      await fb.runTask(() => apiDownload(`${base}/export.csv?${query()}`, nome), { sucesso: 'CSV exportado.' })
    } catch { /* erro já exibido pelo feedback */ }
    finally { setExportando(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Banco de Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            Todos os leads das duas origens em um só lugar: quem ainda não foi abordado,
            quem já conversou e quem fechou. Marque os fechados e exporte para Excel.
          </p>
        </div>
        <button onClick={exportar} disabled={exportando || !leads.length}
          className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          {exportando && <Spinner />}
          {exportando ? 'Gerando…' : '⬇ Exportar CSV'}
        </button>
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

      {/* Tabela */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">Nome</th>
                <th className="text-left font-medium px-4 py-3">Origem</th>
                <th className="text-left font-medium px-4 py-3">Contato</th>
                <th className="text-left font-medium px-4 py-3">Nicho / Cidade</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-right font-medium px-4 py-3">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{l.nome || '—'}</div>
                    {l.instagram_handle && <div className="text-xs text-slate-400">@{l.instagram_handle.replace(/^@/, '')}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{ORIGEM_LABEL[l.origem] || l.origem}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="flex flex-col gap-0.5 text-xs">
                      {l.telefone && <span className="text-emerald-700">📱 {l.telefone}</span>}
                      <EmailEditavel value={l.email} onSave={(email) => salvarEmail(l.id, email)} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {[l.nicho, l.cidade].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[l.status] || 'bg-slate-100 text-slate-600'}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.status === 'fechado' ? (
                      <button onClick={() => reabrir(l.id)}
                        className="px-2.5 py-1 rounded-lg border text-xs font-medium hover:bg-slate-50">
                        Reabrir
                      </button>
                    ) : (
                      <button onClick={() => fechar(l.id)}
                        className="px-2.5 py-1 rounded-lg border border-violet-300 text-violet-700 text-xs font-medium hover:bg-violet-50">
                        ✓ Fechou
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!leads.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    {carregando ? 'Carregando…' : 'Nenhum lead nesta aba.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
