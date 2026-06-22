'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Spinner } from '@/components/feedback/FeedbackProvider'

type Prompt = { arquivo: string; titulo: string; gatilho: string; usa_empresa: boolean; chars: number; conteudo: string }
type MsgItem = { chave: string; label: string; texto: string }
type MsgGrupo = { grupo: string; titulo: string; gatilho: string; itens: MsgItem[] }
type Catalogo = { prompts: Prompt[]; mensagens: MsgGrupo[]; observacao: string }

export default function PromptsPage() {
  const [data, setData] = useState<Catalogo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const r = await apiFetch<Catalogo>('/api/prompts-catalogo')
      setData(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o catálogo.')
    } finally {
      setCarregando(false)
    }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prompts &amp; Saudações</h1>
        <p className="text-sm text-gray-500 mt-1">
          Tudo que o agente fala automaticamente, e o <strong>gatilho</strong> que dispara cada um. Todos os textos usam{' '}
          <code className="px-1 rounded bg-gray-100 text-[12px]">{'{{empresa}}'}</code>, trocado em tempo real pelo nome da empresa/instância — sem nome de marca fixo.
        </p>
      </div>

      {data?.observacao && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl px-4 py-3 text-sm">
          {data.observacao}
        </div>
      )}
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{erro}</div>}

      {carregando ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm"><Spinner /> Carregando catálogo…</div>
      ) : !data ? null : (
        <>
          {/* ─── Prompts (cabeça da IA) ─── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Prompts da IA <span className="text-gray-400 font-normal normal-case">— {data.prompts.length} arquivos</span>
            </h2>
            <div className="space-y-1.5">
              {data.prompts.map((p) => {
                const open = aberto === p.arquivo
                return (
                  <div key={p.arquivo} className="bg-white border rounded-xl overflow-hidden">
                    <button onClick={() => setAberto(open ? null : p.arquivo)} className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                          <span className="text-sm font-semibold">{p.titulo}</span>
                          <code className="text-[11px] text-gray-400">{p.arquivo}</code>
                          {p.usa_empresa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">usa {'{{empresa}}'}</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 ml-6"><strong className="text-gray-600">Gatilho:</strong> {p.gatilho}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap mt-1">{p.chars.toLocaleString('pt-BR')} chars</span>
                    </button>
                    {open && (
                      <pre className="px-4 pb-4 text-[11px] font-mono text-gray-700 whitespace-pre-wrap break-words border-t bg-gray-50/50 pt-3">{p.conteudo}</pre>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* ─── Saudações + Gatilhos da agenda ─── */}
          {data.mensagens.map((g) => (
            <section key={g.grupo} className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                {g.titulo} <span className="text-gray-400 font-normal normal-case">— {g.itens.length} textos</span>
              </h2>
              <p className="text-xs text-gray-500"><strong>Gatilho:</strong> {g.gatilho} <span className="text-gray-400">· editáveis por empresa em Empresas → contexto → Mensagens automáticas.</span></p>
              <div className="bg-white border rounded-xl divide-y">
                {g.itens.map((it) => (
                  <div key={it.chave} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{it.label}</span>
                      <code className="text-[10px] text-gray-400">{it.chave}</code>
                    </div>
                    <p className="text-[12px] text-gray-600 mt-1 font-mono whitespace-pre-wrap">{it.texto}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
