'use client'
import { useRef } from 'react'

// Grupo de abas acessível (padrão WAI-ARIA tabs): teclado com setas/Home/End,
// foco visível, aria-selected e vínculo aba ↔ painel. Visual igual ao seletor de
// sessões da página de Aquisição (pílulas dentro de um trilho arredondado); em
// telas estreitas o trilho rola na horizontal em vez de quebrar o layout.

export type Aba = { id: string; titulo: string; descricao?: string }

export default function Abas({
  abas,
  ativa,
  onMudar,
  idBase,
  ariaLabel = 'Abas',
}: {
  abas: Aba[]
  ativa: string
  onMudar: (id: string) => void
  // Prefixo dos ids de aba/painel — permite mais de um grupo de abas na mesma tela.
  idBase: string
  ariaLabel?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function mover(indice: number) {
    const alvo = abas[(indice + abas.length) % abas.length]
    if (!alvo) return
    onMudar(alvo.id)
    refs.current[alvo.id]?.focus()
  }

  function aoTeclado(e: React.KeyboardEvent, atual: number) {
    if (e.key === 'ArrowRight') { e.preventDefault(); mover(atual + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(atual - 1) }
    else if (e.key === 'Home') { e.preventDefault(); mover(0) }
    else if (e.key === 'End') { e.preventDefault(); mover(abas.length - 1) }
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1 py-1">
      <div role="tablist" aria-label={ariaLabel} className="inline-flex w-max gap-1 rounded-xl border bg-white p-1 shadow-sm">
        {abas.map((a, i) => {
          const selecionada = a.id === ativa
          return (
            <button
              key={a.id}
              ref={(el) => { refs.current[a.id] = el }}
              role="tab"
              id={`${idBase}-aba-${a.id}`}
              aria-selected={selecionada}
              aria-controls={`${idBase}-painel-${a.id}`}
              tabIndex={selecionada ? 0 : -1}
              title={a.descricao}
              onClick={() => onMudar(a.id)}
              onKeyDown={(e) => aoTeclado(e, i)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
                selecionada ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {a.titulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PainelAba({
  id,
  idBase,
  ativa,
  children,
}: {
  id: string
  idBase: string
  ativa: string
  children: React.ReactNode
}) {
  const visivel = id === ativa
  return (
    <div
      role="tabpanel"
      id={`${idBase}-painel-${id}`}
      aria-labelledby={`${idBase}-aba-${id}`}
      hidden={!visivel}
      tabIndex={0}
      className={visivel ? 'focus:outline-none' : undefined}
    >
      {visivel && children}
    </div>
  )
}
