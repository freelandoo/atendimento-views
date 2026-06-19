'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Conversa = {
  numero: string
  estagio: string
  status: string
  negocio?: string
  temperatura_lead?: string | null
  score_dor?: number | null
  atualizado_em: string
}

const TEMP_STYLE: Record<string, { label: string; cls: string }> = {
  quente: { label: '🔥 Quente', cls: 'bg-orange-100 text-orange-700' },
  morno: { label: '🌤️ Morno', cls: 'bg-amber-100 text-amber-700' },
  frio: { label: '❄️ Frio', cls: 'bg-sky-100 text-sky-700' },
}

function TempBadge({ t }: { t?: string | null }) {
  if (!t || !TEMP_STYLE[t]) return <span className="text-gray-400 text-xs">—</span>
  return <span className={`px-2 py-0.5 rounded-full text-xs ${TEMP_STYLE[t].cls}`}>{TEMP_STYLE[t].label}</span>
}
type Mensagem = { role?: string; content?: string; text?: string; timestamp?: string }
type ConversaDetail = Conversa & {
  historico?: Mensagem[]
  ultima_falha_resposta_codigo?: string | null
  ultima_falha_resposta_msg?: string | null
  ultima_falha_resposta_em?: string | null
}

function fmtNumero(n: string): string {
  return String(n || '').replace('@s.whatsapp.net', '').replace(/^(\d{2})(\d{2})(\d)(\d{4})(\d{4})$/, '+$1 ($2) $3$4-$5')
}

function fmtData(s?: string): string {
  if (!s) return ''
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ConversasPage() {
  const [lista, setLista] = useState<Conversa[]>([])
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<ConversaDetail | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [reenviando, setReenviando] = useState(false)

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function carregar() {
    if (!empresaId) return
    apiFetch<Conversa[]>(`/api/empresas/${empresaId}/conversas?limit=50`)
      .then((r) => setLista(r.data))
      .catch((e) => setErro(e.message))
  }

  useEffect(() => { carregar() }, [empresaId])

  async function removerConversa(c: Conversa) {
    if (!empresaId) return
    if (!confirm(`Remover ${fmtNumero(c.numero)} do banco?\n\nIsso apaga a conversa, perfil do lead e insights. Ação irreversível.`)) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`, { method: 'DELETE' })
      setLista((prev) => prev.filter((x) => x.numero !== c.numero))
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover.')
    }
  }

  async function abrirHistorico(c: Conversa) {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    try {
      const r = await apiFetch<ConversaDetail>(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(c.numero)}`)
      setAberta(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar histórico.')
    } finally {
      setCarregando(false)
    }
  }

  async function deletarHistorico() {
    if (!aberta || !empresaId) return
    if (!confirm(`Apagar TODO o histórico de ${fmtNumero(aberta.numero)}?\n\nIsso limpa as mensagens, reseta o estágio e despausa o agente. A próxima mensagem do contato vai começar do zero.\n\nAção irreversível.`)) return
    setApagando(true)
    try {
      await apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/historico`, { method: 'DELETE' })
      setAberta((p) => p ? { ...p, historico: [], estagio: 'primeiro_contato' } : p)
      await new Promise((r) => setTimeout(r, 200))
      carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao apagar.')
    } finally {
      setApagando(false)
    }
  }

  async function reenviarUltimaResposta() {
    if (!aberta || !empresaId) return
    setReenviando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/conversas/${encodeURIComponent(aberta.numero)}/reprocessar`, { method: 'POST' })
      setAberta((p) => p ? {
        ...p,
        ultima_falha_resposta_codigo: null,
        ultima_falha_resposta_msg: null,
        ultima_falha_resposta_em: null,
      } : p)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao reenviar.')
    } finally {
      setReenviando(false)
    }
  }

  const historicoAberto = aberta?.historico || []
  const ultimaMensagemAberta = historicoAberto[historicoAberto.length - 1]
  const podeReenviarUltimaResposta = ultimaMensagemAberta?.role === 'assistant'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conversas</h1>
      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      <table className="w-full text-sm border rounded-xl overflow-hidden bg-white shadow-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-4 py-2">Número</th>
            <th className="text-left px-4 py-2">Negócio</th>
            <th className="text-left px-4 py-2">Temperatura</th>
            <th className="text-left px-4 py-2">Estágio</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-right px-4 py-2">Atualizado</th>
            <th className="text-right px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.numero} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2 font-mono text-xs">{fmtNumero(c.numero)}</td>
              <td className="px-4 py-2">{c.negocio || '—'}</td>
              <td className="px-4 py-2"><TempBadge t={c.temperatura_lead} /></td>
              <td className="px-4 py-2">{c.estagio}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-2 text-right text-gray-500">
                {fmtData(c.atualizado_em)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => abrirHistorico(c)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
                  >
                    Histórico
                  </button>
                  <button
                    onClick={() => removerConversa(c)}
                    title="Remover contato e dados deste número"
                    aria-label="Remover"
                    className="text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18"/>
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/>
                      <path d="M14 11v6"/>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Nenhuma conversa encontrada.</td></tr>
          )}
        </tbody>
      </table>

      {aberta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAberta(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b flex justify-between items-start gap-3">
              <div>
                <h3 className="font-semibold">{fmtNumero(aberta.numero)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Estágio: <span className="font-medium">{aberta.estagio}</span> ·
                  Status: <span className="font-medium">{aberta.status}</span> ·
                  {aberta.historico?.length || 0} msgs
                </p>
              </div>
              <button
                onClick={() => setAberta(null)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 px-5 py-4 space-y-2">
              {carregando ? (
                <p className="text-sm text-center text-gray-500 py-8">Carregando…</p>
              ) : !aberta.historico || aberta.historico.length === 0 ? (
                <p className="text-sm text-center text-gray-400 py-8">Sem mensagens no histórico.</p>
              ) : (
                aberta.historico.map((m, i) => {
                  const isUser = m.role === 'user'
                  const isAssistant = m.role === 'assistant'
                  const isOperator = m.role === 'operator'
                  const bubble = isUser
                    ? 'bg-white border border-gray-200 mr-auto'
                    : isAssistant
                      ? 'bg-brand text-white ml-auto'
                      : isOperator
                        ? 'bg-amber-100 text-amber-900 ml-auto'
                        : 'bg-gray-200 text-gray-700 mx-auto'
                  const label = isUser ? 'Lead' : isAssistant ? 'Agente' : isOperator ? 'Operador' : (m.role || '?')
                  return (
                    <div key={i} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${bubble}`}>
                      <div className={`text-[10px] uppercase mb-0.5 ${isAssistant ? 'text-white/70' : 'text-gray-500'}`}>{label}</div>
                      <div className="whitespace-pre-wrap break-words">{m.content || m.text || '(vazio)'}</div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-5 py-3 border-t flex flex-wrap justify-between items-center gap-3">
              <button
                onClick={deletarHistorico}
                disabled={apagando || !aberta.historico?.length}
                className="text-xs px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apagando ? 'Apagando…' : 'Deletar histórico'}
              </button>
              <button
                onClick={reenviarUltimaResposta}
                disabled={reenviando || !podeReenviarUltimaResposta}
                className="text-xs px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reenviando ? 'Reenviando...' : 'Reenviar WhatsApp'}
              </button>
              <button
                onClick={() => setAberta(null)}
                className="text-sm px-3 py-2 border rounded-lg"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
