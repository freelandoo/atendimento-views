'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import InstanciasWhatsApp from '@/components/InstanciasWhatsApp'

type Sugestao = {
  id: string
  tipo: string
  evidencia: string
  sugestao_markdown: string | null
  confianca: string
  status: string
  created_at: string
}

export default function ContextosPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [usaAgenda, setUsaAgenda] = useState(true)
  const [salvandoAgenda, setSalvandoAgenda] = useState(false)
  const fb = useFeedback()

  const carregarSugestoes = useCallback(async () => {
    if (!empresaId) return
    try {
      const s = await apiFetch<Sugestao[]>(`/api/empresas/${empresaId}/contextos/sugestoes`)
      setSugestoes(s.data || [])
    } catch {}
  }, [empresaId])

  const carregarAgenda = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<{ usa_agenda: boolean }>(`/api/empresas/${empresaId}/agente`)
      setUsaAgenda(r.data?.usa_agenda !== false)
    } catch {}
  }, [empresaId])

  useEffect(() => { carregarSugestoes() }, [carregarSugestoes])
  useEffect(() => { carregarAgenda() }, [carregarAgenda])

  async function alterarUsaAgenda(novo: boolean) {
    if (!empresaId) return
    setUsaAgenda(novo) // otimista
    setSalvandoAgenda(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/agenda`, {
        method: 'PATCH',
        body: JSON.stringify({ usa_agenda: novo }),
      }), { sucesso: novo ? 'Agenda ativada.' : 'Agenda desativada.' })
    } catch {
      setUsaAgenda(!novo) // reverte em erro
    } finally {
      setSalvandoAgenda(false)
    }
  }

  async function reviewSugestao(id: string, acao: 'aprovar' | 'rejeitar') {
    if (!empresaId) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/sugestoes/${id}/${acao}`, { method: 'POST' }),
        { sucesso: acao === 'aprovar' ? 'Sugestão aprovada.' : 'Sugestão rejeitada.' })
      setSugestoes((prev) => prev.filter((s) => s.id !== id))
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function aplicarSugestao(id: string) {
    if (!empresaId) return
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/sugestoes/${id}/aplicar`, { method: 'POST' }), {
        pesada: true,
        sucesso: 'Rascunho gerado',
        detalhe: 'Novo rascunho criado a partir da sugestão. Revise e ative no contexto da instância.',
      })
      setSugestoes((prev) => prev.filter((s) => s.id !== id))
    } catch { /* erro já exibido pelo feedback */ }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold">Instância</h1>

      {/* Decisão que vem ANTES de tudo: esta instância usa agenda? Impacta a geração
          de contexto (cria ou não regras de reunião) e o runtime (o agente oferece ou
          nunca oferece reunião). Por isso fica no topo. */}
      <div className={`rounded-2xl border p-5 shadow-sm transition ${usaAgenda ? 'bg-white' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-sm flex items-center gap-2">🗓️ Esta instância usa agenda?</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              {usaAgenda
                ? 'Ativada: o agente tenta agendar reunião com o lead quando fizer sentido. Isso entra na geração do contexto e na conversa.'
                : 'Desativada: o agente NUNCA tenta agendar reunião — só conversa, qualifica e encaminha. As regras de reunião não são geradas no contexto.'}
            </p>
            <p className="text-[11px] text-amber-700 mt-1">
              Alterou? Gere o contexto da instância de novo abaixo para a mudança valer no texto gerado.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={usaAgenda}
            disabled={salvandoAgenda}
            onClick={() => alterarUsaAgenda(!usaAgenda)}
            className={`relative shrink-0 inline-flex h-7 w-12 items-center rounded-full transition disabled:opacity-50 ${usaAgenda ? 'bg-brand' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${usaAgenda ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Instâncias WhatsApp — cada instância é o próprio agente (o nome do agente é o
          nome da instância) e dona do seu contexto. */}
      <div className="bg-white border rounded-2xl p-5 shadow-sm">
        <InstanciasWhatsApp empresaId={empresaId} />
      </div>

      {sugestoes.length > 0 && (
        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h2 className="font-semibold text-sm">Sugestões de aprendizado pendentes</h2>
            <p className="text-xs text-gray-500 mt-0.5">A IA detectou padrões em conversas reais. Nada vai ser aplicado sem você aprovar.</p>
          </div>
          <div className="divide-y">
            {sugestoes.map((s) => (
              <div key={s.id} className="px-5 py-4 flex justify-between items-start gap-4">
                <div className="flex-1">
                  <p className="text-xs uppercase text-gray-500">{s.tipo} · confiança {s.confianca}</p>
                  <p className="text-sm mt-1">{s.evidencia}</p>
                  {s.sugestao_markdown && <pre className="mt-2 text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">{s.sugestao_markdown}</pre>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => aplicarSugestao(s.id)} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">Aplicar como rascunho</button>
                  <button onClick={() => reviewSugestao(s.id, 'aprovar')} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white">Aprovar</button>
                  <button onClick={() => reviewSugestao(s.id, 'rejeitar')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300">Rejeitar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

