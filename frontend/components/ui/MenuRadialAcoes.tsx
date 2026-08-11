'use client'
// Menu radial de ações secundárias — compacta o excesso de botões que hoje quebra
// linha (Follow-ups: até 5 botões simultâneos, `flex-wrap`). NUNCA substitui a coluna
// Ações: a ação PRIMÁRIA de cada linha continua um botão comum, sempre visível, fora
// deste componente. Este menu só absorve o que sobra.
//
// Origem: relatório "Padronização visual das listagens" (seção 6 — proposta do
// radial). Duas decisões do próprio pedido resolveram os pontos em aberto do
// relatório (D6 e o modo desktop):
//   • acionamento por BOTÃO/ícone (⋯), clicável — nunca por hover ou por gesto de
//     clicar-e-segurar. Funciona identicamente em mouse e toque, sem curva de
//     aprendizado nem risco de toque acidental;
//   • como o gatilho já é um clique/toque explícito (não um "soltar em cima de uma
//     zona"), o "centro = lista completa" do relatório não precisa ser uma segunda
//     superfície: o próprio popover É a lista completa — os botões espaciais
//     (cima/direita/esquerda) mostram as ações mais usadas na posição descrita pelo
//     relatório, e o que sobra ("extras") aparece logo abaixo. Nenhuma ação existe
//     SÓ no gesto: tudo que está aqui é alcançável por teclado e por toque simples.
//
// Zero ações → não renderiza nada. Uma única ação → vira um botão comum (um menu para
// uma opção só é fricção pura — mesmo raciocínio do relatório sobre a Central de
// Ligações). A partir de duas, vira o gatilho "⋯" com o leque.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { atribuirZonas, classeTom, rotuloMenu, type AcaoRadial } from '@/lib/menu-radial'

export type { AcaoRadial } from '@/lib/menu-radial'

const ALTURA_ESTIMADA_ABERTA = 260
const LARGURA_POPOVER = 240
const MARGEM = 8

export default function MenuRadialAcoes({
  acoes,
  rotuloContexto,
}: {
  acoes: AcaoRadial[]
  /** Nome do lead/linha, só para compor o `aria-label` do gatilho ("Mais ações — João"). */
  rotuloContexto?: string | null
}) {
  if (!acoes || acoes.length === 0) return null

  if (acoes.length === 1) {
    const a = acoes[0]
    return (
      <button
        type="button"
        onClick={a.onSelecionar}
        disabled={a.desabilitado}
        title={a.descricao}
        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${classeTom(a.tom)}`}
      >
        {a.rotulo}
      </button>
    )
  }

  return <GatilhoComLeque acoes={acoes} rotuloContexto={rotuloContexto} />
}

function GatilhoComLeque({ acoes, rotuloContexto }: { acoes: AcaoRadial[]; rotuloContexto?: string | null }) {
  const botaoRef = useRef<HTMLButtonElement | null>(null)
  const painelRef = useRef<HTMLDivElement | null>(null)
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const fechar = useCallback(() => setAberto(false), [])

  const abrir = useCallback(() => {
    const r = botaoRef.current?.getBoundingClientRect()
    if (!r) return
    const alturaJanela = typeof window !== 'undefined' ? window.innerHeight : r.bottom + ALTURA_ESTIMADA_ABERTA
    const larguraJanela = typeof window !== 'undefined' ? window.innerWidth : r.right + LARGURA_POPOVER
    const cabeAbaixo = r.bottom + MARGEM + ALTURA_ESTIMADA_ABERTA <= alturaJanela
    const top = cabeAbaixo ? r.bottom + MARGEM : Math.max(MARGEM, r.top - MARGEM - ALTURA_ESTIMADA_ABERTA)
    const left = Math.min(Math.max(r.right - LARGURA_POPOVER, MARGEM), larguraJanela - LARGURA_POPOVER - MARGEM)
    setPos({ left, top })
    setAberto(true)
  }, [])

  // Fecha em Escape, clique fora e scroll/resize — a âncora se move e o painel ficaria
  // solto. Mesmo padrão de fechamento de `BolinhaPontuacao`/`ModalConfirmar`.
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(); botaoRef.current?.focus() }
    }
    const aoClicarFora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (painelRef.current?.contains(alvo) || botaoRef.current?.contains(alvo)) return
      fechar()
    }
    document.addEventListener('keydown', aoTeclar)
    document.addEventListener('mousedown', aoClicarFora)
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('resize', fechar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('mousedown', aoClicarFora)
      window.removeEventListener('scroll', fechar, true)
      window.removeEventListener('resize', fechar)
    }
  }, [aberto, fechar])

  const zonas = atribuirZonas(acoes)
  const selecionar = (a: AcaoRadial) => { fechar(); a.onSelecionar() }

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotuloMenu(rotuloContexto)}
        title="Mais ações"
        className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        ⋯
      </button>
      {aberto && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={painelRef}
          role="menu"
          aria-label={rotuloMenu(rotuloContexto)}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: LARGURA_POPOVER }}
          className="z-[70] rounded-xl border bg-white p-2 shadow-xl"
        >
          {/* Leque espacial: cima = mais frequente, direita = positiva, esquerda = negativa.
              A posição de baixo fica vazia de propósito (relatório, seção 6). */}
          <div className="grid grid-cols-3 items-center gap-1.5">
            <span />
            <BotaoZona acao={zonas.cima} onSelecionar={selecionar} />
            <span />
            <BotaoZona acao={zonas.esquerda} onSelecionar={selecionar} />
            <span className="text-center text-[10px] leading-none text-slate-300" aria-hidden="true">···</span>
            <BotaoZona acao={zonas.direita} onSelecionar={selecionar} />
          </div>
          {zonas.extras.length > 0 && (
            <div className={zonas.cima || zonas.direita || zonas.esquerda ? 'mt-2 border-t pt-2' : ''}>
              <ul className="space-y-0.5">
                {zonas.extras.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => selecionar(a)}
                      disabled={a.desabilitado}
                      title={a.descricao}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {a.rotulo}
                      {a.descricao && <span className="block text-[10px] font-normal text-slate-400">{a.descricao}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function BotaoZona({ acao, onSelecionar }: { acao: AcaoRadial | null; onSelecionar: (a: AcaoRadial) => void }) {
  if (!acao) return <span />
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onSelecionar(acao)}
      disabled={acao.desabilitado}
      title={acao.descricao}
      className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${classeTom(acao.tom)}`}
    >
      {acao.rotulo}
    </button>
  )
}
