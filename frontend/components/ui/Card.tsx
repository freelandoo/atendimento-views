'use client'
// Superficie padrao do tema claro. Substitui o `rounded-xl border bg-white p-5 shadow-sm`
// reescrito a mao em dezenas de telas.
//
// Regra do guia que este componente NAO pode violar: card dentro de card, nao. Se precisar de
// hierarquia interna, use titulo + separador, nao outra superficie.
import { classesCard } from '@/lib/ui-primitivos'

export type CardProps = {
  /** Vira <h2> e nomeia a regiao para leitor de tela. Sem titulo, o card e' so uma <div>. */
  titulo?: string
  /** Uma linha de apoio abaixo do titulo. Explique o que a secao decide, nao o que ela e'. */
  descricao?: string
  /** Acoes do cabecalho (botoes, filtro). Ficam a direita do titulo. */
  acoes?: React.ReactNode
  /** Card de listagem densa: padding menor. */
  compacto?: boolean
  /** O conteudo controla o proprio padding (tabela colada na borda, por exemplo). */
  semPadding?: boolean
  className?: string
  children?: React.ReactNode
}

export default function Card({
  titulo, descricao, acoes, compacto = false, semPadding = false, className = '', children,
}: CardProps) {
  const temCabecalho = Boolean(titulo || acoes)
  const corpo = (
    <>
      {temCabecalho && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo && <h2 className="text-sm font-semibold text-ink">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-xs text-ink-3">{descricao}</p>}
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
        </div>
      )}
      {children}
    </>
  )

  // Com titulo o card e' uma REGIAO navegavel; sem titulo seria uma regiao anonima, que so
  // polui a lista de marcos do leitor de tela.
  if (titulo) {
    return (
      <section className={classesCard({ compacto, semPadding, extra: className })} aria-label={titulo}>
        {corpo}
      </section>
    )
  }
  return <div className={classesCard({ compacto, semPadding, extra: className })}>{corpo}</div>
}
