'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Prospect = {
  id: string
  nome: string
  telefone: string | null
  nicho: string
  cidade: string
  rating: number | null
  avaliacoes: number | null
  tem_site: boolean
  status: string
  score: number | null
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
}
type Agenda = { total_slots: number; primeiro_slot: string | null; ultimo_slot: string | null }
type ConfigResp = { config: Config; agenda: Agenda; escopo: string }
type Mercado = { nicho: string; cidade: string; total: string; enviados: string; responderam: string }
type Recente = { nome: string; telefone: string | null; nicho: string; cidade: string; score: number | null; updated_at: string }
type ResultadosResp = { por_mercado: Mercado[]; recentes: Recente[] }

const STATUS_STYLE: Record<string, string> = {
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-red-100 text-red-600',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
}

const FILTROS: { valor: string; label: string }[] = [
  { valor: '', label: 'Todos' },
  { valor: 'aguardando', label: 'Aguardando' },
  { valor: 'aprovado', label: 'Aprovados' },
  { valor: 'rejeitado', label: 'Rejeitados' },
  { valor: 'enviado', label: 'Enviados' },
  { valor: 'respondeu', label: 'Responderam' },
]

// Temperatura do lead pela pontuação (score): quente = mais dor digital / maior chance.
function temperatura(score: number | null): { emoji: string; label: string } {
  const s = score ?? 0
  if (s >= 70) return { emoji: '🔥', label: 'Quente' }
  if (s >= 40) return { emoji: '🌡️', label: 'Morno' }
  return { emoji: '❄️', label: 'Frio' }
}

export default function ProspeccaoPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [rotina, setRotina] = useState<ConfigResp | null>(null)
  const [resultados, setResultados] = useState<ResultadosResp | null>(null)
  const [nicho, setNicho] = useState('')
  const [cidade, setCidade] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const [agindo, setAgindo] = useState<string | null>(null)
  const [editRotina, setEditRotina] = useState(false)
  const [rotinaForm, setRotinaForm] = useState<Partial<Config>>({})
  const [salvandoRotina, setSalvandoRotina] = useState(false)
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function carregar() {
    if (!empresaId) return
    const qs = filtro ? `&status=${encodeURIComponent(filtro)}` : ''
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?limit=100${qs}`)
      .then((r) => setProspects(r.data || [])).catch((e) => setErro(e.message))
    apiFetch<Metricas>(`/api/empresas/${empresaId}/prospeccao/metricas`)
      .then((r) => setMetricas(r.data)).catch(() => {})
    apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`)
      .then((r) => setRotina(r.data)).catch(() => {})
    apiFetch<ResultadosResp>(`/api/empresas/${empresaId}/prospeccao/resultados`)
      .then((r) => setResultados(r.data)).catch(() => {})
  }
  useEffect(() => { carregar() }, [empresaId, filtro])

  async function acao(id: string, acaoTipo: 'aprovar' | 'rejeitar') {
    if (!empresaId) return
    setAgindo(id); setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/${acaoTipo}`, { method: 'POST' })
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro na ação.')
    } finally {
      setAgindo(null)
    }
  }

  function abrirEdicaoRotina() {
    if (rotina) setRotinaForm({ ...rotina.config })
    setEditRotina(true)
  }
  async function salvarRotina() {
    if (!empresaId) return
    setSalvandoRotina(true); setErro('')
    try {
      const r = await apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`, {
        method: 'PUT',
        body: JSON.stringify(rotinaForm),
      })
      setRotina(r.data)
      setEditRotina(false)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar rotina.')
    } finally {
      setSalvandoRotina(false)
    }
  }
  function setRF<K extends keyof Config>(k: K, v: Config[K]) {
    setRotinaForm((p) => ({ ...p, [k]: v }))
  }

  // Mais quentes primeiro (maior score no topo).
  const ordenados = [...prospects].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  async function buscar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId || !nicho || !cidade) return
    setBuscando(true); setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
        method: 'POST',
        body: JSON.stringify({ nicho, cidade, quantidade: 20 }),
      })
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro na busca.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prospecção</h1>
        <p className="text-sm text-slate-500 mt-1">Busque leads no Google e gerencie a carteira de prospecção desta empresa.</p>
      </div>

      <form onSubmit={buscar} className="bg-white rounded-2xl shadow-sm border p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">Nicho</label>
          <input value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="ex: dentista" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">Cidade</label>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="ex: Santana, SP" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={buscando || !nicho || !cidade} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50">
          {buscando ? 'Buscando…' : '🔎 Buscar no Google'}
        </button>
      </form>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {rotina && (
        <div className="bg-white rounded-2xl shadow-sm border p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rotina automática · esta empresa</p>
              <p className="text-sm text-slate-600 mt-0.5">
                {rotina.config.ativo ? 'Ativa' : 'Pausada'} · {rotina.config.modo} · janela {rotina.config.horario_inicio}–{rotina.config.horario_fim}, a cada {rotina.config.intervalo_envio_minutos} min
              </p>
            </div>
            {!editRotina ? (
              <button onClick={abrirEdicaoRotina} className="px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-slate-50">Editar rotina</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditRotina(false)} className="px-3 py-1.5 rounded-lg border text-xs">Cancelar</button>
                <button onClick={salvarRotina} disabled={salvandoRotina} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50">{salvandoRotina ? 'Salvando…' : 'Salvar'}</button>
              </div>
            )}
          </div>

          {!editRotina ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <Mini title="Nicho" value={rotina.config.categoria_padrao || '—'} />
              <Mini title="Região" value={[rotina.config.cidade_padrao, rotina.config.estado_padrao || rotina.config.regiao_padrao].filter(Boolean).join(' / ') || '—'} />
              <Mini title="Capacidade/dia" value={rotina.config.limite_diario} />
              <Mini title="Slots hoje" value={rotina.agenda?.total_slots ?? '—'} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <Campo label="Nicho padrão"><input value={rotinaForm.categoria_padrao || ''} onChange={(e) => setRF('categoria_padrao', e.target.value)} placeholder="ex: dentista" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Cidade padrão"><input value={rotinaForm.cidade_padrao || ''} onChange={(e) => setRF('cidade_padrao', e.target.value)} placeholder="ex: Santana" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Estado (UF)"><input value={rotinaForm.estado_padrao || ''} maxLength={2} onChange={(e) => setRF('estado_padrao', e.target.value.toUpperCase())} placeholder="SP" className="w-full border rounded-lg px-2 py-1.5 text-sm uppercase" /></Campo>
              <Campo label="Capacidade/dia"><input type="number" min={1} max={200} value={rotinaForm.limite_diario ?? 80} onChange={(e) => setRF('limite_diario', Number(e.target.value))} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Intervalo (min)"><input type="number" min={5} max={1440} value={rotinaForm.intervalo_envio_minutos ?? 15} onChange={(e) => setRF('intervalo_envio_minutos', Number(e.target.value))} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Início"><input type="time" value={rotinaForm.horario_inicio || '08:00'} onChange={(e) => setRF('horario_inicio', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Fim"><input type="time" value={rotinaForm.horario_fim || '17:00'} onChange={(e) => setRF('horario_fim', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Modo">
                <select value={rotinaForm.modo || 'manual'} onChange={(e) => setRF('modo', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="manual">Manual</option>
                  <option value="semi_automatico">Semiautomático</option>
                  <option value="automatico">Automático</option>
                </select>
              </Campo>
              <Campo label="Status">
                <label className="flex items-center gap-2 text-sm py-1.5">
                  <input type="checkbox" checked={!!rotinaForm.ativo} onChange={(e) => setRF('ativo', e.target.checked)} /> Ativa
                </label>
              </Campo>
            </div>
          )}
        </div>
      )}

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
          <Mini title="Aprovados" value={metricas.aprovados} />
          <Mini title="Enviados" value={metricas.enviados} />
          <Mini title="Responderam" value={metricas.responderam} />
          <Mini title="Taxa resp." value={`${metricas.taxa_resposta}%`} />
        </div>
      )}

      <table className="w-full text-sm border rounded-xl overflow-hidden bg-white shadow-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-4 py-2">Temp.</th>
            <th className="text-left px-4 py-2">Nome</th>
            <th className="text-left px-4 py-2">Telefone</th>
            <th className="text-left px-4 py-2">Nicho / Cidade</th>
            <th className="text-right px-4 py-2">Score</th>
            <th className="text-left px-4 py-2">Site</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-right px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((p) => {
            const t = temperatura(p.score)
            return (
            <tr key={p.id} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap" title={t.label}>{t.emoji} <span className="text-xs text-slate-500">{t.label}</span></td>
              <td className="px-4 py-2 font-medium">{p.nome}</td>
              <td className="px-4 py-2 font-mono text-xs">{p.telefone || '—'}</td>
              <td className="px-4 py-2 text-slate-600">{p.nicho} · {p.cidade}</td>
              <td className="px-4 py-2 text-right font-semibold">{p.score ?? '—'}</td>
              <td className="px-4 py-2">{p.tem_site ? '✅' : '❌'}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
              </td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                {(p.status === 'aguardando' || p.status === 'rejeitado') && (
                  <button disabled={agindo === p.id} onClick={() => acao(p.id, 'aprovar')} className="text-emerald-600 hover:underline disabled:opacity-40 mr-3">Aprovar</button>
                )}
                {(p.status === 'aguardando' || p.status === 'aprovado') && (
                  <button disabled={agindo === p.id} onClick={() => acao(p.id, 'rejeitar')} className="text-red-600 hover:underline disabled:opacity-40">Rejeitar</button>
                )}
              </td>
            </tr>
            )
          })}
          {ordenados.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">Nenhum prospect ainda. Faça uma busca acima.</td></tr>
          )}
        </tbody>
      </table>

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

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-slate-500 mb-0.5">{label}</label>
      {children}
    </div>
  )
}
