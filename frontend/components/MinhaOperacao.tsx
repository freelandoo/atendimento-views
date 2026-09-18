'use client'
// MINHA OPERAÇÃO — a Visão Geral do COMERCIAL.
//
// ─── POR QUE ESTA TELA EXISTE ───────────────────────────────────────────────────────────
// `/dashboard` chamava `/relatorios/resumo`, que exige `RELATORIOS_VER` — capacidade que o
// `comercial` e o `member` NÃO têm. A primeira tela depois do login (e, desde o termo, depois do
// aceite) era um 403. Não foi só uma decisão de produto: era um defeito.
//
// ─── O QUE ELA É ────────────────────────────────────────────────────────────────────────
// A operação do dia de UMA pessoa: o desafio do mês, o quanto falta, o nível, a comissão, o que
// precisa ser feito agora e onde ela está no placar. Nada aqui é relatório administrativo
// liberado para o comercial — são os mesmos endpoints que ele já alcança.
//
// ─── O QUE ELA NÃO É ────────────────────────────────────────────────────────────────────
// • **Não recalcula nada.** Nível, fração, "alcançou" e contagens chegam prontos; a tradução vive
//   em `lib/minha-operacao.js`, `lib/comissao.js` e `lib/missao.js`.
// • **Não expõe a comissão de ninguém.** O placar traz nome e faturamento originado (decisão D4).
// • **Não inventa número.** Sem missão, sem plano ou sem meta legível, a seção some — não vira
//   caixa vazia nem barra em zero.
//
// Cada bloco carrega SOZINHO e falha sozinho: o `member` não alcança comissão nem leads, e uma
// negativa ali não pode derrubar a agenda dele.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { formatarDinheiro, resumoDoNivel, medalhaDaPosicao } from '@/lib/comissao'
import type { LinhaRanking, PainelComissao } from '@/lib/comissao'
import { janelaTexto, recompensaTexto, resumoDoProgresso, rotuloSituacao, minhaRecompensa } from '@/lib/missao'
import type { Missao, ProgressoMissao } from '@/lib/missao'
import { proximidade, proximosPassos, nadaPendente, minhaPosicao } from '@/lib/minha-operacao'

type RespostaMissao = {
  missao: Missao | null
  situacao?: string
  meu_progresso?: ProgressoMissao
}
type ResumoLeads = { meus: number; livres: number; parados: number }

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'

// A intensidade vira cor SEM ser a única informação: o selo e a frase sempre acompanham.
const BARRA_POR_INTENSIDADE: Record<string, string> = {
  conquista: 'bg-emerald-500',
  alta: 'bg-emerald-500',
  media: 'bg-slate-700',
  baixa: 'bg-slate-400',
}

export default function MinhaOperacao({ nome }: { nome?: string }) {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [missao, setMissao] = useState<RespostaMissao | null>(null)
  const [painel, setPainel] = useState<PainelComissao | null>(null)
  const [ranking, setRanking] = useState<LinhaRanking[]>([])
  const [euId, setEuId] = useState('')
  const [leads, setLeads] = useState<ResumoLeads | null>(null)
  const [paradoDias, setParadoDias] = useState(0)
  const [followups, setFollowups] = useState<{ vencidos: number; hoje: number } | null>(null)
  const [reunioesHoje, setReunioesHoje] = useState(0)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(() => {
    if (!empresaId) return
    setCarregando(true)
    const base = `/api/empresas/${empresaId}`

    // Cada bloco falha sozinho: quem não alcança comissão ou leads simplesmente não vê aquele
    // bloco, em vez de ver a tela inteira quebrar.
    apiFetch<RespostaMissao>(`${base}/missoes`).then((r) => setMissao(r.data)).catch(() => setMissao(null))
    apiFetch<PainelComissao>(`${base}/comissao/painel`).then((r) => setPainel(r.data)).catch(() => setPainel(null))
    apiFetch<{ ranking: LinhaRanking[] }, { usuario_id: string }>(`${base}/comissao/ranking`)
      .then((r) => { setRanking(r.data.ranking || []); setEuId(r.meta?.usuario_id || '') })
      .catch(() => setRanking([]))
    apiFetch<ResumoLeads, { parado_dias: number }>(`${base}/banco-leads/meu-resumo`)
      .then((r) => { setLeads(r.data); setParadoDias(Number(r.meta?.parado_dias) || 0) })
      .catch(() => setLeads(null))
    apiFetch<{ itens?: { situacao?: string; janela_quando?: string }[] }>(`${base}/follow-ups/call-list`)
      .then((r) => {
        const itens = Array.isArray(r.data) ? r.data : (r.data?.itens || [])
        setFollowups({
          vencidos: itens.filter((i) => i?.situacao === 'aberto' || i?.situacao === 'falha').length,
          hoje: itens.filter((i) => i?.janela_quando === 'hoje' || i?.janela_quando === 'agora').length,
        })
      })
      .catch(() => setFollowups(null))
    apiFetch<{ eventos?: unknown[] }>(`${base}/agenda?periodo=hoje`)
      .then((r) => {
        const lista = Array.isArray(r.data) ? r.data : (r.data?.eventos || [])
        setReunioesHoje(lista.length)
      })
      .catch(() => setReunioesHoje(0))
      .finally(() => setCarregando(false))
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  const nivel = resumoDoNivel(painel)
  const progressoMissao = missao?.missao ? resumoDoProgresso(missao.meu_progresso, missao.situacao) : null
  const perto = missao?.missao
    ? proximidade(missao.meu_progresso, {
      encerrado: missao.situacao === 'encerrada' || missao.situacao === 'prazo_vencido',
      formatarValor: formatarDinheiro,
    })
    : null
  const entrega = minhaRecompensa(missao?.meu_progresso)
  const posicao = minhaPosicao(ranking, euId)

  const passos = proximosPassos({
    followups_vencidos: followups?.vencidos,
    reunioes_hoje: reunioesHoje,
    leads_parados: leads?.parados,
    followups_hoje: followups?.hoje,
    leads_livres: leads?.livres,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Minha Operação</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          {nome ? `${nome}, este` : 'Este'} é o seu dia: o desafio do mês, o que precisa da sua ação
          agora e como você está no placar.
        </p>
      </div>

      {/* ── O TOPO: desafio, progresso e nível ────────────────────────────────────────── */}
      {missao?.missao && perto && progressoMissao && (
        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">Desafio do mês</p>
              <h2 className="mt-0.5 text-lg font-semibold text-slate-900">{missao.missao.titulo}</h2>
            </div>
            <div className="flex items-center gap-2">
              {/* O selo é TEXTO, não só cor — e só existe a partir de 90%. */}
              {perto.selo && (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {perto.selo}
                </span>
              )}
              <span className="text-xs text-slate-500">{rotuloSituacao(missao.situacao).rotulo}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-slate-900">{progressoMissao.titulo}</span>
            <span className="text-xs text-slate-500">Alvo {formatarDinheiro(missao.missao.alvo_valor)}</span>
          </div>

          {/* A barra tem marcos em 50/75/90 — referência visível, não decoração. */}
          <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${BARRA_POR_INTENSIDADE[perto.intensidade] || 'bg-slate-400'}`}
              style={{ width: perto.largura }}
            />
            {[50, 75, 90].map((m) => (
              <span key={m} className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${m}%` }} aria-hidden="true" />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400" aria-hidden="true">
            <span>0</span><span>50%</span><span>75%</span><span>90%</span><span>meta</span>
          </div>

          <p className={`mt-2 text-sm font-medium ${perto.marco === 100 ? 'text-emerald-700' : 'text-slate-700'}`}>
            {perto.frase}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {janelaTexto(missao.missao)} · Recompensa: {recompensaTexto(missao.missao)}
          </p>
          {entrega && (
            <p className={`mt-1 text-xs ${entrega.pago ? 'text-emerald-700' : 'text-amber-700'}`}>{entrega.frase}</p>
          )}
        </section>
      )}

      {/* ── Nível e comissão ──────────────────────────────────────────────────────────── */}
      {painel && (
        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{nivel.titulo}</h2>
            {posicao && (
              <span className="text-xs text-slate-500">
                {medalhaDaPosicao(posicao.posicao)} {posicao.posicao}º de {posicao.total} no mês
              </span>
            )}
          </div>
          {nivel.detalhe && <p className="mt-1 text-sm text-slate-600">{nivel.detalhe}</p>}
          {nivel.progresso && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${nivel.progresso.percentual}%` }} />
            </div>
          )}
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Metrica rotulo="Originado no mês" valor={formatarDinheiro(painel.originado)} />
            <Metrica rotulo="Comissão do mês" valor={formatarDinheiro(painel.comissao)} />
            <Metrica rotulo="Já paga a você" valor={formatarDinheiro(painel.comissao_paga)} />
          </dl>
          <a href="/dashboard/comissao" className="mt-3 inline-block text-xs text-brand underline-offset-2 hover:underline">
            Ver detalhes da comissão
          </a>
        </section>
      )}

      {/* ── O que precisa da sua ação ─────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">O que precisa de você agora</h2>
        {carregando && !passos.length ? (
          <p className="mt-2 text-sm text-slate-400">Carregando…</p>
        ) : passos.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">{nadaPendente(Boolean(leads?.livres))}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {passos.map((p) => (
              <li key={p.chave}>
                <a
                  href={p.href}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition hover:bg-slate-50 ${
                    p.tom === 'urgente' ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : p.tom === 'atencao' ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : p.tom === 'oportunidade' ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                          : 'border-slate-200 text-slate-700'
                  }`}
                >
                  <span>{p.texto}</span>
                  <span aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Minha carteira ────────────────────────────────────────────────────────────── */}
      {leads && (
        <section className={card}>
          <h2 className="text-lg font-semibold text-slate-900">Minha carteira</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <Metrica rotulo="Meus leads" valor={String(leads.meus)} ajuda="Sob sua responsabilidade agora." />
            <Metrica rotulo="Livres" valor={String(leads.livres)} ajuda="Sem dono — qualquer um pode assumir." />
            <Metrica
              rotulo="Parados"
              valor={String(leads.parados)}
              ajuda={paradoDias ? `Seus, sem ação registrada há ${paradoDias} dias ou mais. Já contados em "Meus leads".` : 'Já contados em "Meus leads".'}
            />
          </dl>
          <a href="/dashboard/banco-leads" className="mt-3 inline-block text-xs text-brand underline-offset-2 hover:underline">
            Abrir o Banco de Leads
          </a>
        </section>
      )}

      {/* ── Placar ────────────────────────────────────────────────────────────────────── */}
      {ranking.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-semibold text-slate-900">Placar do mês</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Por faturamento pago originado. A comissão de cada pessoa é assunto dela com a empresa.
          </p>
          <ol className="mt-3 divide-y divide-slate-100">
            {ranking.slice(0, 5).map((l, i) => {
              const sou = String(l.usuario_id) === String(euId)
              return (
                <li key={l.usuario_id} className={`flex items-center justify-between py-2 text-sm ${sou ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                  <span>
                    <span className="mr-2 text-slate-400">{medalhaDaPosicao(i + 1) || `${i + 1}º`}</span>
                    {l.nome || 'Sem nome'}{sou && <span className="ml-2 text-[11px] text-cyan-700">você</span>}
                  </span>
                  <span className="tabular-nums">{formatarDinheiro(l.originado)}</span>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* Sem nada carregado, a tela DIZ o que houve em vez de ficar em branco. */}
      {!carregando && !missao?.missao && !painel && !leads && (
        <section className={card}>
          <p className="text-sm text-slate-600">
            Ainda não há desafio, comissão ou carteira para mostrar aqui. Use o menu ao lado para
            abrir suas conversas e sua agenda.
          </p>
        </section>
      )}
    </div>
  )
}

function Metrica({ rotulo, valor, ajuda }: { rotulo: string; valor: string; ajuda?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="mt-1 text-xl font-semibold text-slate-900">{valor}</dd>
      {/* Cada número declara o que mede — os três não se somam. */}
      {ajuda && <dd className="mt-0.5 text-xs text-slate-400">{ajuda}</dd>}
    </div>
  )
}
