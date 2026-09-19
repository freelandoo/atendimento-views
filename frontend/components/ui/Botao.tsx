'use client'
// Botao do tema claro — as QUATRO variantes que o guia visual exige e que nenhum componente
// implementava. Medicao de 2026-09-18: 155 botoes escritos a mao nas telas, nenhum igual ao
// outro, metade sem nenhum tratamento de `disabled` e quase nenhum com anel de foco.
//
// O QUE ESTE COMPONENTE NAO SABE: nenhuma regra de negocio e nenhuma classe. As classes vivem
// em `lib/ui-primitivos.js` (puro e testado) — mesmo contrato de `BolinhaPontuacao`.
//
// Decisoes que sao contrato, nao estilo:
//   • `type="button"` por PADRAO. O padrao do HTML dentro de <form> e' `submit`, e envio
//     acidental de formulario e' defeito classico. Quem quer enviar passa type="submit".
//   • `carregando` DESABILITA: o segundo clique durante um envio e' a origem do disparo em
//     duplicidade. O rotulo continua na tela (nao trocamos por "Salvando...") para o botao nao
//     mudar de largura e a pagina nao pular.
//   • estado nunca e' so cor/spinner: `carregando` e `motivoDesabilitado` entram no NOME
//     acessivel e no `title`.
import {
  classesBotao, estadoBotao, rotuloBotaoAcessivel,
  type TamanhoBotao, type VarianteBotao,
} from '@/lib/ui-primitivos'

export type BotaoProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
  /** Em andamento: desabilita, mostra giro e anuncia o estado. */
  carregando?: boolean
  /** Por que esta bloqueado. So aparece quando o botao esta mesmo inativo. */
  motivoDesabilitado?: string
  larguraTotal?: boolean
  /** Icone a esquerda do rotulo. Decorativo — o rotulo continua obrigatorio. */
  iconeInicio?: React.ReactNode
  /** Classes de LAYOUT do chamador (margem, `shrink-0`). Nunca cor, raio ou padding. */
  className?: string
}

export default function Botao({
  variante = 'secundaria',
  tamanho = 'md',
  carregando = false,
  motivoDesabilitado = '',
  larguraTotal = false,
  iconeInicio,
  className = '',
  disabled,
  type = 'button',
  children,
  ...rest
}: BotaoProps) {
  const estado = estadoBotao({ desabilitado: disabled, carregando, motivoDesabilitado })
  const rotulo = typeof children === 'string' ? children : ''
  const acessivel = rotuloBotaoAcessivel({ rotulo, carregando, motivoDesabilitado })

  return (
    <button
      type={type}
      className={classesBotao({ variante, tamanho, larguraTotal, extra: className })}
      disabled={estado.desabilitado}
      aria-busy={estado.ocupado || undefined}
      title={estado.titulo}
      aria-label={rotulo && acessivel !== rotulo ? acessivel : rest['aria-label']}
      {...rest}
    >
      {carregando ? (
        <svg className="h-3.5 w-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        iconeInicio
      )}
      {children}
    </button>
  )
}
