'use client'
// Controle segmentado do modo de atuacao da IA. Serve os DOIS niveis da politica:
//   • Central de Mensagens — 2 opcoes (Conversa | Analise), o padrao global;
//   • conversa aberta      — 3 opcoes (Herdar | Conversa | Analise), a excecao.
//
// POR QUE NAO REUSA `components/ui/Abas.tsx`
// Abas e' `role="tablist"` com `aria-controls` apontando para um painel: a semantica diz
// "estas opcoes trocam o que voce esta vendo". Aqui nada muda na tela — muda o
// COMPORTAMENTO do sistema com o cliente. Um leitor de tela anunciando "aba selecionada"
// esconderia justamente o que importa. Por isso `role="radiogroup"`.
//
// Cor nunca e' o unico sinal: a opcao ativa tem contorno e peso proprios, o estado e a
// origem aparecem escritos ao lado, e a frase completa vai no `aria-label` do grupo.
//
// A regra de negocio nao esta aqui. Rotulos e textos vem de `lib/conversa-modo-ia.js`; o
// modo EFETIVO e a ORIGEM sao calculados no backend; a permissao de enviar tambem.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type OpcaoModo = { id: string; rotulo: string; ajuda: string }

/**
 * Balao de ajuda leve — hover, foco e toque; nunca modal (o pedido e' explicito).
 * Em portal no `<body>` e posicionado pelo rect da ancora: dentro do cabecalho do painel,
 * que tem `overflow-hidden`, uma versao `absolute` seria cortada. Mesma solucao ja usada
 * em `BolinhaPontuacao`.
 */
export function BalaoAjuda({ texto, rotuloAcessivelBotao }: { texto: string; rotuloAcessivelBotao: string }) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ancora = useRef<HTMLButtonElement | null>(null)
  const id = useId()

  function abrir() {
    const r = ancora.current?.getBoundingClientRect()
    if (!r) return
    // Abre abaixo da ancora e preso as bordas: o cabecalho fica colado no topo da tela e um
    // balao para cima sairia da viewport.
    const largura = 300
    const left = Math.min(Math.max(8, r.left + r.width / 2 - largura / 2), Math.max(8, window.innerWidth - largura - 8))
    setPos({ left, top: r.bottom + 8 })
    setAberto(true)
  }
  function fechar() { setAberto(false) }

  useEffect(() => {
    if (!aberto) return
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    window.addEventListener('keydown', aoTeclado)
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('resize', fechar)
    return () => {
      window.removeEventListener('keydown', aoTeclado)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [aberto])

  return (
    <>
      <button
        ref={ancora}
        type="button"
        aria-label={rotuloAcessivelBotao}
        aria-describedby={aberto ? id : undefined}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        onClick={() => (aberto ? fechar() : abrir())}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[11px] font-semibold text-slate-500 transition hover:border-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        i
      </button>
      {aberto && pos && typeof document !== 'undefined' && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: 300 }}
          className="pointer-events-none fixed z-[60] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700 shadow-lg"
        >
          {texto}
        </div>,
        document.body
      )}
    </>
  )
}

export default function AlternadorModoIa({
  opcoes,
  selecionado,
  onMudar,
  ariaLabel,
  estado,
  ocupado = false,
  compacto = false,
}: {
  opcoes: OpcaoModo[]
  selecionado: string
  onMudar: (novo: string) => void
  /** Frase completa (estado + consequencia + origem) para o leitor de tela. */
  ariaLabel: string
  /** Estado por extenso, ao lado do controle. Cor nunca e' o unico sinal. */
  estado?: string
  /** Desabilita o controle enquanto o PATCH esta em voo. */
  ocupado?: boolean
  compacto?: boolean
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const ativa = opcoes.find((o) => o.id === selecionado) || opcoes[0]

  // Navegacao por setas dentro do grupo, como manda o padrao de radiogroup.
  function aoTeclado(e: React.KeyboardEvent, indice: number) {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return
    e.preventDefault()
    const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const alvo = opcoes[(indice + passo + opcoes.length) % opcoes.length]
    refs.current[alvo.id]?.focus()
    if (!ocupado) onMudar(alvo.id)
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
      >
        {opcoes.map((o, i) => {
          const marcada = o.id === ativa?.id
          return (
            <button
              key={o.id}
              ref={(el) => { refs.current[o.id] = el }}
              type="button"
              role="radio"
              aria-checked={marcada}
              aria-label={`${o.rotulo}. ${o.ajuda}`}
              tabIndex={marcada ? 0 : -1}
              disabled={ocupado}
              onClick={() => onMudar(o.id)}
              onKeyDown={(e) => aoTeclado(e, i)}
              className={`rounded-md ${compacto ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                marcada
                  ? 'border border-brand bg-white text-brand shadow-sm'
                  : 'border border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {o.rotulo}
            </button>
          )
        })}
      </div>
      {(ocupado || estado) && (
        <span className="text-xs text-slate-600" aria-live="polite">
          {ocupado ? 'Atualizando…' : estado}
        </span>
      )}
      {ativa && <BalaoAjuda texto={ativa.ajuda} rotuloAcessivelBotao={`O que significa a opção ${ativa.rotulo}`} />}
    </div>
  )
}
