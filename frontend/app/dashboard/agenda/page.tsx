'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Evento = {
  id: string
  titulo: string
  descricao: string
  tipo: string
  status: string
  prioridade: string
  data_inicio: string
  data_fim: string
  lead_telefone: string | null
  lead_nome: string | null
}
type Resumo = { total: number; reunioes: number; pendentes: number; confirmados: number; concluidos: number }
type AgendaResp = { eventos: Evento[]; resumo: Resumo; periodo: { inicio: string; fim: string } }

const TIPOS: { v: string; label: string }[] = [
  { v: 'reuniao', label: 'Reunião' },
  { v: 'follow_up', label: 'Follow-up' },
  { v: 'retorno', label: 'Retorno' },
  { v: 'tarefa', label: 'Tarefa' },
  { v: 'bloqueio', label: 'Bloqueio' },
  { v: 'outro', label: 'Outro' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.v, t.label]))

const STATUS_STYLE: Record<string, string> = {
  pendente: 'bg-white/5 text-mid',
  confirmado: 'bg-neon-lime/10 text-neon-lime',
  concluido: 'bg-neon-cyan/10 text-neon-cyan',
  cancelado: 'bg-neon-red/10 text-neon-red',
  bloqueado: 'bg-neon-amber/10 text-neon-amber',
  nao_compareceu: 'bg-neon-amber/10 text-orange-700',
}
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', confirmado: 'Confirmado', concluido: 'Concluído',
  cancelado: 'Cancelado', bloqueado: 'Bloqueado', nao_compareceu: 'Não compareceu',
}

function hojeIso(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}
function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
// ISO → valor de <input type="datetime-local"> (horário local).
function isoParaLocalInput(iso: string): string {
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

type Form = {
  id?: string
  titulo: string; descricao: string; tipo: string; status: string; prioridade: string
  data_inicio: string; data_fim: string; lead_nome: string; lead_telefone: string
}
function formVazio(dia: string): Form {
  return {
    titulo: '', descricao: '', tipo: 'reuniao', status: 'pendente', prioridade: 'media',
    data_inicio: `${dia}T09:00`, data_fim: `${dia}T09:30`, lead_nome: '', lead_telefone: '',
  }
}

export default function AgendaPage() {
  const [dia, setDia] = useState(hojeIso())
  const [resp, setResp] = useState<AgendaResp | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Form>(formVazio(hojeIso()))
  const [salvando, setSalvando] = useState(false)
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function carregar() {
    if (!empresaId) return
    setCarregando(true)
    apiFetch<AgendaResp>(`/api/empresas/${empresaId}/agenda?inicio=${dia}&fim=${dia}`)
      .then((r) => setResp(r.data))
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [empresaId, dia])

  function abrirNovo() {
    setForm(formVazio(dia)); setErro(''); setModal(true)
  }
  function abrirEdicao(ev: Evento) {
    setForm({
      id: ev.id, titulo: ev.titulo, descricao: ev.descricao || '', tipo: ev.tipo,
      status: ev.status, prioridade: ev.prioridade,
      data_inicio: isoParaLocalInput(ev.data_inicio), data_fim: isoParaLocalInput(ev.data_fim),
      lead_nome: ev.lead_nome || '', lead_telefone: ev.lead_telefone || '',
    })
    setErro(''); setModal(true)
  }
  function setF<K extends keyof Form>(k: K, v: Form[K]) { setForm((p) => ({ ...p, [k]: v })) }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setSalvando(true); setErro('')
    const payload = {
      titulo: form.titulo, descricao: form.descricao, tipo: form.tipo, status: form.status,
      prioridade: form.prioridade,
      data_inicio: new Date(form.data_inicio).toISOString(),
      data_fim: new Date(form.data_fim).toISOString(),
      lead_nome: form.lead_nome || null, lead_telefone: form.lead_telefone || null,
    }
    try {
      if (form.id) {
        await apiFetch(`/api/empresas/${empresaId}/agenda/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch(`/api/empresas/${empresaId}/agenda`, { method: 'POST', body: JSON.stringify(payload) })
      }
      setModal(false)
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar evento.')
    } finally {
      setSalvando(false)
    }
  }

  async function mudarStatus(ev: Evento, status: string) {
    if (!empresaId) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/agenda/${ev.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao atualizar status.')
    }
  }
  async function excluir(ev: Evento) {
    if (!empresaId) return
    if (!window.confirm(`Excluir "${ev.titulo}"?`)) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/agenda/${ev.id}`, { method: 'DELETE' })
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir evento.')
    }
  }

  const eventos = resp?.eventos || []
  const resumo = resp?.resumo
  const diaLabel = useMemo(
    () => new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }),
    [dia]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-sm text-lo mt-1 capitalize">{diaLabel}</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-lo mb-1">Dia</label>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => setDia(hojeIso())} className="px-3 py-2 rounded-lg border text-sm hover:bg-white/5">Hoje</button>
          <button onClick={abrirNovo} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium">+ Novo evento</button>
        </div>
      </div>

      {erro && <p className="text-neon-red text-sm">{erro}</p>}

      {resumo && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          <Mini title="Total" value={resumo.total} />
          <Mini title="Reuniões" value={resumo.reunioes} />
          <Mini title="Pendentes" value={resumo.pendentes} />
          <Mini title="Confirmados" value={resumo.confirmados} />
          <Mini title="Concluídos" value={resumo.concluidos} />
        </div>
      )}

      <div className="bg-panel rounded-2xl shadow-sm border divide-y">
        {carregando && <p className="px-4 py-6 text-center text-lo text-sm">Carregando…</p>}
        {!carregando && eventos.length === 0 && (
          <p className="px-4 py-10 text-center text-lo text-sm">Nenhum compromisso nesse dia. Clique em “Novo evento”.</p>
        )}
        {eventos.map((ev) => (
          <div key={ev.id} className="flex items-start gap-4 px-4 py-3 hover:bg-white/5">
            <div className="w-20 shrink-0 text-sm font-mono text-mid pt-0.5">
              {horaLocal(ev.data_inicio)}<span className="text-lo"> – </span>{horaLocal(ev.data_fim)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{ev.titulo}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-lo">{TIPO_LABEL[ev.tipo] || ev.tipo}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLE[ev.status] || 'bg-white/5 text-lo'}`}>{STATUS_LABEL[ev.status] || ev.status}</span>
              </div>
              {(ev.lead_nome || ev.lead_telefone) && (
                <p className="text-xs text-lo mt-0.5">{ev.lead_nome || ''}{ev.lead_telefone ? ` · ${ev.lead_telefone}` : ''}</p>
              )}
              {ev.descricao && <p className="text-xs text-lo mt-0.5 line-clamp-2">{ev.descricao}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs">
              {ev.status === 'pendente' && <button onClick={() => mudarStatus(ev, 'confirmado')} className="text-neon-lime hover:underline">Confirmar</button>}
              {['pendente', 'confirmado'].includes(ev.status) && <button onClick={() => mudarStatus(ev, 'concluido')} className="text-neon-cyan hover:underline">Concluir</button>}
              <button onClick={() => abrirEdicao(ev)} className="text-mid hover:underline">Editar</button>
              <button onClick={() => excluir(ev)} className="text-neon-red hover:underline">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setModal(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl bg-panel p-6 shadow-xl">
            <h3 className="text-lg font-semibold">{form.id ? 'Editar evento' : 'Novo evento'}</h3>
            <Campo label="Título">
              <input value={form.titulo} onChange={(e) => setF('titulo', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Início"><input type="datetime-local" value={form.data_inicio} onChange={(e) => setF('data_inicio', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
              <Campo label="Fim"><input type="datetime-local" value={form.data_fim} onChange={(e) => setF('data_fim', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="Tipo">
                <select value={form.tipo} onChange={(e) => setF('tipo', e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm">
                  {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </Campo>
              <Campo label="Status">
                <select value={form.status} onChange={(e) => setF('status', e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm">
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Campo>
              <Campo label="Prioridade">
                <select value={form.prioridade} onChange={(e) => setF('prioridade', e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm">
                  {['baixa', 'normal', 'media', 'alta', 'urgente'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Lead (nome)"><input value={form.lead_nome} onChange={(e) => setF('lead_nome', e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
              <Campo label="Lead (telefone)"><input value={form.lead_telefone} onChange={(e) => setF('lead_telefone', e.target.value)} placeholder="5511999999999" className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
            </div>
            <Campo label="Descrição">
              <textarea value={form.descricao} onChange={(e) => setF('descricao', e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </Campo>
            {erro && <p className="text-sm text-neon-red">{erro}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg border px-3 py-2 text-sm hover:bg-white/5">Cancelar</button>
              <button type="submit" disabled={salvando} className="rounded-lg bg-brand px-4 py-2 text-sm text-white font-medium disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Mini({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-panel rounded-xl shadow-sm border p-3">
      <p className="text-[10px] text-lo uppercase tracking-wide">{title}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  )
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-lo mb-0.5">{label}</label>
      {children}
    </div>
  )
}
