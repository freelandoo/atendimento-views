'use client'
/**
 * QUADRO DO DIA — o planejamento diário do comercial, dentro do Banco de Leads.
 *
 * ⚠️ A REGRA QUE GOVERNA A TELA: a coluna é o ESTADO DO DIA, nunca o ciclo comercial. Mover um
 * card não muda `status`, não assume lead, não transfere responsável e **não envia nada**. Cada
 * coluna declara isso em texto (`lib/plano-dia.js` → `consequencia`), porque um quadro com
 * "Feito" ao lado de um CRM é lido como "fechei a venda" se ninguém disser o contrário.
 *
 * ⚠️ ARRASTAR É ATALHO, NUNCA O ÚNICO CAMINHO. O card inteiro abre a ficha, e teclado move o
 * foco do trabalho com Ctrl+←/→. O arrastar continua como gesto rápido do desktop, mas a tela
 * não obriga a pessoa a usar um select visível para cada card.
 *
 * ⚠️ QUEM DECIDE SE O MOVIMENTO VALE É O SERVIDOR. A entrada em "Feito hoje" exige evidência:
 * o backend procura ação registrada hoje para o lead e, não achando, devolve 422 — e só então
 * esta tela pede a nota, gravada como AUTODECLARADA. Repetir a checagem aqui criaria uma
 * segunda régua, mais frouxa, e seria nela que o operador acreditaria.
 *
 * A movimentação é OTIMISTA com reversão: o card anda na hora e volta ao lugar se o servidor
 * recusar (mesmo contrato do `AlternadorModoIa`). Sem isso, arrastar teria a latência de uma
 * requisição a cada gesto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback } from '@/components/feedback/FeedbackProvider'
import Botao from '@/components/ui/Botao'
import FolhaModal from '@/components/ui/FolhaModal'
import { classesEntrada } from '@/lib/ui-primitivos'
import { celulaOrigem } from '@/lib/lead-origem'
import {
  COLUNAS, montarColunas, aoMoverPara, seloConclusao, seloOrigemEntrada,
  horarioDoCard, resumoDoDia, avisoPendentes, rotuloDia,
  type CardDia, type EtapaDia,
} from '@/lib/plano-dia'
import ModalPlanejarDia, { type CandidatoDia } from '@/components/ModalPlanejarDia'

type RespostaQuadro = {
  itens: CardDia[]
  sugestoes: { prospect_id: string; nome: string | null; origem_entrada: string; origem?: string | null; telefone?: string | null; cidade?: string | null; quando?: string | null }[]
  pendentes_anteriores: CardDia[]
}

function fmtHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const TOM_COLUNA: Record<string, string> = {
  neutro: 'border-line',
  info: 'border-brand/30',
  warn: 'border-estado-warn/30',
  ok: 'border-estado-ok/30',
}

export default function QuadroDoDia({
  empresaId, candidatos, onAbrirLead,
}: {
  empresaId: string
  /** A carteira já carregada pela Lista — o Quadro não faz uma segunda listagem. */
  candidatos: CandidatoDia[]
  /** Abre a ficha do lead (a mesma da Lista), na seção pedida. */
  onAbrirLead: (prospectId: string, gatilho: string) => void
}) {
  const fb = useFeedback()
  const base = `/api/empresas/${empresaId}/banco-leads`
  const [dia, setDia] = useState('')
  const [hoje, setHoje] = useState('')
  const [itens, setItens] = useState<CardDia[]>([])
  const [sugestoes, setSugestoes] = useState<RespostaQuadro['sugestoes']>([])
  const [pendentes, setPendentes] = useState<CardDia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [planejarAberto, setPlanejarAberto] = useState(false)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<EtapaDia | null>(null)
  /** O card que o servidor recusou concluir sem evidência — vira o modal da nota. */
  const [pedirNota, setPedirNota] = useState<{ item: CardDia; motivo: string } | null>(null)
  const [nota, setNota] = useState('')
  // Token de requisição: trocar de dia rápido nunca pode pintar a tela com o dia anterior
  // (mesmo contrato de `ConversaPainel`).
  const pedidoRef = useRef(0)
  const ignorarCliqueAposArrasteRef = useRef(false)

  const carregar = useCallback(async (diaPedido?: string) => {
    const token = ++pedidoRef.current
    setCarregando(true)
    setErro('')
    try {
      const qs = diaPedido ? `?dia=${encodeURIComponent(diaPedido)}` : ''
      const r = await apiFetch<RespostaQuadro>(`${base}/plano-dia${qs}`)
      if (token !== pedidoRef.current) return
      setItens(r.data.itens || [])
      setSugestoes(r.data.sugestoes || [])
      setPendentes(r.data.pendentes_anteriores || [])
      const meta = (r as { meta?: { dia?: string; hoje?: string } }).meta
      if (meta?.dia) setDia(meta.dia)
      if (meta?.hoje) setHoje(meta.hoje)
    } catch (e) {
      if (token !== pedidoRef.current) return
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o quadro.')
    } finally {
      if (token === pedidoRef.current) setCarregando(false)
    }
  }, [base])

  useEffect(() => { carregar() }, [carregar])

  const colunas = useMemo(() => montarColunas(itens), [itens])
  const resumo = useMemo(() => resumoDoDia(itens), [itens])
  const aviso = useMemo(() => avisoPendentes(pendentes), [pendentes])
  const jaNoDia = useMemo(() => new Set(itens.map((i) => i.prospect_id)), [itens])

  /**
   * Move um card. OTIMISTA com reversão — e a reversão é o ponto: quando o servidor recusa
   * concluir sem evidência (422), o card volta para a coluna de origem e a tela pede a nota.
   */
  async function mover(item: CardDia, destino: EtapaDia, notaConclusao?: string) {
    const veredito = aoMoverPara(destino)
    if (!veredito.ok || item.etapa === destino) return
    const origem = item.etapa
    setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, etapa: destino } : i)))
    try {
      const r = await apiFetch<CardDia>(`${base}/plano-dia/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ etapa: destino, nota: notaConclusao }),
      })
      setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...r.data } : i)))
      setPedirNota(null)
      setNota('')
    } catch (e) {
      setItens((prev) => prev.map((i) => (i.id === item.id ? { ...i, etapa: origem } : i)))
      const msg = e instanceof Error ? e.message : 'Não foi possível mover o card.'
      // 422 = "Feito hoje" sem evidência. Não é erro do operador: é a saída honesta, e a tela
      // oferece escrever o que foi feito em vez de só negar.
      if (destino === 'feito' && !notaConclusao) {
        setPedirNota({ item: { ...item, etapa: origem }, motivo: msg })
        setNota('')
        return
      }
      fb.toast(msg, 'error')
    }
  }

  async function adicionarAoDia(ids: string[], origem: string) {
    setOcupado(true)
    try {
      const r = await apiFetch<{ adicionados: number; ja_no_dia: number; fora_do_recorte: number }>(
        `${base}/plano-dia`,
        { method: 'POST', body: JSON.stringify({ dia, prospect_ids: ids, origem }) }
      )
      const { adicionados, ja_no_dia: jaTinha, fora_do_recorte: fora } = r.data
      // O que NÃO entrou é dito, nunca somado ao sucesso: "5 adicionados" quando 2 já estavam
      // lá faria a pessoa procurar cards que nunca foram criados.
      const partes = [`${adicionados} lead(s) no plano`]
      if (jaTinha) partes.push(`${jaTinha} já estava(m) no dia`)
      if (fora) partes.push(`${fora} fora da sua carteira`)
      fb.toast(partes.join(' · '), adicionados ? 'success' : 'info')
      await carregar(dia)
      if (adicionados) setPlanejarAberto(false)
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível adicionar ao dia.', 'error')
    } finally { setOcupado(false) }
  }

  async function removerDoDia(item: CardDia) {
    setItens((prev) => prev.filter((i) => i.id !== item.id))
    try {
      await apiFetch(`${base}/plano-dia/${item.id}`, { method: 'DELETE' })
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível tirar o lead do dia.', 'error')
      carregar(dia)
    }
  }

  async function replanejar() {
    setOcupado(true)
    try {
      const r = await apiFetch<{ movidos: number }>(`${base}/plano-dia/replanejar`, {
        method: 'POST', body: JSON.stringify({ dia }),
      })
      fb.toast(`${r.data.movidos} pendência(s) trazida(s) para ${rotuloDia(dia, hoje).toLowerCase()}.`, 'success')
      await carregar(dia)
    } catch (e) {
      fb.toast(e instanceof Error ? e.message : 'Não foi possível replanejar.', 'error')
    } finally { setOcupado(false) }
  }

  function moverPorTeclado(item: CardDia, direcao: -1 | 1) {
    const atual = COLUNAS.findIndex((c) => c.chave === item.etapa)
    const destino = COLUNAS[atual + direcao]
    if (destino) mover(item, destino.chave)
  }

  return (
    <div className="space-y-3">
      {/* CABEÇALHO — a data, o resumo do dia e a porta de entrada. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            Quadro do dia · <span className="text-brand">{rotuloDia(dia, hoje)}</span>
          </h2>
          <p className="text-xs text-ink-3" aria-live="polite">{resumo.texto}</p>
        </div>
        <label htmlFor="quadro-dia" className="sr-only">Data do planejamento</label>
        <input
          id="quadro-dia"
          type="date"
          value={dia}
          onChange={(e) => { setDia(e.target.value); carregar(e.target.value) }}
          className={classesEntrada({ extra: 'h-9 w-auto' })}
        />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Botao variante="primaria" onClick={() => setPlanejarAberto(true)}>Planejar meu dia</Botao>
        </span>
      </div>

      {/* PENDÊNCIAS — prévia, nunca movimento automático. Nada se move à meia-noite. */}
      {aviso && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>{aviso.texto} Elas continuam no dia em que foram planejadas até você trazer.</span>
          <Botao variante="secundaria" tamanho="sm" onClick={replanejar} carregando={ocupado} className="ml-auto">
            {aviso.acao}
          </Botao>
        </div>
      )}

      {erro && (
        <div className="rounded-lg border border-estado-danger/30 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{erro}</p>
          <button type="button" onClick={() => carregar(dia)} className="mt-1 text-xs font-medium text-brand hover:underline">
            Tentar de novo
          </button>
        </div>
      )}

      {carregando && !itens.length ? (
        <p className="py-8 text-center text-sm text-ink-3">Carregando o quadro…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {colunas.map((col) => (
            <section
              key={col.chave}
              aria-label={col.titulo}
              onDragOver={(e) => { e.preventDefault(); setAlvo(col.chave) }}
              onDragLeave={() => setAlvo((a) => (a === col.chave ? null : a))}
              onDrop={(e) => {
                e.preventDefault()
                setAlvo(null)
                const id = e.dataTransfer.getData('text/plain') || arrastando
                const item = itens.find((i) => i.id === id)
                if (item) mover(item, col.chave)
                setArrastando(null)
              }}
              className={`flex min-h-[140px] flex-col rounded-lg border bg-surface-2 p-2 transition ${
                alvo === col.chave ? 'scale-[1.01] border-brand bg-brand/5 shadow-card ring-2 ring-brand/20' : TOM_COLUNA[col.tom] || 'border-line'
              }`}
            >
              <header className="px-1 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{col.titulo}</h3>
                  <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink-3">
                    {col.cards.length}
                  </span>
                </div>
                {/* A CONSEQUÊNCIA em texto, sempre. É o que impede o quadro de ser lido como funil. */}
                <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{col.consequencia}</p>
              </header>

              <div className="flex-1 space-y-2">
                {col.cards.map((c) => {
                  const o = celulaOrigem(c)
                  const selo = seloConclusao(c)
                  const entrada = seloOrigemEntrada(c.origem_entrada)
                  const hora = horarioDoCard(c, fmtHora)
                  return (
                    <article
                      key={c.id}
                      draggable
                      tabIndex={0}
                      aria-label={`Abrir ficha de ${c.nome || 'lead sem nome'}. Arraste para mover no quadro do dia.`}
                      title="Clique para abrir a ficha. Arraste para mover entre colunas."
                      onClick={() => {
                        if (ignorarCliqueAposArrasteRef.current) {
                          ignorarCliqueAposArrasteRef.current = false
                          return
                        }
                        onAbrirLead(c.prospect_id, 'nome')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onAbrirLead(c.prospect_id, 'nome')
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
                          e.preventDefault()
                          moverPorTeclado(c, -1)
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
                          e.preventDefault()
                          moverPorTeclado(c, 1)
                        }
                      }}
                      onDragStart={(e) => {
                        ignorarCliqueAposArrasteRef.current = true
                        e.dataTransfer.setData('text/plain', c.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setArrastando(c.id)
                      }}
                      onDragEnd={() => {
                        setArrastando(null)
                        setAlvo(null)
                        window.setTimeout(() => { ignorarCliqueAposArrasteRef.current = false }, 0)
                      }}
                      className={`group rounded-lg border border-line bg-surface p-2.5 shadow-card transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                        arrastando === c.id
                          ? 'scale-[0.98] rotate-1 cursor-grabbing border-brand/60 opacity-60 shadow-md ring-2 ring-brand/20'
                          : 'cursor-grab hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md active:cursor-grabbing'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink group-hover:text-brand">
                          {c.nome || 'Sem nome'}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removerDoDia(c) }}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`Tirar ${c.nome || 'este lead'} do dia`}
                          title="Tirar do dia — o lead continua na carteira, com o mesmo responsável"
                          className="shrink-0 rounded px-1 text-ink-3 hover:bg-surface-3 hover:text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          ×
                        </button>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={o.classe}
                          title={`${o.rotulo} — ${o.dica}`}
                        >
                          {o.curto}
                        </span>
                        {hora && (
                          <span className="rounded-md border border-brand/20 bg-brand/5 px-1.5 py-0.5 font-medium text-brand" title="Compromisso na agenda">
                            {hora}
                          </span>
                        )}
                        {entrada && (
                          <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800" title={entrada.dica}>
                            {entrada.rotulo}
                          </span>
                        )}
                        {!c.telefone && (
                          <span className="text-amber-700" title="Sem telefone: o trabalho aqui é completar o cadastro">
                            sem telefone
                          </span>
                        )}
                      </div>

                      {c.objetivo && <p className="mt-1.5 text-xs leading-snug text-ink-2">{c.objetivo}</p>}

                      {/* Autodeclaração NUNCA aparece como evidência — o rótulo diz qual é qual. */}
                      {selo && (
                        <p className={`mt-1.5 inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${selo.classe}`} title={selo.dica}>
                          {selo.rotulo}
                        </p>
                      )}
                      {selo && !selo.prova && c.conclusao_nota && (
                        <p className="mt-1 text-[11px] italic leading-snug text-ink-3">“{c.conclusao_nota}”</p>
                      )}

                      <p className="sr-only">
                        Use Enter para abrir. Use Control mais seta para esquerda ou direita para mover entre colunas.
                      </p>
                    </article>
                  )
                })}

                {col.cards.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line px-2 py-4 text-center text-[11px] text-ink-3">
                    {col.chave === 'para_hoje'
                      ? 'Use “Planejar meu dia” para escolher os leads.'
                      : 'Arraste um card para cá.'}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <ModalPlanejarDia
        aberto={planejarAberto}
        onFechar={() => setPlanejarAberto(false)}
        candidatos={candidatos}
        sugestoes={sugestoes}
        jaNoDia={jaNoDia}
        ocupado={ocupado}
        onAdicionar={adicionarAoDia}
        rotuloDia={rotuloDia(dia, hoje)}
      />

      {/* A SAÍDA HONESTA do "Feito hoje": o servidor não achou ação registrada hoje, então
          pergunta o que foi feito — e grava como AUTODECLARADO, dito em texto no card. */}
      <FolhaModal
        aberto={!!pedirNota}
        titulo="Concluir sem registro automático"
        descricao={pedirNota?.motivo || ''}
        onFechar={() => { setPedirNota(null); setNota('') }}
        tamanho="sm"
        rodape={
          <>
            <Botao variante="neutra" onClick={() => { setPedirNota(null); setNota('') }}>Cancelar</Botao>
            <Botao
              variante="primaria"
              disabled={!nota.trim()}
              motivoDesabilitado={!nota.trim() ? 'Escreva o que foi feito.' : ''}
              onClick={() => { if (pedirNota) mover(pedirNota.item, 'feito', nota.trim()) }}
            >
              Concluir assim mesmo
            </Botao>
          </>
        }
      >
        <label className="block text-xs text-ink-2">
          O que foi feito com este lead hoje?
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            placeholder="Ex.: falei por telefone pessoal, ele pediu para retomar em outubro."
            className="mt-1 w-full resize-y rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
        </label>
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          O card ficará marcado como <b>autodeclarado</b> — o sistema não encontrou ligação,
          reunião ou abordagem registrada hoje, e não vai afirmar que encontrou.
        </p>
      </FolhaModal>
    </div>
  )
}
