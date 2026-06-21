'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
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
      <h1 className="text-2xl font-bold">Empresas</h1>

      {/* Hero — Agente + Instâncias WhatsApp (cada instância é dona do seu contexto) */}
      <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-5">
        <AgentePanel empresaId={empresaId} />
        <div className="border-t pt-5">
          <InstanciasWhatsApp empresaId={empresaId} />
        </div>
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

// ─── Painel do Agente (nome da empresa) — no Hero, para qualquer empresa ───────
// O liga/desliga global do agente saiu daqui: o controle agora é por número, na
// linha de cada instância WhatsApp (botão Ativar/Desativar).
function AgentePanel({ empresaId }: { empresaId: string }) {
  const [nome, setNome] = useState('')
  const [nomeSalvo, setNomeSalvo] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [salvandoNome, setSalvandoNome] = useState(false)
  const fb = useFeedback()

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const emp = await apiFetch<{ nome: string }>(`/api/empresas/${empresaId}`)
      setNome(emp.data.nome || '')
      setNomeSalvo(emp.data.nome || '')
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro ao carregar.' })
    }
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  async function salvarNome() {
    setSalvandoNome(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}`, { method: 'PUT', body: JSON.stringify({ nome }) }),
        { sucesso: 'Nome salvo.' })
      setNomeSalvo(nome)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSalvandoNome(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Agente</h2>
        <p className="text-xs text-gray-500 mt-0.5">Nome do agente/empresa. O liga/desliga é por número, na linha de cada instância abaixo.</p>
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Nome do agente / empresa</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button
          onClick={salvarNome}
          disabled={salvandoNome || nome.trim().length < 2 || nome === nomeSalvo}
          className="inline-flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {salvandoNome && <Spinner />}
          {salvandoNome ? 'Salvando…' : 'Salvar nome'}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.tone === 'ok' ? 'text-brand' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
