'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'

type Resumo = {
  conversas: { ativas: string; fechadas: string; arquivadas: string; total: string }
  por_estagio: { estagio: string; total: string }[]
  followups: { enviados: string; respondidos: string }
  llm_30d: { chamadas: string; input_tokens: string; output_tokens: string; latencia_media_ms: string }
  temperatura: { quente: string; morno: string; frio: string; prontos_handoff: string }
}

type RelatorioIA = { texto: string; provider: string; model: string }

const ESTAGIO_LABEL: Record<string, string> = {
  primeiro_contato: 'Primeiro contato',
  diagnostico: 'Diagnóstico',
  proposta: 'Proposta',
  objecao: 'Objeção',
  fechamento: 'Fechamento',
}

const n = (v: unknown) => Number(v || 0)
const pctOf = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0)

export default function RelatoriosPage() {
  const [dados, setDados] = useState<Resumo | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) { setErro('Nenhuma empresa selecionada.'); return }
    apiFetch<Resumo>(`/api/empresas/${id}/relatorios/resumo`)
      .then((r) => setDados(r.data))
      .catch((e) => setErro(e.message))
  }, [])

  if (erro) return <p className="text-red-600 text-sm">{erro}</p>
  if (!dados) return <p className="text-slate-500 text-sm">Carregando…</p>

  const c = dados.conversas || { ativas: '0', fechadas: '0', arquivadas: '0', total: '0' }
  const f = dados.followups || { enviados: '0', respondidos: '0' }
  const t = dados.temperatura || { quente: '0', morno: '0', frio: '0', prontos_handoff: '0' }

  const totalConversas = n(c.total)
  const taxaConversao = pctOf(n(c.fechadas), totalConversas)
  const taxaResposta = pctOf(n(f.respondidos), n(f.enviados))
  const totalTemp = n(t.quente) + n(t.morno) + n(t.frio)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Relatórios</h1>
      <p className="text-sm text-slate-500 -mt-4">
        Dados atualizados direto do sistema. Use “Analisar via IA” em cada seção para um resumo escrito.
      </p>

      {/* GERAL */}
      <Secao titulo="Geral" tipo="geral">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card title="Total de conversas" value={c.total ?? '0'} />
          <Card title="Ativas" value={c.ativas ?? '0'} accent="text-sky-600" />
          <Card title="Fechadas" value={c.fechadas ?? '0'} accent="text-emerald-600" />
          <Card title="Arquivadas" value={c.arquivadas ?? '0'} accent="text-slate-400" />
        </div>
      </Secao>

      {/* VENDAS */}
      <Secao titulo="Vendas" tipo="vendas">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card title="Vendas fechadas" value={c.fechadas ?? '0'} accent="text-emerald-600" />
          <Card title="Conversas no total" value={c.total ?? '0'} />
          <Card title="Taxa de conversão" value={`${taxaConversao}%`} accent="text-emerald-600" />
        </div>
      </Secao>

      {/* FUNIL */}
      <Secao titulo="Funil comercial" tipo="funil">
        {dados.por_estagio.length === 0 ? (
          <p className="text-slate-400 text-sm">Sem conversas ativas no funil.</p>
        ) : (
          <ul className="space-y-2">
            {dados.por_estagio.map((row) => (
              <li key={row.estagio} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span className="text-slate-700">{ESTAGIO_LABEL[row.estagio] || row.estagio}</span>
                <span className="font-semibold">{row.total}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* FOLLOW-UP */}
      <Secao titulo="Follow-up" tipo="followup">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card title="Enviados" value={f.enviados ?? '0'} />
          <Card title="Respondidos" value={f.respondidos ?? '0'} accent="text-emerald-600" />
          <Card title="Taxa de resposta" value={`${taxaResposta}%`} accent="text-emerald-600" />
        </div>
      </Secao>

      {/* LEADS */}
      <Secao titulo="Leads" tipo="leads">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Card title="🔥 Quentes" value={t.quente ?? '0'} accent="text-orange-600" />
          <Card title="🌤️ Mornos" value={t.morno ?? '0'} accent="text-amber-500" />
          <Card title="❄️ Frios" value={t.frio ?? '0'} accent="text-sky-500" />
          <Card title="Prontos p/ handoff" value={t.prontos_handoff ?? '0'} accent="text-emerald-600" />
        </div>
        {totalTemp > 0 && (
          <div className="space-y-2">
            <TempBar label="🔥 Quente" qtd={n(t.quente)} pct={pctOf(n(t.quente), totalTemp)} color="bg-orange-500" />
            <TempBar label="🌤️ Morno" qtd={n(t.morno)} pct={pctOf(n(t.morno), totalTemp)} color="bg-amber-400" />
            <TempBar label="❄️ Frio" qtd={n(t.frio)} pct={pctOf(n(t.frio), totalTemp)} color="bg-sky-400" />
          </div>
        )}
      </Secao>
    </div>
  )
}

// Seção com cabeçalho, conteúdo automático e botão opcional de análise via IA.
function Secao({ titulo, tipo, children }: { titulo: string; tipo: string; children: React.ReactNode }) {
  const [ia, setIa] = useState<RelatorioIA | null>(null)
  const [loading, setLoading] = useState(false)
  const fb = useFeedback()

  async function analisar() {
    const empresaId = getEmpresaId()
    if (!empresaId) return
    setLoading(true)
    try {
      const r = await fb.runTask(() => apiFetch<RelatorioIA>(`/api/empresas/${empresaId}/relatorios/ia`, {
        method: 'POST',
        body: JSON.stringify({ tipo }),
      }), { sucesso: 'Análise gerada.' })
      setIa(r.data)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setLoading(false) }
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">{titulo}</h2>
        <button
          onClick={analisar}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs text-brand hover:text-brand-dark font-medium disabled:opacity-50"
        >
          {loading && <Spinner />}
          {loading ? 'Analisando…' : 'Analisar via IA'}
        </button>
      </div>

      {children}

      {ia && (
        <div className="bg-slate-50 border rounded-xl p-4 mt-2">
          <p className="text-[11px] text-slate-400 mb-2">Gerado por {ia.provider} / {ia.model}</p>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{ia.texto}</pre>
        </div>
      )}
    </section>
  )
}

function Card({ title, value, accent }: { title: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-slate-50 rounded-xl border p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${accent || 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function TempBar({ label, qtd, pct, color }: { label: string; qtd: number; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span>{qtd} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
