'use client'
// Cabecalho de pagina. `text-2xl font-bold` e' a medida real: 22 das 26 telas ja usavam isso.
//
// O <h1> e' UNICO por pagina — e' o que faz "ir para o conteudo" e a navegacao por titulos
// funcionarem. Nao use este componente duas vezes na mesma tela.
export type CabecalhoPaginaProps = {
  titulo: string
  /** Uma linha: o que se decide aqui. Nao explique a interface. */
  descricao?: string
  /** Acao primaria da pagina e seus vizinhos. */
  acoes?: React.ReactNode
  className?: string
}

export default function CabecalhoPagina({
  titulo, descricao, acoes, className = '',
}: CabecalhoPaginaProps) {
  return (
    <header className={`mb-5 flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-ink-3">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  )
}
