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
//   • somente leitura (`pointer-events-none`): nenhum controle dentro do balao.
//   • nunca renderiza JSON, id, UUID, place_id ou telefone — o balao e' operacional.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  classesDaBolinha, normalizarValor, resumoTextual, textoValor,
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
  const [caixa, setCaixa] = useState<{ x: number; y: number } | null>(null)
  const [visivel, setVisivel] = useState(false)

  const abrir = useCallback(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setCaixa({ x: r.left + r.width / 2, y: r.top })
  }, [])
  const fechar = useCallback(() => { setCaixa(null); setVisivel(false) }, [])

  // Anima em dois frames: monta invisivel e sobe a opacidade no frame seguinte. Fecha em
  // scroll/resize (a ancora se moveria e o balao ficaria solto) e em Escape — o unico
  // acrescimo ao comportamento herdado da Central de Ligacoes, para quem navega por teclado
  // poder dispensar o balao sem sair do campo.
  useEffect(() => {
    if (!caixa) return
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
  }, [caixa, fechar])

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
          role="tooltip"
          style={{ position: 'fixed', left: caixa.x, top: caixa.y - 8, transform: 'translate(-50%, -100%)' }}
          className={`pointer-events-none z-[70] w-max max-w-[280px] rounded-lg bg-slate-800 px-3 py-2 text-left text-[11px] font-normal leading-snug text-white shadow-xl transition-all duration-150 ease-out ${visivel ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
        >
          <div className="font-semibold">
            {tituloExibido}{v != null && <> · {textoValor(v, maximo)}</>}
          </div>
          <div className="mt-0.5 text-slate-300">{oQueMede}</div>
          {fatores.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {fatores.map((f, i) => (
                <li key={i} className="flex gap-1.5">
                  {f.peso && (
                    <span className={`shrink-0 tabular-nums font-semibold ${CLS_SINAL[f.sinal || 'neutro']}`}>{f.peso}</span>
                  )}
                  <span className="text-slate-200">
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
