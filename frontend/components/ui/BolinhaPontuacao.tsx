'use client'
// Indicador circular de pontuacao — UM componente, varias pontuacoes.
//
// Extraido do `CirculoPrioridade` da Central de Ligacoes, que era a UNICA das tres
// implementacoes com acessibilidade e posicionamento corretos. A Central de Mensagens tinha a
// mesma geometria com `title=` apenas (sem foco, sem aria-label, sem criterios) e a Aquisicao /
// Banco de Leads mostravam o numero cru pintado com a paleta de PRIORIDADE — em uma pontuacao
// que anda ao contrario dela.
//
// O QUE ESTE COMPONENTE NAO SABE: nenhuma regra de pontuacao. Faixa, titulo, fatores e a frase
// `oQueMede` vem PRONTOS de quem usa; a traducao vive em `lib/pontuacao-indicador.js` (puro e
// testado) e o calculo vive no backend. E' o mesmo contrato de `lib/site-rotulos.js`.
//
// Decisoes que sao contrato, nao estilo:
//   • `oQueMede` e' OBRIGATORIO. E' a unica coisa que impede duas telas com a mesma bolinha de
//     parecerem medir a mesma coisa.
//   • `maximo` e' OBRIGATORIO. Cadastro de Instagram vale ate 60; "30" sozinho mentiria.
//   • cor NUNCA e' a unica informacao: numero no circulo, titulo em texto no balao e o resumo
//     inteiro no `aria-label`.
//   • tooltip em PORTAL no <body>, posicionado pelo rect da ancora. Nao e' preferencia: dentro
//     das tabelas (wrapper `overflow-hidden`) a versao `position:absolute` era cortada, e foi
//     esse o defeito que a Central de Ligacoes corrigiu.
//   • o balao VIRA PARA BAIXO quando nao cabe acima, e e' preso nas bordas laterais. Abrir
//     sempre para cima funcionava nas TABELAS (sempre ha cabecalho acima da 1a linha), mas
//     quebrava na Central de Mensagens: la a bolinha fica no CABECALHO de um modal colado no
//     topo da tela, e o balao — que pode ter 9 criterios de altura — subia para fora da
//     viewport. O tamanho e' MEDIDO, nao estimado: o balao de cadastro (9 linhas) e o de
//     prioridade (2 linhas) tem alturas muito diferentes para um chute unico servir.
//   • lista de fatores em DUAS COLUNAS quando ha muitos (regra em `lib/pontuacao-indicador`).
//     Completude do Places tem 9 criterios; empilhados, o balao fica alto demais para caber
//     acima da ancora. Duas colunas cortam a altura pela metade. Ordem de leitura por LINHA
//     (grid), nao por coluna: `columns-2` do CSS quebraria itens no meio.
//   • somente leitura (`pointer-events-none`): nenhum controle dentro do balao.
//   • nunca renderiza JSON, id, UUID, place_id ou telefone — o balao e' operacional.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  classesDaBolinha, normalizarValor, resumoTextual, textoValor, usaDuasColunas,
  type FatorPontuacao, type VarianteIndicador,
} from '@/lib/pontuacao-indicador'

export type BolinhaPontuacaoProps = {
  /** `null` = pontuacao NAO calculada (bolinha vazada). Nunca use 0 para dizer isso. */
  valor: number | null | undefined
  /** Teto da escala (100 no Places/prioridade/interesse, 60 no Instagram). */
  maximo: number
  /** Chave de faixa da variante ('alta'|'alto'|…, 'completo'|'parcial'|'incompleto'). */
  faixa?: string | null
  /** 1a linha do balao: "Interesse alto", "Cadastro incompleto · 2 lacunas". */
  titulo: string
  /** Frase obrigatoria: o que esta pontuacao mede NESTA tela. */
  oQueMede: string
  /** Itens auditaveis, ja traduzidos por `lib/pontuacao-indicador.js`. */
  fatores?: FatorPontuacao[]
  /** Rodape opcional do balao (ex.: a leitura invertida da completude). */
  nota?: string
  /** Escolhe a paleta. Prioridade comercial e completude NUNCA compartilham cores. */
  variante: VarianteIndicador
  tamanho?: 'sm' | 'md'
  /** Texto do estado vazio; o padrao serve para qualquer pontuacao. */
  rotuloSemValor?: string
}

const CLS_SINAL: Record<string, string> = {
  positivo: 'text-emerald-300',
  negativo: 'text-red-300',
  ausente: 'text-slate-400',
  neutro: 'text-slate-200',
}

const TAMANHO_CLS = {
  sm: 'h-7 w-7 text-[10px]',
  md: 'h-9 w-9 text-xs',
}

export default function BolinhaPontuacao({
  valor, maximo, faixa, titulo, oQueMede, fatores = [], nota,
  variante, tamanho = 'md', rotuloSemValor = 'Pontuação não calculada',
}: BolinhaPontuacaoProps) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const balaoRef = useRef<HTMLDivElement | null>(null)
  const [caixa, setCaixa] = useState<{ x: number; topo: number; base: number } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; abaixo: boolean } | null>(null)
  const [visivel, setVisivel] = useState(false)

  const abrir = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setCaixa({ x: r.left + r.width / 2, topo: r.top, base: r.bottom })
  }, [])
  const fechar = useCallback(() => { setCaixa(null); setPos(null); setVisivel(false) }, [])

  // Mede o balao JA MONTADO (ainda invisivel) e decide o lado. Roda antes de `visivel`, entao
  // nao ha salto: o operador so' ve o balao depois de posicionado.
  //   • acima, se couber; abaixo, caso contrario (modal colado no topo da tela);
  //   • preso nas bordas laterais, senao o balao de um lead na primeira/ultima coluna sai da
  //     tela pelo lado.
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
    setPos({
      left,
      top: cabeAcima ? caixa.topo - MARGEM - h : caixa.base + MARGEM,
      abaixo: !cabeAcima,
    })
  }, [caixa])

  // Anima em dois frames: monta invisivel e sobe a opacidade no frame seguinte. Fecha em
  // scroll/resize (a ancora se moveria e o balao ficaria solto) e em Escape — o unico
  // acrescimo ao comportamento herdado da Central de Ligacoes, para quem navega por teclado
  // poder dispensar o balao sem sair do campo.
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

  // A largura acompanha a decisao: em coluna unica o balao continua estreito, como sempre foi.
  const duasColunas = usaDuasColunas(fatores.length)
  const v = normalizarValor(valor, maximo)
  const tituloExibido = v == null ? rotuloSemValor : titulo
  const resumo = resumoTextual({ titulo: tituloExibido, valor: v, maximo, oQueMede, fatores, nota })

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        title={resumo}
        aria-label={resumo}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        className="inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {/* aria-hidden: o numero sozinho nao diz nada util no leitor de tela — quem fala e o
            aria-label do wrapper, que carrega o balao inteiro. */}
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center rounded-full border-2 font-bold transition hover:scale-105 ${TAMANHO_CLS[tamanho]} ${classesDaBolinha(variante, faixa, v)}`}
        >
          {v == null ? '—' : v}
        </span>
      </span>
      {caixa && typeof document !== 'undefined' && createPortal(
        <div
          ref={balaoRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos ? pos.left : caixa.x,
            // Enquanto nao mediu, fica fora da tela em vez de aparecer no lugar errado.
            top: pos ? pos.top : -9999,
            transform: 'translateX(-50%)',
          }}
          className={`pointer-events-none z-[70] w-max rounded-lg bg-slate-800 px-3 py-2 text-left text-[11px] font-normal leading-snug text-white shadow-xl transition-all duration-150 ease-out ${
            duasColunas ? 'max-w-[420px]' : 'max-w-[280px]'
          } ${
            visivel ? 'translate-y-0 opacity-100' : `${pos && pos.abaixo ? '-translate-y-1' : 'translate-y-1'} opacity-0`
          }`}
        >
          <div className="font-semibold">
            {tituloExibido}{v != null && <> · {textoValor(v, maximo)}</>}
          </div>
          <div className="mt-0.5 text-slate-300">{oQueMede}</div>
          {fatores.length > 0 && (
            <ul className={`mt-1.5 ${duasColunas ? 'grid grid-cols-2 gap-x-3 gap-y-0.5' : 'space-y-0.5'}`}>
              {fatores.map((f, i) => (
                <li key={i} className="flex gap-1.5">
                  {f.peso && (
                    <span className={`shrink-0 tabular-nums font-semibold ${CLS_SINAL[f.sinal || 'neutro']}`}>{f.peso}</span>
                  )}
                  {/* min-w-0: sem ele o item do grid nao encolhe abaixo do conteudo e um rotulo
                      longo ("Sem site proprio — so rede social") estouraria a coluna. */}
                  <span className="min-w-0 text-slate-200">
                    {!f.peso && '• '}{f.rotulo}
                    {f.detalhe && <span className="text-slate-400"> — “{f.detalhe}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {nota && <div className="mt-1.5 border-t border-slate-700 pt-1 text-slate-400">{nota}</div>}
        </div>,
        document.body
      )}
    </>
  )
}
