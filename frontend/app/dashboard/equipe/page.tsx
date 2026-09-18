'use client'
// Painel da EQUIPE — CRM em equipe, Etapa 12.
//
// Responde uma pergunta só: **quem está com o quê agora?** É a tela que o admin abre para
// redistribuir trabalho, não para avaliar gente.
//
// ─── O QUE ESTA TELA DELIBERADAMENTE NÃO É ──────────────────────────────────────────────
// • **Não é placar.** As contagens medem coisas diferentes (carteira, fila, compromisso,
//   histórico) e não se somam num total. Cada coluna diz o que mede, pelo mesmo motivo do
//   `oQueMede` obrigatório da `BolinhaPontuacao`.
// • **Não é auditoria agregada.** A linha do tempo é rastreabilidade — a migration 047 declara
//   que a auditoria não deve ser fonte de dashboard —, então ela aparece crua, em ordem
//   cronológica inversa, sem nenhum número derivado dela.
// • **Não é a tela de contas.** Adicionar, desativar e trocar papel vivem em
//   `/dashboard/contas-empresa`. Aqui só se OLHA a distribuição do trabalho.
//
// Toda a tradução (ordem, rótulos, avisos) vive em `lib/equipe-painel.js`; a tela só desenha.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { Spinner } from '@/components/feedback/FeedbackProvider'
import {
  ATIVIDADE_HOJE_COLUNAS,
  COLUNAS,
  atividadeHoje,
  avisoDeInativo,
  descreverAtividade,
  ordenarEquipe,
  ordenarPorAtividadeHoje,
  rotuloPapel,
  janelaAtivaRotulo,
  rotuloUltimoAcesso,
  temTrabalhoSemDono,
} from '@/lib/equipe-painel'
import type { EventoAuditoria, LinhaEquipe } from '@/lib/equipe-painel'
import { detalheMaisAntigo, resumoDaEquipe } from '@/lib/lead-parado'
import { formatarDinheiro } from '@/lib/comissao'

type Resposta = {
  equipe: LinhaEquipe[]
  sem_responsavel: LinhaEquipe
  avisos: { inativos_com_carga: { usuario_id: string | null; nome: string }[] }
}

// Missão e ranking são CONSOLIDAÇÃO DE LEITURA: os mesmos endpoints que a tela de Comissão já
// usa, trazidos para cá porque o dono abre este painel para ter a operação inteira num lugar só.
// Nenhuma rota nova, nenhuma regra nova — se divergirem daquela tela, é defeito.
type MissaoAtiva = {
  missao: { id: string; titulo: string; alvo_valor: string | number } | null
  situacao?: string
  alcancaram?: { usuario_id: string; nome: string | null; valor: number }[] | null
}
type LinhaRankingDono = { usuario_id: string; nome: string | null; originado: number }

export default function EquipePage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<LinhaEquipe | null>(null)
  const [prazoParado, setPrazoParado] = useState<number>(0)
  const [missao, setMissao] = useState<MissaoAtiva | null>(null)
  const [ranking, setRanking] = useState<LinhaRankingDono[]>([])

  const carregar = useCallback(() => {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    apiFetch<Resposta, { parado_dias: number }>(`/api/empresas/${empresaId}/equipe`)
      .then((r) => { setDados(r.data); setPrazoParado(Number(r.meta?.parado_dias) || 0) })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar a equipe.'))
      .finally(() => setCarregando(false))

    // Missão e ranking carregam SEPARADO e em silêncio: são consolidação, e uma falha neles não
    // pode derrubar o painel de carga, que é o dado que o admin vem redistribuir.
    apiFetch<MissaoAtiva>(`/api/empresas/${empresaId}/missoes`)
      .then((r) => setMissao(r.data))
      .catch(() => setMissao(null))
    apiFetch<{ ranking: LinhaRankingDono[] }>(`/api/empresas/${empresaId}/comissao/ranking`)
      .then((r) => setRanking(r.data.ranking || []))
      .catch(() => setRanking([]))
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  const linhas = ordenarEquipe(dados?.equipe || [])
  const linhasPorAtividade = ordenarPorAtividadeHoje(dados?.equipe || [])
  const semDono = dados?.sem_responsavel
  const mostrarSemDono = temTrabalhoSemDono(semDono)
  const parados = resumoDaEquipe(dados?.equipe || [], prazoParado)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Quem está com o quê agora. As colunas medem coisas diferentes e <b>não se somam</b> —
          passe o mouse no cabeçalho para ver o que cada uma conta. Para adicionar pessoas ou
          trocar papéis, use <b>Contas da empresa</b>.
        </p>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}{' '}
          <button onClick={carregar} className="underline underline-offset-2">Tentar de novo</button>
        </div>
      )}

      {carregando && !dados && (
        <div className="flex justify-center py-16"><Spinner size={22} /></div>
      )}

      {/* ── Missão ativa e ranking: consolidação de LEITURA ───────────────────────────────
          Os mesmos dados da tela de Comissão, trazidos para cá porque o dono abre este painel
          para ver a operação inteira num lugar só. Nenhuma regra nova: se divergir de lá, é
          defeito. Some quando não há nada publicado — card vazio não informa. */}
      {(missao?.missao || ranking.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {missao?.missao && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Missão ativa</h2>
                <span className="text-xs text-slate-500">
                  Alvo {formatarDinheiro(missao.missao.alvo_valor)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{missao.missao.titulo}</p>
              {/* Quem ALCANÇOU, não quem está em que ponto: o progresso parcial é pessoal, e
                  esta lista existe para o dono saber a quem pagar a recompensa. */}
              <p className="mt-2 text-xs text-slate-500">
                {missao.alcancaram === null || missao.alcancaram === undefined
                  ? 'Progresso de cada pessoa é pessoal.'
                  : missao.alcancaram.length === 0
                    ? 'Ninguém alcançou o alvo ainda.'
                    : `${missao.alcancaram.length === 1 ? '1 pessoa alcançou' : `${missao.alcancaram.length} pessoas alcançaram`} o alvo: ${missao.alcancaram.map((a) => a.nome || 'Sem nome').join(', ')}.`}
              </p>
              <a href="/dashboard/comissao" className="mt-3 inline-block text-xs text-brand underline-offset-2 hover:underline">
                Ver na Comissão
              </a>
            </section>
          )}

          {ranking.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Faturamento originado no mês</h2>
              {/* Faturamento PAGO originado, nunca a comissão de ninguém: quanto cada um ganha é
                  assunto dele com a empresa (decisão D4, 18/09). */}
              <ul className="mt-2 divide-y divide-slate-100">
                {ranking.slice(0, 5).map((l) => (
                  <li key={l.usuario_id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{l.nome || 'Sem nome'}</span>
                    <span className="font-medium tabular-nums text-slate-900">{formatarDinheiro(l.originado)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ── Leads parados: o sistema MARCA e AVISA; devolver é humano ─────────────────── */}
      {parados && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Leads parados</h2>
          <p className="mt-1 text-sm text-amber-800">{parados.frase}</p>
          <p className="mt-1 text-xs text-amber-700">{parados.acao}</p>
        </section>
      )}

      {dados && (
        <>
          {/* O trabalho sem dono é o motivo de esta tela existir: sem ele, a soma das linhas não
              fecharia com o total e a fila ficaria invisível. Zerado, não aparece — não há nada
              a redistribuir. */}
          {mostrarSemDono && semDono && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-sm font-semibold text-amber-900">Trabalho sem responsável</h2>
              <p className="mt-0.5 text-xs text-amber-800">
                Não é um erro: lead livre e conversa não atribuída são filas legítimas, e qualquer
                pessoa da equipe pode puxá-las. Vira problema quando ninguém puxa.
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {COLUNAS.filter((c) => c.chave !== 'ligacoes').map((c) => (
                  <div key={c.chave} title={c.oQueMede}>
                    <div className="text-lg font-semibold tabular-nums text-amber-900">
                      {(semDono as unknown as Record<string, number>)[c.chave] ?? 0}
                    </div>
                    <div className="text-[11px] text-amber-800">{c.rotulo}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <section className="rounded-2xl border border-cyan-100 bg-gradient-to-br from-white via-cyan-50/50 to-slate-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Movimento de hoje</h2>
                <p className="mt-0.5 max-w-2xl text-xs text-slate-600">
                  Ações registradas desde o início do dia. A janela ativa é uma estimativa entre a primeira e a última ação registrada, não ponto eletrônico.
                </p>
              </div>
              <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-700">Hoje</span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {linhasPorAtividade.map((l) => {
                const a = atividadeHoje(l)
                return (
                  <article key={l.usuario_id || l.nome} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{l.nome}</div>
                        <div className="text-[11px] text-slate-500">{rotuloPapel(l.papel)}</div>
                      </div>
                      <div className="text-right" title="Estimativa entre a primeira e a última ação registrada hoje.">
                        <div className="text-sm font-bold text-slate-800">{janelaAtivaRotulo(a.janela_ativa_min)}</div>
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">janela ativa</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {ATIVIDADE_HOJE_COLUNAS.map((c) => (
                        <div key={c.chave} title={c.oQueMede} className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                          <div className="text-base font-semibold tabular-nums text-slate-800">{(a as unknown as Record<string, number>)[c.chave] ?? 0}</div>
                          <div className="text-[10px] text-slate-500">{c.rotulo}</div>
                        </div>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Pessoa</th>
                  <th className="px-4 py-2 text-left">Papel</th>
                  {COLUNAS.map((c) => (
                    <th key={c.chave} className="px-4 py-2 text-right" title={c.oQueMede}>{c.rotulo}</th>
                  ))}
                  <th className="px-4 py-2 text-left">Último acesso</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {linhas.length === 0 && (
                  <tr><td colSpan={COLUNAS.length + 4} className="px-4 py-10 text-center text-slate-400">
                    Nenhum membro nesta empresa ainda.
                  </td></tr>
                )}
                {linhas.map((l) => {
                  const aviso = avisoDeInativo(l)
                  return (
                    <tr key={l.usuario_id || l.nome} className={l.ativo === false ? 'bg-slate-50/60' : ''}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{l.nome}</div>
                        {l.email && <div className="text-xs text-slate-400">{l.email}</div>}
                        {/* Desativar revoga o acesso e NÃO redistribui: o trabalho não some junto
                            com a conta, e sem este aviso a carteira ficaria parada sem ninguém
                            notar. */}
                        {aviso && <div className="mt-0.5 max-w-xs text-[11px] leading-snug text-amber-700">{aviso}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{rotuloPapel(l.papel)}</td>
                      {COLUNAS.map((c) => {
                        const v = (l as unknown as Record<string, number>)[c.chave] ?? 0
                        // Vencido é prazo estourado (vermelho); parado é falta de ação (âmbar).
                        // Tons diferentes porque são problemas diferentes — e nenhum dos dois é
                        // só cor: o balão do cabeçalho diz o que a coluna mede.
                        const vencido = c.chave === 'follow_ups_vencidos' && v > 0
                        const parado = c.chave === 'leads_parados' && v > 0
                        const tom = vencido ? 'font-semibold text-rose-600'
                          : parado ? 'font-semibold text-amber-700' : 'text-slate-700'
                        const detalhe = parado ? detalheMaisAntigo(l.leads_parados_mais_antigo_dias) : ''
                        return (
                          <td key={c.chave} className={`px-4 py-3 text-right tabular-nums ${tom}`} title={detalhe || undefined}>
                            {v}
                          </td>
                        )
                      })}
                      <td className="px-4 py-3 text-xs text-slate-500">{rotuloUltimoAcesso(l.ultimo_acesso_em)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setAberta(l)} className="text-xs text-brand underline-offset-2 hover:underline">
                          Atividade
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aberta && aberta.usuario_id && (
        <ModalAtividade empresaId={empresaId} pessoa={aberta} onFechar={() => setAberta(null)} />
      )}
    </div>
  )
}

/**
 * Linha do tempo de uma pessoa — RASTREABILIDADE, não métrica.
 *
 * Ordem cronológica inversa, limite baixo, nenhum agregado: a migration 047 declara que a
 * auditoria não deve ser fonte de dashboard. O `contexto` não é exibido cru; os módulos que o
 * escrevem já o mantêm sem PII, mas exibi-lo aqui convidaria a tela a virar um visualizador de
 * dado técnico do lead.
 */
function ModalAtividade({ empresaId, pessoa, onFechar }: {
  empresaId: string
  pessoa: LinhaEquipe
  onFechar: () => void
}) {
  const [eventos, setEventos] = useState<EventoAuditoria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    apiFetch<EventoAuditoria[]>(`/api/empresas/${empresaId}/equipe/${pessoa.usuario_id}/atividade?limit=50`)
      .then((r) => { if (vivo) setEventos(r.data || []) })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar a atividade.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [empresaId, pessoa.usuario_id])

  useEffect(() => {
    const aoTeclado = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', aoTeclado)
    return () => window.removeEventListener('keydown', aoTeclado)
  }, [onFechar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={`Atividade de ${pessoa.nome}`}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Atividade de {pessoa.nome}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Últimas ações registradas. É rastreabilidade — não é medida de produtividade.
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="px-2 text-xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>

        {carregando && <div className="flex justify-center py-8"><Spinner /></div>}
        {erro && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>}
        {!carregando && !erro && eventos.length === 0 && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            Nenhuma ação registrada para esta pessoa nesta empresa.
          </p>
        )}

        {eventos.length > 0 && (
          <ul className="mt-4 space-y-2">
            {eventos.map((ev, i) => {
              const d = descreverAtividade(ev)
              return (
                <li key={ev.id || i} className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 pb-2 text-xs last:border-0">
                  {/* Ação nova no servidor aparece como o slug que ela é — nunca como "—". */}
                  <span className={d.conhecida ? 'text-slate-700' : 'font-mono text-slate-500'}>{d.rotulo}</span>
                  {d.entidade && <span className="text-slate-400">({d.entidade})</span>}
                  <span className="ml-auto tabular-nums text-slate-400">{d.quando}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}
