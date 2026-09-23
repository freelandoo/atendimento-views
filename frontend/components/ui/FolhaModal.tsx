'use client'
// Superficie flutuante UNICA do tema claro: folha inferior no celular, modal centrado a
// partir de `sm`. Substitui o `fixed inset-0 flex items-center justify-center p-4` reescrito
// a mao em cada modal.
//
// POR QUE UM COMPONENTE SO, e nao um modal por tela: medicao de 2026-09-19 no Banco de Leads
// — `LeadDetalhesModal` (max-w-5xl, max-h-[92vh]), `ConversaHistoricoModal` (max-w-lg,
// max-h-[85vh], com TRES sub-modais `max-w-sm` dentro de si) e `JsonLeadModal` eram tres
// implementacoes diferentes da mesma coisa, todas centradas, todas com o botao de fechar no
// canto superior DIREITO — que no telefone fica fora do alcance do polegar.
//
// O QUE ESTE COMPONENTE NAO SABE: nenhuma regra de negocio e nenhuma classe de superficie.
// As classes vivem em `lib/ui-primitivos.js` (puro e testado) — mesmo contrato do `Botao`.
//
// Decisoes que sao contrato, nao estilo:
//   • O rodape e' PRESO (nao rola junto). A acao primaria de um lead nao pode depender de o
//     operador rolar ate o fim da ficha para encontra-la.
//   • So o corpo rola. `min-h-0` em cada nivel, senao o flex nao deixa o filho encolher e a
//     folha estoura a tela no celular.
//   • O foco volta para quem abriu ao fechar. Sem isso, quem navega por teclado cai no topo
//     da pagina a cada modal fechado.
//   • Fecha no `mousedown` do fundo, nunca no `click`: com `click`, arrastar uma selecao de
//     texto de dentro para fora fecha a folha e perde o que a pessoa estava escrevendo.
import { useCallback, useEffect, useRef } from 'react'
import { classesFolha, classesFundoFolha, type TamanhoFolha } from '@/lib/ui-primitivos'
import { IconClose } from '@/components/ui/icons'

export type FolhaModalProps = {
  aberto: boolean
  /** Vira o <h2> e nomeia o dialogo para o leitor de tela. Obrigatorio. */
  titulo: string
  /** Uma linha de apoio. Diga o que a folha decide, nao o que ela e'. */
  descricao?: string
  onFechar: () => void
  tamanho?: TamanhoFolha
  /** Acoes presas no rodape. Sem rodape, a folha termina no corpo. */
  rodape?: React.ReactNode
  /** Conteudo a direita do titulo (abas curtas, navegacao entre itens). */
  acoesCabecalho?: React.ReactNode
  /** O corpo controla o proprio padding (lista colada na borda, por exemplo). */
  semPaddingCorpo?: boolean
  /** Painel colado na DIREITA, altura inteira (no celular continua folha inferior). Mesma
   *  superfície da ficha do lead — para formulários que não devem esconder a lista atrás. */
  lateral?: boolean
  className?: string
  children?: React.ReactNode
}

let sequencia = 0

export default function FolhaModal({
  aberto,
  titulo,
  descricao,
  onFechar,
  tamanho = 'md',
  rodape,
  acoesCabecalho,
  semPaddingCorpo = false,
  lateral = false,
  className = '',
  children,
}: FolhaModalProps) {
  const painelRef = useRef<HTMLDivElement>(null)
  const focoAnteriorRef = useRef<HTMLElement | null>(null)
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `folha-${++sequencia}`

  const fechar = useCallback(() => onFechar(), [onFechar])

  useEffect(() => {
    if (!aberto) return

    focoAnteriorRef.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // O painel recebe o foco na abertura para que Escape e Tab funcionem de imediato.
    const painel = painelRef.current
    const focavel = painel?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(focavel || painel)?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fechar()
        return
      }
      if (e.key !== 'Tab' || !painelRef.current) return
      // Prende o Tab dentro da folha: um dialogo modal que deixa o foco escapar para a pagina
      // atras dele nao e' modal para quem navega por teclado.
      const alvos = Array.from(
        painelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!alvos.length) return
      const primeiro = alvos[0]
      const ultimo = alvos[alvos.length - 1]
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      focoAnteriorRef.current?.focus?.()
    }
  }, [aberto, fechar])

  if (!aberto) return null

  return (
    <div
      className={classesFundoFolha({ lateral })}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) fechar()
      }}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${idRef.current}-titulo`}
        aria-describedby={descricao ? `${idRef.current}-descricao` : undefined}
        tabIndex={-1}
        className={classesFolha({ tamanho, extra: className, lateral })}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Alca de arraste: so no celular, onde a folha sobe de baixo. Decorativa — quem
            fecha e' o botao, o Escape e o toque no fundo. */}
        <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 id={`${idRef.current}-titulo`} className="truncate text-base font-bold text-ink sm:text-lg">
              {titulo}
            </h2>
            {descricao && (
              <p id={`${idRef.current}-descricao`} className="mt-0.5 text-xs text-ink-3 sm:text-sm">
                {descricao}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {acoesCabecalho}
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <IconClose />
            </button>
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${semPaddingCorpo ? '' : 'px-4 py-4 sm:px-5'}`}>
          {children}
        </div>

        {rodape && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
            {rodape}
          </div>
        )}
      </div>
    </div>
  )
}
