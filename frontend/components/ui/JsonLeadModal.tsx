'use client'
import { useState } from 'react'
import { classesFolha, classesFundoFolha } from '@/lib/ui-primitivos'

// Modal do "JSON de apresentação" do lead: dados unificados + prompt único
// pro bot gerar a saudação de análise. Usado nas tabelas de Aquisição
// (Google Places e Instagram).
export type CriterioApresentacao = {
  chave?: string
  label: string
  ok: boolean
  pontos?: number
  pontos_possiveis?: number
}

export type JsonApresentacao = {
  fonte: string
  prompt: string
  // `criterios` sempre veio do backend (lead-score-cadastro.js) — só não estava declarado
  // aqui. É a lista auditável que alimenta o tooltip da bolinha e o painel de detalhes.
  pontuacao?: { total: number; maximo: number; criterios?: CriterioApresentacao[] }
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
    /* Mesma geometria dos demais (lib/ui-primitivos.js): folha no celular, modal no computador. */
    <div className={classesFundoFolha()} onClick={onFechar}>
      <div className={classesFolha({ tamanho: 'md', extra: 'p-4 sm:p-5' })} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{titulo}</h3>
            {json.pontuacao && (
              <p className="text-xs text-slate-500">Pontuação do cadastro: <b>{json.pontuacao.total}/{json.pontuacao.maximo}</b></p>
            )}
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-ink-3 hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">×</button>
        </div>

        <div className="mb-2 flex shrink-0 gap-1">
          <button onClick={() => setAba('prompt')} className={`min-h-9 rounded px-2.5 py-1 text-xs ${aba === 'prompt' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Prompt unificado</button>
          <button onClick={() => setAba('json')} className={`min-h-9 rounded px-2.5 py-1 text-xs ${aba === 'json' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>JSON completo</button>
        </div>

        {/* O bloco rola dentro do painel: a altura vem do flex, não de um `55vh` que ignora o
            resto do conteúdo e estoura a tela do celular. */}
        <pre className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-lg bg-gray-900 p-3 text-[11px] text-gray-100">
          {aba === 'prompt' ? json.prompt : JSON.stringify(json, null, 2)}
        </pre>

        <div className="mt-3 flex shrink-0 justify-end gap-2">
          <button onClick={() => copiar('prompt')} className="min-h-11 rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50 sm:min-h-0">
            {copiado === 'prompt' ? '✓ Copiado' : 'Copiar prompt'}
          </button>
          <button onClick={() => copiar('json')} className="min-h-11 rounded-lg bg-brand px-3 py-1.5 text-xs text-white sm:min-h-0">
            {copiado === 'json' ? '✓ Copiado' : 'Copiar JSON'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Cabeçalho de coluna ordenável (asc/desc) das tabelas de Aquisição.
export function ThOrdenavel({ label, chave, ordem, onOrdenar, align = 'left', className = '' }: {
  label: string
  chave: string
  ordem: { chave: string; dir: 'asc' | 'desc' }
  onOrdenar: (chave: string) => void
  align?: 'left' | 'right'
  /** Layout do chamador (coluna congelada, largura). Aditivo — nunca cor nem padding. */
  className?: string
}) {
  const ativa = ordem.chave === chave
  return (
    <th className={`px-3 py-2 text-${align} whitespace-nowrap ${className}`}>
      <button onClick={() => onOrdenar(chave)}
        className={`inline-flex items-center gap-1 hover:text-brand ${ativa ? 'text-brand font-semibold' : ''}`}
        title="Ordenar (clique alterna maior→menor / menor→maior)">
        {label}
        <span className="text-[9px]">{ativa ? (ordem.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}
