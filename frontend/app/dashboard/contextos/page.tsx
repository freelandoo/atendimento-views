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

      {/* Instâncias WhatsApp — cada instância é o próprio agente (o nome do agente é o
          nome da instância) e dona do seu contexto. O "usa agenda?" é regra de cada
          instância e vive dentro do card dela. */}
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

