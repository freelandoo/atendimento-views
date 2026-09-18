'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'

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
  /**
   * CRM em equipe, Etapa 11: quem CONDUZ o compromisso. `null` = evento da EMPRESA — bloqueio,
   * feriado, ou qualquer evento anterior à migration 076. Não é pendência de cadastro, e é por
   * isso que ele conflita com a agenda de todo mundo.
   */
  responsavel_id: string | null
  responsavel_nome: string | null
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
  pendente: 'bg-slate-100 text-slate-600',
  confirmado: 'bg-emerald-100 text-emerald-700',
  concluido: 'bg-blue-100 text-blue-700',
  cancelado: 'bg-red-100 text-red-600',
  bloqueado: 'bg-amber-100 text-amber-700',
  nao_compareceu: 'bg-orange-100 text-orange-700',
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
  responsavel_id: string
}
function formVazio(dia: string): Form {
  return {
    titulo: '', descricao: '', tipo: 'reuniao', status: 'pendente', prioridade: 'media',
    data_inicio: `${dia}T09:00`, data_fim: `${dia}T09:30`, lead_nome: '', lead_telefone: '',
    // Vazio = o próprio (o backend resolve `responsavelId || criadoPor`). Nunca "da empresa":
    // marcar sem dono é o que um BLOQUEIO faz, e bloqueio é decisão explícita.
    responsavel_id: '',
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
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  // Etapa 11. `filtro` é a agenda de QUEM se quer ver; só quem enxerga a equipe pode trocá-lo —
  // para os demais o servidor recorta no próprio, e trocar um parâmetro de query não vira acesso
  // à agenda alheia. `podeVerEquipe` chega no `meta`, resolvido pelo backend.
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [podeVerEquipe, setPodeVerEquipe] = useState(false)
  const [equipe, setEquipe] = useState<{ id: string; nome: string }[]>([])
  // Venda a partir da reuniao concluida (migration 083).
  const [vendaDe, setVendaDe] = useState<Evento | null>(null)

  function carregar() {
    if (!empresaId) return
    setCarregando(true)
    const q = new URLSearchParams({ inicio: dia, fim: dia })
    if (filtroResponsavel) q.set('responsavel_id', filtroResponsavel)
    apiFetch<AgendaResp, { escopo?: string; pode_ver_equipe?: boolean }>(
      `/api/empresas/${empresaId}/agenda?${q.toString()}`
    )
      .then((r) => { setResp(r.data); setPodeVerEquipe(r.meta?.pode_ver_equipe === true) })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [empresaId, dia, filtroResponsavel])

  // A lista de colegas só existe para quem vê a equipe — a rota recusa os demais com 403, e é o
  // mesmo veredito que esconde o seletor. Falha silenciosa: sem a lista, o campo fica no próprio.
  useEffect(() => {
    if (!empresaId || !podeVerEquipe) { setEquipe([]); return }
    apiFetch<{ itens: { id: string; nome: string }[] }>(`/api/empresas/${empresaId}/agenda/responsaveis`)
      .then((r) => setEquipe(r.data.itens || []))
      .catch(() => setEquipe([]))
  }, [empresaId, podeVerEquipe])

  function abrirNovo() {
    setForm(formVazio(dia)); setErro(''); setModal(true)
  }
  function abrirEdicao(ev: Evento) {
    setForm({
      id: ev.id, titulo: ev.titulo, descricao: ev.descricao || '', tipo: ev.tipo,
      status: ev.status, prioridade: ev.prioridade,
      data_inicio: isoParaLocalInput(ev.data_inicio), data_fim: isoParaLocalInput(ev.data_fim),
      lead_nome: ev.lead_nome || '', lead_telefone: ev.lead_telefone || '',
      responsavel_id: ev.responsavel_id || '',
    })
    setErro(''); setModal(true)
  }
  function setF<K extends keyof Form>(k: K, v: Form[K]) { setForm((p) => ({ ...p, [k]: v })) }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setSalvando(true)
    const editando = !!form.id
    const payload = {
      titulo: form.titulo, descricao: form.descricao, tipo: form.tipo, status: form.status,
      prioridade: form.prioridade,
      data_inicio: new Date(form.data_inicio).toISOString(),
      data_fim: new Date(form.data_fim).toISOString(),
      lead_nome: form.lead_nome || null, lead_telefone: form.lead_telefone || null,
      responsavel_id: form.responsavel_id || null,
    }
    try {
      await fb.runTask(() => editando
        ? apiFetch(`/api/empresas/${empresaId}/agenda/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : apiFetch(`/api/empresas/${empresaId}/agenda`, { method: 'POST', body: JSON.stringify(payload) }),
        { sucesso: editando ? 'Evento atualizado.' : 'Evento criado.' })
      setModal(false)
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSalvando(false) }
  }

  async function mudarStatus(ev: Evento, status: string) {
    if (!empresaId) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/agenda/${ev.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
        { sucesso: 'Status atualizado.' })
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
  }
  async function excluir(ev: Evento) {
    if (!empresaId) return
    if (!window.confirm(`Excluir "${ev.titulo}"?`)) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/agenda/${ev.id}`, { method: 'DELETE' }),
        { sucesso: 'Evento excluído.' })
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
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
          <p className="text-sm text-slate-500 mt-1 capitalize">{diaLabel}</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Dia</label>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          </div>
          {podeVerEquipe && (
            <div>
              <label htmlFor="agenda-vendedor" className="block text-xs text-slate-500 mb-1">Vendedor</label>
              <select id="agenda-vendedor" value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm">
                <option value="">Equipe inteira</option>
                {equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
          )}
          <button onClick={() => setDia(hojeIso())} className="px-3 py-2 rounded-lg border text-sm hover:bg-slate-50">Hoje</button>
          <button onClick={abrirNovo} className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium">+ Novo evento</button>
        </div>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {resumo && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          <Mini title="Total" value={resumo.total} />
          <Mini title="Reuniões" value={resumo.reunioes} />
          <Mini title="Pendentes" value={resumo.pendentes} />
          <Mini title="Confirmados" value={resumo.confirmados} />
          <Mini title="Concluídos" value={resumo.concluidos} />
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border divide-y">
        {carregando && <p className="px-4 py-6 text-center text-slate-400 text-sm">Carregando…</p>}
        {!carregando && eventos.length === 0 && (
          <p className="px-4 py-10 text-center text-slate-400 text-sm">Nenhum compromisso nesse dia. Clique em “Novo evento”.</p>
        )}
        {eventos.map((ev) => (
          <div key={ev.id} className="flex items-start gap-4 px-4 py-3 hover:bg-slate-50">
            <div className="w-20 shrink-0 text-sm font-mono text-slate-600 pt-0.5">
              {horaLocal(ev.data_inicio)}<span className="text-slate-300"> – </span>{horaLocal(ev.data_fim)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{ev.titulo}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">{TIPO_LABEL[ev.tipo] || ev.tipo}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLE[ev.status] || 'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[ev.status] || ev.status}</span>
              </div>
              {(ev.lead_nome || ev.lead_telefone) && (
                <p className="text-xs text-slate-500 mt-0.5">{ev.lead_nome || ''}{ev.lead_telefone ? ` · ${ev.lead_telefone}` : ''}</p>
              )}
              {/* Sem responsável NÃO é lacuna: é evento da empresa (bloqueio, feriado) — e ele
                  conflita com a agenda de todo mundo, justamente por isso. */}
              <p className="text-xs mt-0.5">
                {ev.responsavel_nome
                  ? <span className="text-slate-500">Responsável: {ev.responsavel_nome}</span>
                  : <span className="text-amber-700">Compromisso da empresa</span>}
              </p>
              {ev.descricao && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{ev.descricao}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs">
              {ev.status === 'pendente' && <button onClick={() => mudarStatus(ev, 'confirmado')} className="text-emerald-600 hover:underline">Confirmar</button>}
              {['pendente', 'confirmado'].includes(ev.status) && <button onClick={() => mudarStatus(ev, 'concluido')} className="text-blue-600 hover:underline">Concluir</button>}
              {/* A venda so' e' oferecida na REUNIAO CONCLUIDA: e o unico momento em que ela e
                  um fato. Registrar aqui mantem UMA fonte de valor — a mesma transacao grava
                  `agenda_eventos.venda_valor`, que o meta-dispatch le para emitir o Purchase. */}
              {ev.tipo === 'reuniao' && ev.status === 'concluido' && (
                <button onClick={() => setVendaDe(ev)} className="text-emerald-700 hover:underline">Registrar venda</button>
              )}
              <button onClick={() => abrirEdicao(ev)} className="text-slate-600 hover:underline">Editar</button>
              <button onClick={() => excluir(ev)} className="text-red-600 hover:underline">Excluir</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setModal(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">{form.id ? 'Editar evento' : 'Novo evento'}</h3>
            <Campo label="Título">
              <input value={form.titulo} onChange={(e) => setF('titulo', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Início"><input type="datetime-local" value={form.data_inicio} onChange={(e) => setF('data_inicio', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
              <Campo label="Fim"><input type="datetime-local" value={form.data_fim} onChange={(e) => setF('data_fim', e.target.value)} required className="w-full border rounded-lg px-3 py-2 text-sm" /></Campo>
            </div>
            {podeVerEquipe && (
              <Campo label="Responsável">
                <select value={form.responsavel_id} onChange={(e) => setF('responsavel_id', e.target.value)}
                  className="w-full border rounded-lg px-2 py-2 text-sm">
                  {/* "Você" é o padrão; "da empresa" é BLOQUEIO — só aparece porque quem enxerga a
                      equipe é quem marca feriado e treinamento. */}
                  <option value="">Você</option>
                  {equipe.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </Campo>
            )}
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
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Cancelar</button>
              <button type="submit" disabled={salvando} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm text-white font-medium disabled:opacity-50">{salvando && <Spinner />}{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        </div>
      )}

      {vendaDe && (
        <ModalVendaDaReuniao
          evento={vendaDe}
          onFechar={() => setVendaDe(null)}
          onSalvo={() => { setVendaDe(null); carregar() }}
        />
      )}
    </div>
  )
}

/**
 * Registrar a venda de uma reuniao concluida.
 *
 * O ORIGINADOR nao e' campo: ele e' resolvido pelo historico do lead, no backend. Deixar escolher
 * aqui abriria a porta para creditar comissao a quem nao originou — e o responsavel pela REUNIAO
 * nao e' necessariamente quem originou o lead (o SDR marca para o closer, migration 076).
 */
function ModalVendaDaReuniao({ evento, onFechar, onSalvo }: { evento: Evento; onFechar: () => void; onSalvo: () => void }) {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState(evento.titulo || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/comissao/vendas`, {
        method: 'POST',
        body: JSON.stringify({
          valor: Number(valor),
          descricao,
          agenda_evento_id: evento.id,
          telefone: evento.lead_telefone || '',
        }),
      })
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Nao foi possivel registrar a venda.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label="Registrar venda da reuniao"
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Registrar venda</h3>
        <p className="text-xs text-slate-500">{evento.titulo}{evento.lead_nome ? ` · ${evento.lead_nome}` : ''}</p>
        <Campo label="Valor da venda (R$)">
          <input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)}
            className="w-full border rounded-lg px-2 py-2 text-sm" />
        </Campo>
        <Campo label="Descricao">
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)}
            className="w-full border rounded-lg px-2 py-2 text-sm" />
        </Campo>
        <p className="text-xs text-slate-500">
          A comissao so' e' liberada quando o primeiro pagamento do cliente for registrado, em
          Comissao. O responsavel pela comissao vem do historico do lead.
        </p>
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-slate-600">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !(Number(valor) > 0)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {salvando ? 'Salvando…' : 'Registrar venda'}
          </button>
        </div>
      </div>
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
