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
import { useRef } from 'react'
import BalaoAjuda from '@/components/ui/BalaoAjuda'

export type OpcaoModo = { id: string; rotulo: string; ajuda: string }

// O balao de ajuda mudou de casa (`components/ui/BalaoAjuda.tsx`) quando o controle de
// ativacao do Follow-up passou a usar o mesmo icone. Reexportado daqui — como
// `lib/paginacao.js` faz — para nao quebrar quem ja importava por este caminho.
export { BalaoAjuda }

export default function AlternadorModoIa({
  opcoes,
  selecionado,
  onMudar,
  ariaLabel,
  ajuda,
  ocupado = false,
  compacto = false,
}: {
  opcoes: OpcaoModo[]
  selecionado: string
  onMudar: (novo: string) => void
  /** Frase completa (estado + consequencia + origem) para o leitor de tela. */
  ariaLabel: string
  /**
   * Texto do balao. Sem ele, o balao explica a OPCAO ativa — o que serve ao controle DA
   * CONVERSA. O controle do padrao GLOBAL tem outro escopo ("toda conversa sem excecao") e
   * precisa dizer isso, senao o operador acredita estar mexendo so' na conversa aberta.
   */
  ajuda?: string
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
      {/* Icone de informacao ANTES do controle: mesma ordem do `InterruptorAtivacao`, para os
          controles das duas telas serem lidos do mesmo jeito. */}
      {ativa && (
        <BalaoAjuda
          texto={ajuda || ativa.ajuda}
          rotuloAcessivelBotao={ajuda ? 'O que este controle define' : `O que significa a opção ${ativa.rotulo}`}
        />
      )}
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
              title={o.ajuda}
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
      {/* O estado por extenso saiu daqui: a opcao marcada dentro do grupo JA e' o estado, em
          texto, e repeti-lo ao lado era o rotulo redundante que a padronizacao removeu.
          "Atualizando…" fica — nao e' estado, e' bloqueio temporario com impacto operacional. */}
      {ocupado && (
        <span className="text-xs text-slate-600" aria-live="polite">
          Atualizando…
        </span>
      )}
    </div>
  )
}
