'use client'
import { useState } from 'react'

// Modal do "JSON de apresentação" do lead: dados unificados + prompt único
// pro bot gerar a saudação de análise. Usado nas tabelas de Aquisição
// (Google Places e Instagram).
export type JsonApresentacao = {
  fonte: string
  prompt: string
  pontuacao?: { total: number; maximo: number }
  [k: string]: unknown
}

export default function JsonLeadModal({ titulo, json, onFechar }: {
  titulo: string
  json: JsonApresentacao
  onFechar: () => void
}) {
  const [aba, setAba] = useState<'prompt' | 'json'>('prompt')
  const [copiado, setCopiado] = useState<'prompt' | 'json' | null>(null)

  async function copiar(tipo: 'prompt' | 'json') {
    const texto = tipo === 'prompt' ? json.prompt : JSON.stringify(json, null, 2)
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(tipo)
      setTimeout(() => setCopiado(null), 1500)
    } catch { /* clipboard indisponível (http) — usuário pode selecionar manualmente */ }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{titulo}</h3>
            {json.pontuacao && (
              <p className="text-xs text-slate-500">Pontuação do cadastro: <b>{json.pontuacao.total}/{json.pontuacao.maximo}</b></p>
            )}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>

        <div className="flex gap-1">
          <button onClick={() => setAba('prompt')} className={`px-2.5 py-1 rounded text-xs ${aba === 'prompt' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Prompt unificado</button>
          <button onClick={() => setAba('json')} className={`px-2.5 py-1 rounded text-xs ${aba === 'json' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>JSON completo</button>
        </div>

        <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded-lg max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words">
          {aba === 'prompt' ? json.prompt : JSON.stringify(json, null, 2)}
        </pre>

        <div className="flex justify-end gap-2">
          <button onClick={() => copiar('prompt')} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-slate-50">
            {copiado === 'prompt' ? '✓ Copiado' : 'Copiar prompt'}
          </button>
          <button onClick={() => copiar('json')} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white">
            {copiado === 'json' ? '✓ Copiado' : 'Copiar JSON'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Cabeçalho de coluna ordenável (asc/desc) das tabelas de Aquisição.
export function ThOrdenavel({ label, chave, ordem, onOrdenar, align = 'left' }: {
  label: string
  chave: string
  ordem: { chave: string; dir: 'asc' | 'desc' }
  onOrdenar: (chave: string) => void
  align?: 'left' | 'right'
}) {
  const ativa = ordem.chave === chave
  return (
    <th className={`px-3 py-2 text-${align} whitespace-nowrap`}>
      <button onClick={() => onOrdenar(chave)}
        className={`inline-flex items-center gap-1 hover:text-brand ${ativa ? 'text-brand font-semibold' : ''}`}
        title="Ordenar (clique alterna maior→menor / menor→maior)">
        {label}
        <span className="text-[9px]">{ativa ? (ordem.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}
