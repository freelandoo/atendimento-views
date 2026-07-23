'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import InstanciasWhatsApp from '@/components/InstanciasWhatsApp'
import InstanciasFreelandoo from '@/components/InstanciasFreelandoo'

type Sugestao = {
  id: string
  tipo: string
  evidencia: string
  sugestao_markdown: string | null
  sugestao_json?: Record<string, unknown>
  confianca: string
  status: string
  created_at: string
  contexto_nome?: string | null
  feedback?: {
    id: string
    tipo: string
    tags: string[]
    observacao: string | null
    lead_phone: string
    evolution_instance: string | null
    mensagem_index: number
    mensagem_snapshot?: {
      mensagem?: { content?: string }
      janela?: Array<{ role?: string; content?: string }>
    }
    created_at: string
  } | null
}

type AplicarSugestaoResp = {
  versao_novo_draft?: { id: string; versao: number }
  sugestao_id: string
  diff?: {
    json_paths_changed?: string[]
    markdown?: {
      total_changed_lines: number
      truncated?: boolean
      changes: Array<{ line: number; before: string; after: string }>
    }
  }
}

export default function ContextosPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [ultimoDiff, setUltimoDiff] = useState<AplicarSugestaoResp | null>(null)
  const fb = useFeedback()

  const carregarSugestoes = useCallback(async () => {
    if (!empresaId) return
    try {
      const s = await apiFetch<Sugestao[]>(`/api/empresas/${empresaId}/contextos/sugestoes`)
      setSugestoes(s.data || [])
    } catch {}
  }, [empresaId])

  useEffect(() => { carregarSugestoes() }, [carregarSugestoes])

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
      const r = await fb.runTask(() => apiFetch<AplicarSugestaoResp>(`/api/empresas/${empresaId}/contextos/sugestoes/${id}/aplicar`, { method: 'POST' }), {
        pesada: true,
        sucesso: 'Rascunho gerado',
        detalhe: 'Novo rascunho criado a partir da sugestão. Revise e ative no contexto da instância.',
      })
      setUltimoDiff(r.data)
      setSugestoes((prev) => prev.filter((s) => s.id !== id))
    } catch { /* erro já exibido pelo feedback */ }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold">Instância</h1>

      {/* Instâncias WhatsApp — cada instância é o próprio agente (o nome do agente é o
          nome da instância) e dona do seu contexto. O "usa agenda?" é regra de cada
          instância e vive dentro do card dela. */}
      <div className="bg-white border rounded-2xl p-5 shadow-sm">
        <InstanciasWhatsApp empresaId={empresaId} />
      </div>

      {/* Instância Freelandoo — mesma ideia da instância WhatsApp, mas conectada
          por token de API (não por QR Code). Mesmo contexto/agenda/motor. */}
      <div className="bg-white border rounded-2xl p-5 shadow-sm">
        <InstanciasFreelandoo empresaId={empresaId} />
      </div>

      {(sugestoes.length > 0 || ultimoDiff) && (
        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h2 className="font-semibold text-sm">Sugestões de aprendizado pendentes</h2>
            <p className="text-xs text-gray-500 mt-0.5">A IA detectou padrões em conversas reais. Nada vai ser aplicado sem você aprovar.</p>
          </div>
          {ultimoDiff && (
            <div className="border-b bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
              <div className="font-semibold">
                Rascunho v{ultimoDiff.versao_novo_draft?.versao ?? '?'} criado. Revise antes de ativar.
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-white/70 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Secoes JSON alteradas</div>
                  <div className="mt-1 text-xs text-slate-700">
                    {ultimoDiff.diff?.json_paths_changed?.length
                      ? ultimoDiff.diff.json_paths_changed.slice(0, 12).join(', ')
                      : 'Nenhuma secao JSON alterada detectada.'}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white/70 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Markdown</div>
                  <div className="mt-1 text-xs text-slate-700">
                    {ultimoDiff.diff?.markdown?.total_changed_lines || 0} linhas alteradas
                    {ultimoDiff.diff?.markdown?.truncated ? ' (resumo parcial)' : ''}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="divide-y">
            {sugestoes.map((s) => (
              <div key={s.id} className="px-5 py-4 flex justify-between items-start gap-4">
                <div className="flex-1">
                  <p className="text-xs uppercase text-gray-500">{s.tipo} · confiança {s.confianca}</p>
                  <p className="text-sm mt-1">{s.evidencia}</p>
                  {s.feedback && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                        <span>Origem: Conversa</span>
                        {s.contexto_nome && <span>Contexto: {s.contexto_nome}</span>}
                        {s.feedback.evolution_instance && <span>Instancia: {s.feedback.evolution_instance}</span>}
                        {s.feedback.lead_phone && <span>Lead: {s.feedback.lead_phone}</span>}
                      </div>
                      {s.feedback.observacao && <p className="font-medium">{s.feedback.observacao}</p>}
                      {s.feedback.tags?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.feedback.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-800">{tag}</span>
                          ))}
                        </div>
                      )}
                      {s.feedback.mensagem_snapshot?.mensagem?.content && (
                        <blockquote className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-amber-100 bg-white p-2 text-slate-700">
                          {s.feedback.mensagem_snapshot.mensagem.content}
                        </blockquote>
                      )}
                    </div>
                  )}
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

