'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Contexto = { id: string; nome: string; conteudo: string; criado_em: string }
type Versao = {
  id: string
  versao: number
  conteudo_json: Record<string, unknown>
  gerado_por: string
  status: 'rascunho' | 'ativo' | 'arquivado'
  criado_em: string
  ativado_em: string | null
}

export default function ContextosPage() {
  const [lista, setLista] = useState<Contexto[]>([])
  const [nome, setNome] = useState('')
  const [conteudo, setConteudo] = useState('')
  const [gerando, setGerando] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const [versoes, setVersoes] = useState<Record<string, Versao[]>>({})
  const [loadingVersoes, setLoadingVersoes] = useState<Record<string, boolean>>({})

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  useEffect(() => {
    if (!empresaId) return
    apiFetch<Contexto[]>(`/api/empresas/${empresaId}/contextos`)
      .then((r) => setLista(r.data))
      .catch(() => {})
  }, [empresaId])

  async function carregarVersoes(contextoId: string) {
    if (!empresaId) return
    setLoadingVersoes((p) => ({ ...p, [contextoId]: true }))
    try {
      const r = await apiFetch<Versao[]>(`/api/empresas/${empresaId}/contextos/${contextoId}/versoes`)
      setVersoes((p) => ({ ...p, [contextoId]: r.data }))
    } catch {
      setVersoes((p) => ({ ...p, [contextoId]: [] }))
    } finally {
      setLoadingVersoes((p) => ({ ...p, [contextoId]: false }))
    }
  }

  async function toggle(contextoId: string) {
    const novoEstado = !aberto[contextoId]
    setAberto((p) => ({ ...p, [contextoId]: novoEstado }))
    if (novoEstado && !versoes[contextoId]) await carregarVersoes(contextoId)
  }

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
      setMsg('Contexto 2 gerado como rascunho. Expanda para visualizar.')
      setAberto((p) => ({ ...p, [contextoId]: true }))
      await carregarVersoes(contextoId)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao gerar plano.')
    } finally {
      setGerando(null)
    }
  }

  async function ativar(contextoId: string, versaoId: string) {
    if (!empresaId) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/versoes/${versaoId}/ativar`, { method: 'POST' })
      await carregarVersoes(contextoId)
      setMsg('Versão ativada.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao ativar.')
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
        {lista.map((c) => {
          const isOpen = !!aberto[c.id]
          const vs = versoes[c.id] || []
          return (
            <div key={c.id} className="bg-white border rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 flex justify-between items-start gap-4">
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="flex items-start gap-3 text-left flex-1 hover:opacity-80"
                >
                  <span className={`mt-1 inline-block transition-transform text-gray-400 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="flex-1">
                    <span className="block font-medium">{c.nome}</span>
                    <span className="block text-xs text-gray-500 mt-1 line-clamp-2">{c.conteudo}</span>
                  </span>
                </button>
                <button
                  onClick={() => gerarPlano(c.id)}
                  disabled={gerando === c.id}
                  className="shrink-0 bg-gray-100 hover:bg-brand hover:text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {gerando === c.id ? 'Gerando…' : 'Gerar Contexto 2'}
                </button>
              </div>

              {isOpen && (
                <div className="border-t bg-gray-50 px-5 py-4 space-y-3">
                  {loadingVersoes[c.id] ? (
                    <p className="text-xs text-gray-500">Carregando versões…</p>
                  ) : vs.length === 0 ? (
                    <p className="text-xs text-gray-500">Nenhum Contexto 2 gerado ainda. Clique em "Gerar Contexto 2".</p>
                  ) : (
                    vs.map((v) => <VersaoCard key={v.id} versao={v} onAtivar={() => ativar(c.id, v.id)} />)
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VersaoCard({ versao, onAtivar }: { versao: Versao; onAtivar: () => void }) {
  const [aberto, setAberto] = useState(false)
  const badgeClass = versao.status === 'ativo'
    ? 'bg-green-100 text-green-700'
    : versao.status === 'rascunho'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-600'

  const json = typeof versao.conteudo_json === 'object'
    ? JSON.stringify(versao.conteudo_json, null, 2)
    : String(versao.conteudo_json)

  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">
            Versão {versao.versao}
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
              {versao.status}
            </span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Gerado em {new Date(versao.criado_em).toLocaleString('pt-BR')} · por {versao.gerado_por}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAberto((p) => !p)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100"
          >
            {aberto ? 'Ocultar' : 'Ver conteúdo'}
          </button>
          {versao.status !== 'ativo' && (
            <button
              type="button"
              onClick={onAtivar}
              className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark"
            >
              Ativar
            </button>
          )}
        </div>
      </div>
      {aberto && (
        <pre className="mt-3 text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
          {json}
        </pre>
      )}
    </div>
  )
}
