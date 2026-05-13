'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Contexto = { id: string; nome: string; conteudo: string; criado_em: string }

export default function ContextosPage() {
  const [lista, setLista] = useState<Contexto[]>([])
  const [nome, setNome] = useState('')
  const [conteudo, setConteudo] = useState('')
  const [gerando, setGerando] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  useEffect(() => {
    if (!empresaId) return
    apiFetch<Contexto[]>(`/api/empresas/${empresaId}/contextos`)
      .then((r) => setLista(r.data))
      .catch(() => {})
  }, [empresaId])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    const r = await apiFetch<Contexto>(`/api/empresas/${empresaId}/contextos`, {
      method: 'POST',
      body: JSON.stringify({ nome, conteudo }),
    })
    setLista((prev) => [r.data, ...prev])
    setNome('')
    setConteudo('')
  }

  async function gerarPlano(contextoId: string) {
    if (!empresaId) return
    setGerando(contextoId)
    setMsg('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/gerar-plano`, { method: 'POST' })
      setMsg('Contexto 2 gerado como rascunho. Acesse as versões para ativar.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao gerar plano.')
    } finally {
      setGerando(null)
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Contextos</h1>

      <form onSubmit={criar} className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-semibold">Novo Contexto 1</h2>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do contexto"
          required
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
        <textarea
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          placeholder="Descreva sua empresa, serviços, diferencias, público-alvo…"
          rows={5}
          required
          className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
        />
        <button className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark">
          Criar contexto
        </button>
      </form>

      {msg && <p className="text-sm text-brand">{msg}</p>}

      <div className="space-y-3">
        {lista.map((c) => (
          <div key={c.id} className="bg-white border rounded-2xl p-5 shadow-sm flex justify-between items-start gap-4">
            <div>
              <p className="font-medium">{c.nome}</p>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.conteudo}</p>
            </div>
            <button
              onClick={() => gerarPlano(c.id)}
              disabled={gerando === c.id}
              className="shrink-0 bg-gray-100 hover:bg-brand hover:text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {gerando === c.id ? 'Gerando…' : 'Gerar Contexto 2'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
