'use client'
// COMISSÃO do comercial — migration 083.
//
// A tela responde duas perguntas, e a ordem importa: **quanto eu já fiz este mês** e **o que
// falta para o próximo nível**. Tudo o mais é consequência.
//
// ─── O QUE ESTA TELA DELIBERADAMENTE NÃO É ──────────────────────────────────────────────
// • **Não é placar de esforço.** O ranking é por FATURAMENTO PAGO ORIGINADO. A guarda de
//   `lib/equipe-painel.js`, que proíbe placar por ATIVIDADE (ações/dia, horas), continua
//   valendo e não foi tocada — resultado de negócio verificável é outra coisa que vigilância.
// • **Não mostra a comissão dos colegas.** O ranking traz nome e faturamento originado; quanto
//   cada um ganha é assunto dele com a empresa (decisão D4, 2026-09-18).
// • **Não calcula nada.** Faixa, percentual e valor chegam prontos do backend. A tradução vive
//   em `lib/comissao.js`; aqui só se desenha.
//
// Quem não tem COMISSAO_GERENCIAR vê só o próprio painel — o recorte é do SERVIDOR, e a tela o
// DECLARA em texto: recortar em silêncio faria o SDR achar que perdeu vendas.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { Spinner } from '@/components/feedback/FeedbackProvider'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import {
  ORIGEM_ORIGINADOR,
  acoesDaVenda,
  destacarVoce,
  formatarDinheiro,
  formatarPercentual,
  medalhaDaPosicao,
  motivoNaoCancelavel,
  resumoDoNivel,
  rotuloCompetencia,
  rotuloStatus,
} from '@/lib/comissao'
import type { LinhaRanking, PainelComissao, VendaResumo } from '@/lib/comissao'
import {
  janelaTexto,
  minhaRecompensa,
  recompensaTexto,
  resumoDeQuemAlcancou,
  resumoDoProgresso,
  rotuloSituacao,
} from '@/lib/missao'
import type { Missao, ProgressoMissao, QuemAlcancou } from '@/lib/missao'

const TOM_SELO: Record<string, string> = {
  espera: 'bg-amber-50 text-amber-700 border-amber-200',
  positivo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  concluido: 'bg-blue-50 text-blue-700 border-blue-200',
  neutro: 'bg-slate-100 text-slate-600 border-slate-200',
}

export default function ComissaoPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [painel, setPainel] = useState<PainelComissao | null>(null)
  const [ranking, setRanking] = useState<LinhaRanking[]>([])
  const [euId, setEuId] = useState<string>('')
  const [podeGerenciar, setPodeGerenciar] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [modal, setModal] = useState<{ tipo: string; venda: VendaResumo } | null>(null)
  const [novaVenda, setNovaVenda] = useState(false)

  const carregar = useCallback(() => {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    Promise.all([
      apiFetch<PainelComissao, { usuario_id: string; pode_gerenciar: boolean }>(`/api/empresas/${empresaId}/comissao/painel`),
      apiFetch<{ competencia: string; ranking: LinhaRanking[] }, { usuario_id: string }>(`/api/empresas/${empresaId}/comissao/ranking`),
    ])
      .then(([p, r]) => {
        setPainel(p.data)
        setRanking(r.data.ranking || [])
        setEuId(r.meta?.usuario_id || '')
        setPodeGerenciar(Boolean(p.meta?.pode_gerenciar))
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar a comissão.'))
      .finally(() => setCarregando(false))
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  const resumo = resumoDoNivel(painel)
  const linhasRanking = destacarVoce(ranking, euId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Comissão</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {podeGerenciar
              ? 'Vendas, recebimentos e comissão da equipe. A comissão é liberada quando o cliente paga.'
              : 'Suas vendas originadas e sua comissão no mês. A comissão é liberada quando o cliente paga.'}
          </p>
        </div>
        {podeGerenciar && (
          <button
            onClick={() => setNovaVenda(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Registrar venda
          </button>
        )}
      </div>

      {erro && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erro}{' '}
          <button onClick={carregar} className="font-medium underline">Tentar de novo</button>
        </div>
      )}

      {carregando && <div className="flex justify-center py-12"><Spinner /></div>}

      {/* ── A missão (Operação Comercial, Etapa 2) ───────────────────────────────────
          Carrega sozinha, de propósito: uma falha no desafio não pode derrubar o painel de
          comissão, que é o dado que a pessoa vem conferir. */}
      {!carregando && empresaId && <SecaoMissao empresaId={empresaId} />}

      {!carregando && painel && (
        <>
          {/* ── O nível ──────────────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{resumo.titulo}</h2>
              <span className="text-xs text-slate-400">{rotuloCompetencia(painel.competencia)}</span>
            </div>
            {resumo.detalhe && <p className="mt-1 text-sm text-slate-600">{resumo.detalhe}</p>}

            {resumo.progresso && (
              <div className="mt-4" role="img" aria-label={`${resumo.titulo}. ${resumo.detalhe}`}>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${resumo.progresso.percentual}%` }} />
                </div>
              </div>
            )}

            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <Metrica rotulo="Originado no mês" valor={formatarDinheiro(painel.originado)} ajuda="Faturamento pago de vendas que você originou." />
              <Metrica rotulo="Comissão do mês" valor={formatarDinheiro(painel.comissao)} ajuda="Já liberada pelo pagamento do cliente." />
              <Metrica rotulo="Comissão já paga" valor={formatarDinheiro(painel.comissao_paga)} ajuda="Repassada a você." />
            </dl>

            {/* O plano fica VISÍVEL para o SDR: um programa de comissão que a pessoa não
                consegue conferir é uma promessa sem prova. */}
            {painel.plano && (
              <details className="mt-5 border-t border-slate-100 pt-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  Como a comissão é calculada ({painel.plano.nome}, versão {painel.plano.versao})
                </summary>
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  {(painel.plano.faixas || []).map((f, i) => (
                    <li key={i} className="flex justify-between gap-4 border-b border-slate-50 pb-1">
                      <span>
                        {formatarDinheiro(f.min)}{f.max === null ? ' ou mais' : ` até ${formatarDinheiro(f.max)}`}
                      </span>
                      <strong className="text-slate-800">{formatarPercentual(f.percentual)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  A faixa alcançada vale para as próximas vendas do mês — vendas já creditadas
                  mantêm o percentual com que entraram.
                </p>
              </details>
            )}
          </section>

          {/* ── Ranking ──────────────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Ranking do mês</h2>
            <p className="mt-1 text-sm text-slate-500">
              Por faturamento pago originado — não por número de reuniões.
            </p>
            {linhasRanking.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">Nenhuma venda creditada neste mês ainda.</p>
            ) : (
              <ol className="mt-4 space-y-2">
                {linhasRanking.map((l) => (
                  <li
                    key={l.usuario_id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                      l.voce ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-center text-slate-400">{medalhaDaPosicao(l.posicao) || l.posicao}</span>
                      <span className="font-medium text-slate-800">{l.nome || 'Sem nome'}</span>
                      {l.voce && <span className="text-xs text-emerald-700">você</span>}
                    </span>
                    <span className="text-slate-700">
                      {formatarDinheiro(l.originado)}
                      <span className="ml-2 text-xs text-slate-400">{l.vendas} venda{l.vendas === 1 ? '' : 's'}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ── Vendas ───────────────────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Vendas do mês</h2>
              {/* O recorte é DECLARADO: recortar em silêncio faria o SDR achar que sumiu venda. */}
              <span className="text-xs text-slate-400">
                {podeGerenciar ? 'Vendas creditadas no mês' : 'Mostrando apenas as vendas que você originou'}
              </span>
            </div>

            {(painel.vendas || []).length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                Nenhuma venda creditada neste mês. A comissão entra quando o cliente paga.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                      <th className="py-2 pr-3 font-medium">Venda</th>
                      <th className="py-2 pr-3 font-medium">Valor</th>
                      <th className="py-2 pr-3 font-medium">Recebido</th>
                      <th className="py-2 pr-3 font-medium">Comissão</th>
                      <th className="py-2 pr-3 font-medium">Situação</th>
                      {podeGerenciar && <th className="py-2 font-medium">Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(painel.vendas || []).map((v) => {
                      const selo = rotuloStatus(v.status)
                      return (
                        <tr key={v.id} className="border-b border-slate-50 align-top">
                          <td className="py-3 pr-3">
                            <div className="font-medium text-slate-800">{v.descricao || 'Venda sem descrição'}</div>
                            <div className="text-xs text-slate-400">
                              {v.originador_nome || ORIGEM_ORIGINADOR[v.originador_origem] || '—'}
                            </div>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{formatarDinheiro(v.valor, v.moeda)}</td>
                          <td className="py-3 pr-3 text-slate-700">{formatarDinheiro(v.total_pago, v.moeda)}</td>
                          <td className="py-3 pr-3 text-slate-700">
                            {/* Sem crédito, "—" e nunca "R$ 0,00": ainda-não não é zero. */}
                            {formatarDinheiro(v.comissao_valor, v.moeda)}
                            {v.comissao_percentual != null && (
                              <span className="ml-1 text-xs text-slate-400">({formatarPercentual(v.comissao_percentual)})</span>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${TOM_SELO[selo.tom] || TOM_SELO.neutro}`}>
                              {selo.rotulo}
                            </span>
                            <div className="mt-1 max-w-[16rem] text-xs text-slate-400">{selo.ajuda}</div>
                          </td>
                          {podeGerenciar && (
                            <td className="py-3">
                              <div className="flex flex-col items-start gap-1">
                                {acoesDaVenda(v, podeGerenciar).map((a) => (
                                  <button
                                    key={a.id}
                                    onClick={() => setModal({ tipo: a.id, venda: v })}
                                    className={`text-xs hover:underline ${
                                      a.tom === 'negativo' ? 'text-red-600' : a.tom === 'primario' ? 'text-emerald-700' : 'text-slate-500'
                                    }`}
                                  >
                                    {a.rotulo}
                                  </button>
                                ))}
                                {motivoNaoCancelavel(v) && v.status !== 'cancelada' && (
                                  <span className="max-w-[14rem] text-[11px] text-slate-400">{motivoNaoCancelavel(v)}</span>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {novaVenda && (
        <ModalVenda
          empresaId={empresaId}
          onFechar={() => setNovaVenda(false)}
          onSalvo={() => { setNovaVenda(false); carregar() }}
        />
      )}
      {modal && (
        <ModalAcao
          empresaId={empresaId}
          tipo={modal.tipo}
          venda={modal.venda}
          onFechar={() => setModal(null)}
          onSalvo={() => { setModal(null); carregar() }}
        />
      )}
    </div>
  )
}

function Metrica({ rotulo, valor, ajuda }: { rotulo: string; valor: string; ajuda: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="mt-1 text-xl font-semibold text-slate-900">{valor}</dd>
      {/* Cada métrica declara o que mede — as três não se somam, pelo mesmo motivo do
          `oQueMede` obrigatório da BolinhaPontuacao. */}
      <dd className="mt-0.5 text-xs text-slate-400">{ajuda}</dd>
    </div>
  )
}

// ─── Registro de venda ────────────────────────────────────────────────────────────────

function ModalVenda({ empresaId, onFechar, onSalvo }: { empresaId: string; onFechar: () => void; onSalvo: () => void }) {
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [telefone, setTelefone] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/comissao/vendas`, {
        method: 'POST',
        body: JSON.stringify({ valor: Number(valor), descricao, telefone }),
      })
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a venda.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo="Registrar venda" onFechar={onFechar}>
      <Campo rotulo="Valor da venda (R$)">
        <input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <Campo rotulo="Descrição">
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Site institucional + SEO" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <Campo rotulo="Telefone do cliente (opcional)">
        <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      {/* O originador NÃO é um campo: ele vem do histórico do lead. Deixar digitar aqui
          abriria a porta para creditar venda a quem não originou. */}
      <p className="text-xs text-slate-500">
        O responsável pela comissão é resolvido pelo histórico do lead. A comissão só é liberada
        quando o primeiro pagamento do cliente for registrado.
      </p>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Rodape onFechar={onFechar} onConfirmar={salvar} salvando={salvando} desabilitado={!(Number(valor) > 0)} rotulo="Registrar venda" />
    </Modal>
  )
}

// ─── Recebimento, baixa e cancelamento ────────────────────────────────────────────────

function ModalAcao({ empresaId, tipo, venda, onFechar, onSalvo }: {
  empresaId: string; tipo: string; venda: VendaResumo; onFechar: () => void; onSalvo: () => void
}) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [valor, setValor] = useState(String(venda.valor ?? ''))
  const [recebidoEm, setRecebidoEm] = useState(hoje)
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const titulo = tipo === 'pagamento' ? 'Registrar recebimento'
    : tipo === 'pagar' ? 'Marcar comissão como paga'
      : 'Cancelar venda'

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      if (tipo === 'pagamento') {
        await apiFetch(`/api/empresas/${empresaId}/comissao/vendas/${venda.id}/pagamentos`, {
          method: 'POST',
          body: JSON.stringify({ valor: Number(valor), recebido_em: recebidoEm, referencia }),
        })
      } else if (tipo === 'pagar') {
        await apiFetch(`/api/empresas/${empresaId}/comissao/vendas/${venda.id}/comissao/pagar`, {
          method: 'POST', body: JSON.stringify({ referencia }),
        })
      } else {
        await apiFetch(`/api/empresas/${empresaId}/comissao/vendas/${venda.id}/cancelar`, {
          method: 'POST', body: JSON.stringify({ motivo }),
        })
      }
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={titulo} onFechar={onFechar}>
      {tipo === 'pagamento' && (
        <>
          <Campo rotulo="Valor recebido (R$)">
            <input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Campo>
          <Campo rotulo="Data do recebimento">
            <input type="date" value={recebidoEm} onChange={(e) => setRecebidoEm(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Campo>
          <Campo rotulo="Referência do pagamento (opcional)">
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: id do Pix" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Campo>
          <p className="text-xs text-slate-500">
            Informar a referência impede que o mesmo recebimento seja lançado duas vezes.
            {Number(venda.total_pago) <= 0 && ' Este é o primeiro pagamento: ele libera a comissão integral da venda.'}
          </p>
        </>
      )}
      {tipo === 'pagar' && (
        <>
          <Campo rotulo="Referência do repasse (opcional)">
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Campo>
          <p className="text-sm text-slate-600">
            Confirma o repasse de {formatarDinheiro(venda.comissao_valor, venda.moeda)} a{' '}
            {venda.originador_nome || 'responsável não identificado'}.
          </p>
        </>
      )}
      {tipo === 'cancelar' && (
        <>
          <Campo rotulo="Motivo do cancelamento">
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </Campo>
          <p className="text-xs text-slate-500">
            Só é possível cancelar antes de qualquer pagamento. Depois do crédito, a comissão é um
            fato registrado.
          </p>
        </>
      )}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <Rodape onFechar={onFechar} onConfirmar={salvar} salvando={salvando} desabilitado={tipo === 'pagamento' && !(Number(valor) > 0)} rotulo={titulo} />
    </Modal>
  )
}

// ─── Peças de UI ──────────────────────────────────────────────────────────────────────

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-900">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{rotulo}</span>
      {children}
    </label>
  )
}

function Rodape({ onFechar, onConfirmar, salvando, desabilitado, rotulo }: {
  onFechar: () => void; onConfirmar: () => void; salvando: boolean; desabilitado?: boolean; rotulo: string
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
      <button
        onClick={onConfirmar}
        disabled={salvando || desabilitado}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
      >
        {salvando ? 'Salvando…' : rotulo}
      </button>
    </div>
  )
}

// ─── Missão: o desafio com recompensa (Operação Comercial, Etapa 2) ───────────────────
//
// O QUE ESTA SEÇÃO DELIBERADAMENTE NÃO É:
// • **Não é placar.** Cada pessoa vê o PRÓPRIO progresso. Quem gerencia vê quem já ALCANÇOU —
//   fato consumado, sem o qual não há como pagar o prêmio —, nunca o progresso parcial alheio.
//   A ordem da lista vem do servidor (alfabética) e não é reordenada aqui.
// • **Não calcula nada.** Situação, fração e "alcançou" chegam prontos do backend; a tradução
//   vive em `lib/missao.js`.
// • **Não edita missão.** Publicada, ela é imutável — para mudar, encerra e publica outra.

type RespostaMissao = {
  missao: Missao | null
  situacao?: string
  meu_progresso?: ProgressoMissao
  alcancaram?: QuemAlcancou[] | null
}

type EquipeMissao = { id: string; nome: string; nicho_nome?: string | null; status?: string }
// O recorte que o SERVIDOR resolveu (meta.equipe). A tela declara qual equipe esta vendo em vez
// de deixar o operador supor — mesma disciplina do recorte declarado nas outras centrais.
type EquipeRecorte = { equipe_id: string; equipe_nome: string; nicho_nome?: string | null }
type MetaMissao = { pode_gerenciar: boolean; equipe?: EquipeRecorte | null }

function SecaoMissao({ empresaId }: { empresaId: string }) {
  const [dados, setDados] = useState<RespostaMissao | null>(null)
  const [podeGerenciar, setPodeGerenciar] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [publicando, setPublicando] = useState(false)
  const [encerrando, setEncerrando] = useState(false)
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false)
  const [entregar, setEntregar] = useState<{ usuario_id: string; nome: string } | null>(null)
  const [equipes, setEquipes] = useState<EquipeMissao[]>([])
  const [equipeId, setEquipeId] = useState('')
  const [recorte, setRecorte] = useState<EquipeRecorte | null>(null)

  const carregar = useCallback(() => {
    setCarregando(true)
    setErro('')
    const query = equipeId ? `?equipe_id=${encodeURIComponent(equipeId)}` : ''
    apiFetch<RespostaMissao, MetaMissao>(`/api/empresas/${empresaId}/missoes${query}`)
      .then((r) => {
        setDados(r.data)
        setPodeGerenciar(Boolean(r.meta?.pode_gerenciar))
        setRecorte(r.meta?.equipe || null)
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar a missão.'))
      .finally(() => setCarregando(false))
  }, [empresaId, equipeId])

  // So' quem gerencia escolhe a equipe — buscar a lista para todo mundo geraria um 403 a cada
  // carregamento de pagina, do mesmo jeito que as sugestoes de contexto evitam em Instancias.
  const carregarEquipes = useCallback(() => {
    if (!podeGerenciar) return
    apiFetch<EquipeMissao[]>(`/api/empresas/${empresaId}/equipes-comerciais`)
      .then((r) => setEquipes((r.data || []).filter((e) => e.status !== 'encerrada')))
      .catch(() => setEquipes([]))
  }, [empresaId, podeGerenciar])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { carregarEquipes() }, [carregarEquipes])

  async function encerrar() {
    if (!dados?.missao) return
    setEncerrando(true)
    try {
      await apiFetch(`/api/empresas/${empresaId}/missoes/${dados.missao.id}/encerrar`, { method: 'POST' })
      setConfirmarEncerrar(false)
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível encerrar a missão.')
    } finally { setEncerrando(false) }
  }

  if (carregando) return null

  if (erro) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {erro} <button onClick={carregar} className="font-medium underline">Tentar de novo</button>
      </section>
    )
  }

  // Sem missão publicada: quem não gerencia não vê caixa vazia nenhuma — ausência de desafio é
  // estado legítimo, e um card dizendo "nada aqui" só ocupa a tela de quem veio ver o dinheiro.
  if (!dados?.missao) {
    if (!podeGerenciar) return null
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Nenhuma missão publicada</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Uma missão é um desafio com recompensa, válido para a equipe por um período. O progresso
          é medido pelo faturamento pago que cada pessoa originou.
        </p>
        {equipes.length > 0 && (
          <label className="mt-4 block max-w-md">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Equipe</span>
            <select
              value={equipeId}
              onChange={(e) => setEquipeId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            >
              <option value="">
                {recorte ? `${recorte.equipe_nome} (sua equipe)` : 'Missão geral da empresa'}
              </option>
              {equipes.filter((e) => e.id !== recorte?.equipe_id).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}{e.nicho_nome ? ` · ${e.nicho_nome}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() => setPublicando(true)}
          disabled={equipes.length === 0}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Publicar missão
        </button>
        {equipes.length === 0 && (
          <p className="mt-2 text-xs text-ink-3">
            Crie uma equipe comercial antes de publicar missão. A missão nova sempre pertence a uma equipe.
          </p>
        )}
        {publicando && (
          <ModalMissao
            empresaId={empresaId}
            equipes={equipes}
            equipeIdInicial={equipeId}
            onFechar={() => setPublicando(false)}
            onSalvo={() => { setPublicando(false); carregar() }}
          />
        )}
      </section>
    )
  }

  const missao = dados.missao
  const situacao = rotuloSituacao(dados.situacao)
  const meu = resumoDoProgresso(dados.meu_progresso, dados.situacao)
  const alcancaram = resumoDeQuemAlcancou(dados.alcancaram)
  const minhaEntrega = minhaRecompensa(dados.meu_progresso)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{missao.titulo}</h2>
            {/* Cor nunca é o único sinal: o selo carrega a palavra. */}
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${TOM_SELO[situacao.tom] || TOM_SELO.neutro}`}>
              {situacao.rotulo}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{situacao.explicacao}</p>
          {missao.descricao && <p className="mt-2 text-sm text-slate-600">{missao.descricao}</p>}
          {missao.equipe_nome && (
            <p className="mt-2 inline-block rounded-lg border border-line bg-surface-3 px-2 py-1 text-xs text-ink-2">
              Missão da equipe {missao.equipe_nome}{missao.nicho_nome ? ` · nicho ${missao.nicho_nome}` : ''}
            </p>
          )}
        </div>
        {podeGerenciar && (
          <div className="flex flex-wrap items-center gap-2">
            {equipes.length > 1 && (
              <select
                value={equipeId}
                onChange={(e) => setEquipeId(e.target.value)}
                className="rounded-lg border border-line px-3 py-2 text-sm"
                aria-label="Escolher equipe da missão"
              >
                <option value="">
                  {missao.equipe_nome
                    ? `${missao.equipe_nome} (atual)`
                    : recorte
                      ? `${recorte.equipe_nome} (sua equipe)`
                      : 'Missão geral da empresa'}
                </option>
                {equipes.filter((e) => e.id !== missao.equipe_id).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}{e.nicho_nome ? ` · ${e.nicho_nome}` : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => setConfirmarEncerrar(true)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Encerrar missão
            </button>
          </div>
        )}
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <Metrica rotulo="Alvo" valor={formatarDinheiro(missao.alvo_valor)} ajuda="Faturamento pago que você precisa originar." />
        <Metrica rotulo="Período" valor={janelaTexto(missao)} ajuda="A missão conta o que foi pago dentro desta janela." />
        <Metrica rotulo="Recompensa" valor={recompensaTexto(missao)} ajuda="Combinada pela empresa. O pagamento acontece fora do sistema." />
      </dl>

      {/* ── O MEU progresso ─────────────────────────────────────────────────────── */}
      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Seu progresso</span>
          <span className={`text-lg font-semibold ${meu.alcancado ? 'text-emerald-700' : 'text-slate-900'}`}>
            {meu.titulo}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all ${meu.alcancado ? 'bg-emerald-500' : 'bg-slate-700'}`}
            style={{ width: meu.larguraBarra }}
          />
        </div>
        <p className={`mt-2 text-sm ${meu.alcancado ? 'text-emerald-700' : 'text-slate-600'}`}>{meu.frase}</p>
        {/* O beneficiário precisa VER que o prêmio dele foi registrado: programa de recompensa
            que a pessoa não consegue conferir é promessa sem prova. Some para quem ainda não
            alcançou — prometer entrega a quem não bateu o alvo seria pior que calar. */}
        {minhaEntrega && (
          <p className={`mt-1 text-xs ${minhaEntrega.pago ? 'text-emerald-700' : 'text-amber-700'}`}>
            {minhaEntrega.frase}
          </p>
        )}
      </div>

      {/* ── Quem já alcançou: só para quem paga o prêmio ─────────────────────────── */}
      {alcancaram && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Quem alcançou o alvo</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {alcancaram.frase} Esta lista existe para você saber a quem pagar a recompensa — o
            progresso de quem ainda não alcançou é pessoal e não aparece aqui.
          </p>
          {alcancaram.itens.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {alcancaram.itens.map((i) => (
                <li key={i.usuario_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-slate-700">{i.nome}</span>
                    {/* O estado da entrega em TEXTO, não só na presença do botão. */}
                    <span className={`ml-2 text-xs ${i.pago ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {i.rotuloPagamento}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium text-slate-900">{i.valor}</span>
                    {/* Registrar a entrega NÃO tem desfazer (o registro é append-only), por isso
                        passa por confirmação em vez de sair no primeiro clique. */}
                    {!i.pago && (
                      <button
                        type="button"
                        onClick={() => setEntregar({ usuario_id: i.usuario_id, nome: i.nome })}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        Registrar entrega
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entregar && (
        <ModalEntregaRecompensa
          empresaId={empresaId}
          missaoId={missao.id}
          pessoa={entregar}
          onFechar={() => setEntregar(null)}
          onSalvo={() => { setEntregar(null); carregar() }}
        />
      )}

      {confirmarEncerrar && (
        <ModalConfirmar
          titulo="Encerrar esta missão?"
          corpo="A missão sai do ar para toda a equipe e vira histórico. Quem já alcançou o alvo continua registrado — a conquista é calculada a partir das vendas pagas, então nada se perde."
          aviso="Não dá para reabrir uma missão encerrada. Para mudar o alvo ou a recompensa, publique uma nova."
          rotuloConfirmar="Encerrar missão"
          tom="perigo"
          ocupado={encerrando}
          onConfirmar={encerrar}
          onCancelar={() => setConfirmarEncerrar(false)}
        />
      )}
    </section>
  )
}

function ModalMissao({ empresaId, equipes, equipeIdInicial, onFechar, onSalvo }: {
  empresaId: string
  equipes: EquipeMissao[]
  equipeIdInicial: string
  onFechar: () => void
  onSalvo: () => void
}) {
  const [equipeId, setEquipeId] = useState(equipeIdInicial || equipes[0]?.id || '')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [alvo, setAlvo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [recompensa, setRecompensa] = useState('')
  const [recompensaValor, setRecompensaValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/missoes`, {
        method: 'POST',
        body: JSON.stringify({
          titulo,
          equipe_id: equipeId,
          descricao: descricao || null,
          alvo_valor: alvo,
          inicio,
          fim,
          recompensa_descricao: recompensa,
          recompensa_valor: recompensaValor || null,
        }),
      })
      onSalvo()
    } catch (e) {
      // A mensagem vem do backend, que é quem tem a régua — validar de novo aqui criaria uma
      // segunda régua, mais frouxa.
      setErro(e instanceof Error ? e.message : 'Não foi possível publicar a missão.')
      setSalvando(false)
    }
  }

  return (
    <Modal titulo="Publicar missão" onFechar={onFechar}>
      <p className="text-sm text-slate-600">
        A missão vale para uma equipe comercial e mede o <strong>faturamento pago</strong> que cada
        pessoa daquela equipe originou no período. Depois de publicada ela não pode ser editada —
        para mudar, encerre e publique outra.
      </p>
      <Campo rotulo="Equipe">
        <select
          value={equipeId}
          onChange={(e) => setEquipeId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {equipes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}{e.nicho_nome ? ` · ${e.nicho_nome}` : ''}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Título">
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Desafio de setembro"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <Campo rotulo="Descrição (opcional)">
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <Campo rotulo="Alvo (faturamento pago originado, R$)">
        <input value={alvo} onChange={(e) => setAlvo(e.target.value)} inputMode="decimal" placeholder="20000"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Início">
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </Campo>
        <Campo rotulo="Fim">
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </Campo>
      </div>
      <Campo rotulo="Recompensa">
        <input value={recompensa} onChange={(e) => setRecompensa(e.target.value)} placeholder="Bônus para quem bater o alvo"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <Campo rotulo="Valor da recompensa em R$ (opcional)">
        <input value={recompensaValor} onChange={(e) => setRecompensaValor(e.target.value)} inputMode="decimal" placeholder="1000"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </Campo>
      <p className="text-xs text-slate-500">
        O sistema mede o progresso e mostra quem alcançou. O pagamento da recompensa acontece fora
        dele.
      </p>
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      <Rodape onFechar={onFechar} onConfirmar={salvar} salvando={salvando} desabilitado={!equipeId} rotulo="Publicar missão" />
    </Modal>
  )
}

// ─── A baixa da recompensa (Operação Comercial, Etapa 4) ──────────────────────────────
//
// ⚠️ REGISTRAR A ENTREGA NÃO TEM DESFAZER: o registro é append-only, como o ledger de
// recebimentos da comissão. Dizer "paguei" é um fato sobre dinheiro que saiu, e um UPDATE
// apagaria a única prova de que o prêmio foi entregue. Por isso o modal AVISA antes, em vez de
// deixar a ação sair no primeiro clique.
//
// O valor é OPCIONAL de propósito: nem todo prêmio é dinheiro. Quando vem, pode divergir do
// declarado na missão (arredondamento, entrega parcial) — a divergência fica auditável na linha,
// e a tela não a esconde nem a impede. Quem valida é o backend; validar de novo aqui criaria uma
// segunda régua, mais frouxa.

function ModalEntregaRecompensa({ empresaId, missaoId, pessoa, onFechar, onSalvo }: {
  empresaId: string
  missaoId: string
  pessoa: { usuario_id: string; nome: string }
  onFechar: () => void
  onSalvo: () => void
}) {
  const [valor, setValor] = useState('')
  const [referencia, setReferencia] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/missoes/${missaoId}/recompensas`, {
        method: 'POST',
        body: JSON.stringify({
          usuario_id: pessoa.usuario_id,
          valor_pago: valor || null,
          referencia: referencia || null,
          observacao: observacao || null,
        }),
      })
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a entrega.')
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={`Registrar entrega — ${pessoa.nome}`} onFechar={onFechar}>
      <p className="text-sm text-slate-600">
        Isto registra que o prêmio da missão <strong>saiu</strong> para {pessoa.nome}. O sistema
        não faz o pagamento: ele guarda o fato, com data e autor.
      </p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Não há como desfazer este registro depois. Confira a pessoa antes de confirmar.
      </p>
      <Campo rotulo="Valor pago em R$ (opcional)">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="Deixe vazio se o prêmio não for em dinheiro"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </Campo>
      <Campo rotulo="Referência do pagamento (opcional)">
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Id do Pix, transferência…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </Campo>
      <Campo rotulo="Observação (opcional)">
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </Campo>
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      <Rodape onFechar={onFechar} onConfirmar={salvar} salvando={salvando} rotulo="Registrar entrega" />
    </Modal>
  )
}
