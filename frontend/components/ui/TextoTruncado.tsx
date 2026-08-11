'use client'
// Truncamento visual (reticências) + tooltip acessível por mouse e teclado — componente
// ÚNICO para qualquer nome/texto que pode estourar a largura da coluna/célula.
//
// Motivação: nomes vindos do Google Maps (Aquisição, Banco de Leads, Central de Ligações)
// e o nome resolvido da Central de Mensagens (WhatsApp → Google Maps, `lib/lead-identidade`)
// podem ser bem mais longos que o espaço disponível na tabela. O padrão anterior, espalhado
// em várias telas (`max-w-[…] truncate` + `title=`), corta visualmente mas só é alcançável
// pelo MOUSE — `title` nativo não é confiável por teclado nem por leitor de tela. Este
// componente não substitui esse padrão em todo o repositório (fora de escopo desta tarefa);
// aplica-se apenas onde o nome tem origem no Google Maps/resolução de lead.
//
// O DADO NUNCA É CORTADO — só a apresentação. `texto` chega inteiro e é isso que vai para o
// tooltip, para `title` e para `aria-label`.
//
// Reusa a técnica de tooltip em PORTAL da `BolinhaPontuacao` (mede a própria altura, vira
// pra baixo quando não cabe acima, presa nas bordas laterais): estas colunas vivem dentro de
// tabelas com `overflow-hidden`/rolagem horizontal (`DataTableFrame`), onde um tooltip
// `position:absolute` seria cortado pelo wrapper.
//
// O tooltip só existe quando o texto REALMENTE transborda (ResizeObserver compara
// `scrollWidth` vs `clientWidth` do trecho truncado) — nome que já cabe não ganha foco nem
// popup redundante, e não participa da ordem de tabulação.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type TextoTruncadoProps = {
  /** Texto completo — nunca é cortado no dado, só na apresentação. */
  texto: string | null | undefined
  /** Classe do elemento truncado — controla a largura máxima (ex.: "max-w-[220px]"). */
  className?: string
  /** Quando presente, renderiza como link (ex.: ficha do Google Maps) em vez de span. */
  href?: string | null
  /** Elemento à direita do texto, fora da área truncada (ex.: ícone "↗"). */
  sufixo?: React.ReactNode
  /** Linha extra no tooltip e no title explicando a ação do link (ex.: "Ver ficha no Google Maps"). */
  dica?: string
  /** Texto do estado vazio. */
  vazio?: string
}

export default function TextoTruncado({
  texto, className = '', href, sufixo, dica, vazio = '—',
}: TextoTruncadoProps) {
  const textoRef = useRef<HTMLSpanElement | null>(null)
  const gatilhoRef = useRef<HTMLElement | null>(null)
  const balaoRef = useRef<HTMLDivElement | null>(null)
  const [transborda, setTransborda] = useState(false)
  const [caixa, setCaixa] = useState<{ x: number; topo: number; base: number } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; abaixo: boolean } | null>(null)
  const [visivel, setVisivel] = useState(false)

  const valor = (texto == null ? '' : String(texto)).trim()

  // Reage a mudança de coluna (toggle de "Personalizar", resize de janela) — não só ao mount.
  useEffect(() => {
    const el = textoRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => setTransborda(el.scrollWidth > el.clientWidth + 1)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [valor])

  const abrir = useCallback(() => {
    if (!transborda) return
    const r = gatilhoRef.current?.getBoundingClientRect()
    if (!r) return
    setCaixa({ x: r.left + r.width / 2, topo: r.top, base: r.bottom })
  }, [transborda])
  const fechar = useCallback(() => { setCaixa(null); setPos(null); setVisivel(false) }, [])

  // Mede o balão já montado (ainda invisível) e decide o lado — mesma lógica da BolinhaPontuacao.
  useEffect(() => {
    if (!caixa) return
    const el = balaoRef.current
    if (!el) return
    const MARGEM = 8
    const h = el.offsetHeight
    const meia = el.offsetWidth / 2
    const cabeAcima = caixa.topo - MARGEM - h >= MARGEM
    const left = Math.min(
      Math.max(caixa.x, MARGEM + meia),
      (typeof window !== 'undefined' ? window.innerWidth : caixa.x + meia) - MARGEM - meia,
    )
    setPos({ left, top: cabeAcima ? caixa.topo - MARGEM - h : caixa.base + MARGEM, abaixo: !cabeAcima })
  }, [caixa])

  useEffect(() => {
    if (!caixa || !pos) return
    const raf = requestAnimationFrame(() => setVisivel(true))
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('resize', fechar)
    window.addEventListener('keydown', aoTeclar)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [caixa, pos, fechar])

  if (!valor) return <>{vazio}</>

  const tituloNativo = transborda ? (dica ? `${valor} — ${dica}` : valor) : (dica || undefined)
  const rotuloAcessivel = dica ? `${valor} — ${dica}` : undefined

  const eventos = {
    title: tituloNativo,
    'aria-label': rotuloAcessivel,
    onMouseEnter: abrir,
    onMouseLeave: fechar,
    onFocus: abrir,
    onBlur: fechar,
  } as const

  const miolo = (
    <>
      <span ref={textoRef} className="min-w-0 truncate">{valor}</span>
      {sufixo}
    </>
  )

  return (
    <>
      {href ? (
        <a
          ref={(el) => { gatilhoRef.current = el }}
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex min-w-0 items-center gap-1 ${className}`}
          {...eventos}
        >
          {miolo}
        </a>
      ) : (
        <span
          ref={(el) => { gatilhoRef.current = el }}
          tabIndex={transborda ? 0 : undefined}
          className={`inline-flex min-w-0 items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${className}`}
          {...eventos}
        >
          {miolo}
        </span>
      )}
      {caixa && transborda && typeof document !== 'undefined' && createPortal(
        <div
          ref={balaoRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos ? pos.left : caixa.x,
            top: pos ? pos.top : -9999,
            transform: 'translateX(-50%)',
          }}
          className={`pointer-events-none z-[70] max-w-[320px] rounded-lg bg-slate-800 px-3 py-2 text-left text-[11px] font-normal leading-snug text-white shadow-xl transition-all duration-150 ease-out ${
            visivel ? 'translate-y-0 opacity-100' : `${pos && pos.abaixo ? '-translate-y-1' : 'translate-y-1'} opacity-0`
          }`}
        >
          <div className="font-medium">{valor}</div>
          {dica && <div className="mt-1 text-slate-400">{dica}</div>}
        </div>,
        document.body
      )}
    </>
  )
}
