'use client'
import { useEffect, useRef } from 'react'
import { IconClose } from '@/components/ui/icons'

// Modal de confirmacao acessivel. Existe porque o resto do painel usa `window.confirm`, que
// nao permite nomear a entidade com destaque, separar aviso de corpo, nem rotular o botao com
// o verbo da acao — e some do fluxo de foco do teclado.
//
// Contrato de foco (a parte que o window.confirm dava de graca e uma <div> nao da):
//   - ao abrir, o foco vai para o botao de confirmar;
//   - Tab e Shift+Tab circulam DENTRO do modal (nao vazam para a pagina atras);
//   - Escape e clique no fundo cancelam;
//   - ao fechar, o foco VOLTA para o elemento que abriu o modal.
// A volta do foco usa o elemento ativo no momento da montagem, nao um id combinado: assim
// funciona para qualquer gatilho sem que a tela precise saber disso.
export default function ModalConfirmar({
  titulo,
  corpo,
  aviso = null,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar',
  tom = 'neutro',
  ocupado = false,
  onConfirmar,
  onCancelar,
}: {
  titulo: string
  corpo: string
  aviso?: string | null
  rotuloConfirmar?: string
  rotuloCancelar?: string
  /** `perigo` so muda a cor do botao — nao ha acao destrutiva neste modulo hoje. */
  tom?: 'neutro' | 'perigo'
  ocupado?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const painel = useRef<HTMLDivElement>(null)
  const confirmar = useRef<HTMLButtonElement>(null)
  const origem = useRef<HTMLElement | null>(null)

  // Guarda a origem e devolve o foco na desmontagem. Dependencias vazias de proposito: o
  // elemento de origem e' o que estava ativo quando o modal ABRIU, e re-renders nao mudam isso.
  useEffect(() => {
    origem.current = document.activeElement as HTMLElement | null
    confirmar.current?.focus()
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = anterior
      origem.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancelar(); return }
      if (e.key !== 'Tab' || !painel.current) return
      const focaveis = painel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, textarea, select')
      if (!focaveis.length) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
      else if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [onCancelar])

  const corConfirmar = tom === 'perigo'
    ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500'
    : 'bg-brand hover:bg-brand-dark focus-visible:ring-brand'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancelar}>
      <div
        ref={painel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-confirmar-titulo"
        aria-describedby="modal-confirmar-corpo"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 id="modal-confirmar-titulo" className="text-lg font-semibold text-slate-800">{titulo}</h3>
          <button
            type="button"
            onClick={onCancelar}
            aria-label="Fechar"
            className="shrink-0 rounded text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <p id="modal-confirmar-corpo" className="text-sm text-slate-600">{corpo}</p>
        {aviso && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{aviso}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-lg border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
          >
            {rotuloCancelar}
          </button>
          <button
            ref={confirmar}
            type="button"
            onClick={onConfirmar}
            disabled={ocupado}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${corConfirmar}`}
          >
            {ocupado ? 'Aguarde…' : rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
