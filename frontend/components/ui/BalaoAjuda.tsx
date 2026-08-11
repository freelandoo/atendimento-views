'use client'
// Icone de informacao + balao curto de ajuda. DONO UNICO deste padrao.
//
// Nasceu dentro de `AlternadorModoIa.tsx` e foi extraido quando o segundo controle de
// ativacao (o do Follow-up automatico) passou a precisar do mesmo icone: duas copias
// divergiriam em posicionamento, foco e fechamento — que e' justamente a parte dificil.
// `AlternadorModoIa` continua REEXPORTANDO daqui (mesmo padrao de `lib/paginacao.js`),
// entao nada que ja importava dele quebrou.
//
// Disponivel por mouse (hover), teclado (foco) e toque (clique). Nunca modal: e' ajuda
// leve, e prender o operador num dialogo para ler uma frase seria pior que o texto fixo
// que este balao substituiu.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function BalaoAjuda({
  texto,
  rotuloAcessivelBotao,
}: {
  texto: string
  /** O que o icone faz, para quem nao ve a tela. Ex.: "O que significa a opção Análise". */
  rotuloAcessivelBotao: string
}) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ancora = useRef<HTMLButtonElement | null>(null)
  const id = useId()

  function abrir() {
    const r = ancora.current?.getBoundingClientRect()
    if (!r) return
    // Abre abaixo da ancora e preso as bordas: estes controles vivem no TOPO da tela e um
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
