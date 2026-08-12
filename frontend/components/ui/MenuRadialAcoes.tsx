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
//     superfície: o próprio gatilho É o centro — clicar nele de novo (ou clicar fora,
//     ou Escape) fecha sem escolher nada, e o que sobra ("extras") aparece como uma
//     lista curta, sempre alcançável por teclado e por toque simples.
//
// v2 (2026-08-11): a v1 desenhava as ações numa grade 3x3 dentro de uma caixa
// retangular — geometricamente um popover comum, não um radial. Esta versão posiciona
// cada ação como uma BOLINHA (`rounded-full`) flutuando em coordenadas fixas ao redor
// do CENTRO do próprio botão "⋯" (cima/esquerda/direita/baixo, à mesma distância — um
// anel tracejado decorativo reforça a leitura), sem caixa nenhuma quando não há extras —
// que é o caso mais comum desta tela (Concluir/Reagendar/Cancelar, sem sobra). Ainda
// sem gesto de arrastar (D6 já resolvida a favor de clique/toque previsível); se um
// gesto de arrastar-em-direção fizer sentido, é fase seguinte documentada aqui, não
// implementada agora.
//
// Zero ações → não renderiza nada. Uma única ação → vira um botão comum (um menu para
// uma opção só é fricção pura — mesmo raciocínio do relatório sobre a Central de
// Ligações). A partir de duas, vira o gatilho "⋯" com as bolinhas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { atribuirZonas, classeTom, rotuloMenu, type AcaoRadial } from '@/lib/menu-radial'

export type { AcaoRadial } from '@/lib/menu-radial'

// Distância do centro do gatilho até o centro de cada bolinha satélite, e o diâmetro
// delas — define o raio do "anel" decorativo também, para as bolinhas ficarem
// exatamente sobre a linha tracejada.
const RAIO = 56
const BOLHA = 52
const MARGEM = 8
const LARGURA_EXTRAS = 224
const ALTURA_ESTIMADA_EXTRAS = 140

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

  return <GatilhoRadial acoes={acoes} rotuloContexto={rotuloContexto} />
}

type Centro = { cx: number; cy: number }

function GatilhoRadial({ acoes, rotuloContexto }: { acoes: AcaoRadial[]; rotuloContexto?: string | null }) {
  const botaoRef = useRef<HTMLButtonElement | null>(null)
  const painelRef = useRef<HTMLDivElement | null>(null)
  const [aberto, setAberto] = useState(false)
  const [centro, setCentro] = useState<Centro | null>(null)

  const fechar = useCallback(() => setAberto(false), [])

  const abrir = useCallback(() => {
    const r = botaoRef.current?.getBoundingClientRect()
    if (!r) return
    setCentro({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
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

  const geometria = useMemo(() => (centro ? calcularGeometria(centro, zonas.extras.length > 0) : null), [centro, zonas.extras.length])

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
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium text-slate-500 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${aberto ? 'border-brand bg-brand/10 text-brand ring-2 ring-brand' : 'border-slate-200'}`}
      >
        ⋯
      </button>
      {aberto && centro && geometria && typeof document !== 'undefined' && createPortal(
        <div ref={painelRef} role="menu" aria-label={rotuloMenu(rotuloContexto)} className="z-[70]">
          {/* Anel decorativo — só reforça a leitura "as bolinhas ficam ao redor do
              gatilho"; nunca carrega informação por si só. */}
          <div
            aria-hidden="true"
            style={{ position: 'fixed', left: centro.cx, top: centro.cy, width: RAIO * 2, height: RAIO * 2, transform: 'translate(-50%, -50%)' }}
            className="pointer-events-none rounded-full border border-dashed border-slate-300"
          />
          <BolhaZona posicao={geometria.cima} acao={zonas.cima} onSelecionar={selecionar} direcao="acima" />
          <BolhaZona posicao={geometria.esquerda} acao={zonas.esquerda} onSelecionar={selecionar} direcao="à esquerda" />
          <BolhaZona posicao={geometria.direita} acao={zonas.direita} onSelecionar={selecionar} direcao="à direita" />
          <BolhaZona posicao={geometria.baixo} acao={zonas.baixo} onSelecionar={selecionar} direcao="abaixo" />
          {zonas.extras.length > 0 && (
            <div
              style={{ position: 'fixed', left: geometria.extras.left, top: geometria.extras.top, width: LARGURA_EXTRAS }}
              className="rounded-xl border bg-white p-2 shadow-xl"
            >
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

type Posicao = { left: number; top: number }

/**
 * Posição de cada bolinha (cima/esquerda/direita, à distância `RAIO` do centro do
 * gatilho) e do painel de extras (abaixo do anel, ou acima quando não cabe abaixo),
 * já com o clamp de viewport aplicado — nenhuma bolinha some para fora da tela.
 */
function calcularGeometria(centro: Centro, temExtras: boolean) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : centro.cx + RAIO * 2
  const vh = typeof window !== 'undefined' ? window.innerHeight : centro.cy + RAIO * 2
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
  const minX = MARGEM + BOLHA / 2
  const maxX = vw - MARGEM - BOLHA / 2
  const minY = MARGEM + BOLHA / 2
  const maxY = vh - MARGEM - BOLHA / 2
  const clampBolha = (left: number, top: number): Posicao => ({
    left: clamp(left, minX, maxX),
    top: clamp(top, minY, maxY),
  })

  const cima = clampBolha(centro.cx, centro.cy - RAIO)
  const esquerda = clampBolha(centro.cx - RAIO, centro.cy)
  const direita = clampBolha(centro.cx + RAIO, centro.cy)
  const baixo = clampBolha(centro.cx, centro.cy + RAIO)

  // A borda inferior de `baixo` já fica em `centro.cy + RAIO + BOLHA/2`; o painel de
  // extras nasce `MARGEM` abaixo disso, então nunca encosta na 4ª bolinha, esteja ela
  // ocupada ou não.
  const baseTop = centro.cy + RAIO + BOLHA / 2 + MARGEM
  const cabeAbaixo = !temExtras || baseTop + ALTURA_ESTIMADA_EXTRAS <= vh
  const extrasTop = cabeAbaixo ? baseTop : Math.max(MARGEM, centro.cy - RAIO - BOLHA / 2 - MARGEM - ALTURA_ESTIMADA_EXTRAS)
  const extrasLeft = clamp(centro.cx - LARGURA_EXTRAS / 2, MARGEM, vw - LARGURA_EXTRAS - MARGEM)

  return { cima, esquerda, direita, baixo, extras: { left: extrasLeft, top: extrasTop } }
}

function BolhaZona({
  posicao,
  acao,
  onSelecionar,
  direcao,
}: {
  posicao: Posicao
  acao: AcaoRadial | null
  onSelecionar: (a: AcaoRadial) => void
  /** Compõe um `aria-label` mais claro que o texto visível sozinho ("Reagendar, acima") —
   *  útil sobretudo para quem navega por leitor de tela junto com um mouse/trackpad, onde a
   *  posição espacial é parte de como a pessoa vidente ao lado descreveria a ação. */
  direcao: 'acima' | 'à esquerda' | 'à direita' | 'abaixo'
}) {
  if (!acao) return null
  return (
    <div
      style={{ position: 'fixed', left: posicao.left, top: posicao.top, width: BOLHA, height: BOLHA, transform: 'translate(-50%, -50%)' }}
      className="group"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onSelecionar(acao)}
        disabled={acao.desabilitado}
        title={acao.descricao || acao.rotulo}
        aria-label={`${acao.rotulo}, ${direcao}${acao.descricao ? ` — ${acao.descricao}` : ''}`}
        className={`flex h-full w-full items-center justify-center rounded-full border p-1 text-center text-[11px] font-semibold leading-tight shadow-sm transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 ${classeTom(acao.tom)}`}
      >
        {acao.rotulo}
      </button>
      {/* Hover/foco reforça e explica — nunca executa. Some de novo quando o mouse/foco
          sai; em toque simplesmente não aparece (sem hover), o que é seguro porque o
          rótulo já está sempre visível dentro da bolinha. */}
      {acao.descricao && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 w-max max-w-[10rem] -translate-x-1/2 rounded-md bg-slate-800 px-2 py-1 text-center text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {acao.descricao}
        </span>
      )}
    </div>
  )
}
