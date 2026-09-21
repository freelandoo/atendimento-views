'use client'
// Gerenciar membros da equipe — o modal da área de Equipe.
//
// ─── O QUE MUDOU (2026-09-21) ────────────────────────────────────────────────────────────
// Até então este produto não sabia REMOVER: `db/equipes-comerciais.js` recusava com 409
// `REMOCAO_EXIGE_DEVOLUCAO` porque os leads que a pessoa assumiu ficariam presos com quem saiu
// do recorte. Agora a saída FECHA o vínculo e devolve, na mesma transação, TODOS os leads da
// pessoa naquele nicho para a fila de livres — decisão do operador: sem filtrar por "protegido",
// inclusive lead com reunião marcada ou conversa aberta.
//
// Por isso desmarcar quem já é membro agora REMOVE de verdade. Duas coisas garantem que ninguém
// seja pego de surpresa: (1) o aviso da consequência fica visível no topo o tempo todo, não só
// no clique; (2) salvar com alguém saindo passa por uma CONFIRMAÇÃO nomeando quem sai, antes de
// qualquer requisição.
//
// ─── O QUE ESTE COMPONENTE NÃO SABE ─────────────────────────────────────────────────────
// Nenhuma regra. Situação, contagem, filtro, diff (quem entra/quem sai), texto do rodapé, texto
// de confirmação e o corpo do PUT vêm de `lib/equipe-area.js` (puro e testado) — mesmo contrato
// de `BolinhaPontuacao`.
import { useEffect, useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import Botao from '@/components/ui/Botao'
import EstadoVazio from '@/components/ui/EstadoVazio'
import {
  AVISO_DEVOLUCAO_LEADS,
  FILTROS_MODAL,
  contagensDoModal,
  corpoDeParticipantes,
  diffParticipantes,
  estadoDaEquipe,
  filtrarPessoasDoModal,
  participantesIniciais,
  resumoSelecaoModal,
  rotuloPapel,
  situacaoNoModal,
  textoConfirmarRemocao,
} from '@/lib/equipe-area'
import type { EquipeArea, PessoaArea } from '@/lib/equipe-area'

// Tom do selo de situação. Cor é REFORÇO: o rótulo em texto vem sempre junto.
const TOM_SELO: Record<string, string> = {
  ok: 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok',
  alerta: 'border-estado-warn/30 bg-estado-warn/10 text-estado-warn',
  neutro: 'border-line bg-surface-3 text-ink-3',
}

/** Iniciais para o avatar. Decorativo — o nome está sempre ao lado, em texto. */
function iniciais(nome?: string | null) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export default function ModalGerenciarMembros({
  aberto,
  equipe,
  pessoas,
  ocupado = false,
  onFechar,
  onSalvar,
}: {
  aberto: boolean
  equipe: EquipeArea | null
  /** Todo mundo da empresa, já com e-mail (de `/equipe`) e equipe atual (de `/elegiveis`). */
  pessoas: PessoaArea[]
  ocupado?: boolean
  onFechar: () => void
  /** Recebe a lista COMPLETA de participantes — o PUT do backend é substituição. */
  onSalvar: (usuarioIds: string[]) => Promise<void> | void
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  // A seleção passou a ser o conjunto INTEIRO de quem deve ficar na equipe — não só as adições.
  // Marcar/desmarcar é o MESMO gesto para entrar e para sair; o diff contra o estado atual é que
  // diz qual é qual.
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)

  const equipeId = equipe ? String(equipe.id) : null

  // Semeia a seleção com quem já está na equipe sempre que o modal ABRE para uma equipe — nunca
  // a cada render, senão uma marcação em andamento seria apagada por uma atualização da lista.
  useEffect(() => {
    if (aberto && equipeId) setSelecionados(participantesIniciais(pessoas, equipeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, equipeId])

  const contagens = useMemo(() => contagensDoModal(pessoas, equipeId), [pessoas, equipeId])
  const visiveis = useMemo(
    () => filtrarPessoasDoModal(pessoas, { busca, filtro, equipeId }),
    [pessoas, busca, filtro, equipeId],
  )
  const diff = useMemo(
    () => diffParticipantes(pessoas, equipeId, selecionados),
    [pessoas, equipeId, selecionados],
  )
  const resumo = resumoSelecaoModal(diff)

  function alternar(id: string) {
    setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function fechar() {
    setBusca('')
    setFiltro('todos')
    setSelecionados([])
    setConfirmandoSaida(false)
    onFechar()
  }

  // Só pede confirmação quando ALGUÉM sai — adicionar sozinho não tem essa consequência.
  function pedirSalvar() {
    if (diff.remover.length) { setConfirmandoSaida(true); return }
    salvar()
  }

  async function salvar() {
    setConfirmandoSaida(false)
    await onSalvar(corpoDeParticipantes(selecionados))
    setSelecionados([])
  }

  if (!equipe) return null
  const estado = estadoDaEquipe(equipe)

  return (
    <>
      <FolhaModal
        aberto={aberto}
        titulo="Gerenciar membros da equipe"
        descricao="Marque para adicionar, desmarque para retirar. As alterações valem assim que você salvar."
        tamanho="lg"
        onFechar={fechar}
        rodape={
          <>
            {/* O rodapé conta ENTRADAS e SAÍDAS separadamente — são consequências diferentes. */}
            <span className="mr-auto text-xs text-ink-3">{resumo.texto}</span>
            <Botao variante="secundaria" onClick={fechar}>Cancelar</Botao>
            <Botao
              variante="primaria"
              onClick={pedirSalvar}
              carregando={ocupado}
              disabled={!resumo.podeSalvar}
              motivoDesabilitado={resumo.motivo}
            >
              Salvar alterações
            </Botao>
          </>
        }
      >
        {/* ── Resumo da equipe: para quem abriu por engano saber em qual está mexendo ────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{equipe.nome}</p>
            <p className="mt-0.5 truncate text-xs text-ink-3">
              Nicho: <span className="font-medium text-ink-2">{equipe.nicho_nome || 'sem nome'}</span>
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${TOM_SELO[estado.tom === 'ativo' ? 'ok' : 'neutro']}`}>
            Equipe {estado.rotulo.toLowerCase()}
          </span>
        </div>

        {/* ── A consequência de desmarcar, dita UMA vez no topo, em vez de só no clique. ──── */}
        <p className="mt-3 rounded-lg border border-estado-warn/30 bg-estado-warn/10 px-3 py-2 text-xs text-ink-2">
          <span className="font-medium text-ink">Desmarcar remove.</span> {AVISO_DEVOLUCAO_LEADS}
        </p>

        {/* ── Busca ─────────────────────────────────────────────────────────────────────── */}
        <label className="mt-4 block">
          <span className="sr-only">Buscar pessoa por nome ou e-mail</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pessoa por nome ou e-mail…"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>

        {/* ── Filtros: a contagem vai no próprio botão ──────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-3">Mostrar:</span>
          {FILTROS_MODAL.map((f) => {
            const n = (contagens as unknown as Record<string, number>)[f.id] ?? 0
            const ativo = filtro === f.id
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => setFiltro(f.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  ativo
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3'
                }`}
              >
                {f.rotulo} ({n})
              </button>
            )
          })}
        </div>

        {/* ── A lista ───────────────────────────────────────────────────────────────────── */}
        <div className="mt-3 overflow-hidden rounded-lg border border-line">
          {visiveis.length === 0 ? (
            <EstadoVazio
              titulo={busca ? 'Ninguém com esse nome ou e-mail' : 'Nenhuma pessoa neste filtro'}
              descricao={
                busca
                  ? 'Confira a escrita ou limpe a busca para ver a lista inteira.'
                  : 'Pessoas são cadastradas em Configurações › Contas da empresa.'
              }
              acao={busca ? <Botao tamanho="sm" onClick={() => setBusca('')}>Limpar busca</Botao> : undefined}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 text-left">
                    <span className="sr-only">Selecionar</span>
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Pessoa</th>
                  <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">Cargo</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visiveis.map((p) => {
                  const st = situacaoNoModal(p, equipeId)
                  const id = String(p.usuario_id)
                  const marcado = selecionados.includes(id)
                  // Já era membro e foi DESMARCADO nesta sessão: vai sair ao salvar. É a única
                  // situação em que "nesta_equipe" e a seleção discordam.
                  const saiAoSalvar = st.situacao === 'nesta_equipe' && !marcado
                  return (
                    <tr key={id} className={st.selecionavel ? 'hover:bg-surface-2' : 'bg-surface-2/50'}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={marcado}
                          disabled={!st.selecionavel}
                          onChange={() => alternar(id)}
                          title={st.motivo || undefined}
                          aria-label={
                            !st.selecionavel
                              ? `${p.nome || 'Pessoa'} — ${st.rotulo}. ${st.motivo}`
                              : st.situacao === 'nesta_equipe'
                                ? `${p.nome || 'Pessoa'} já está na equipe. Desmarcar retira e devolve os leads dela para a fila.`
                                : `Adicionar ${p.nome || 'pessoa'} à equipe`
                          }
                          className="h-4 w-4 rounded border-line-strong text-brand focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-ink-2"
                          >
                            {iniciais(p.nome)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink">{p.nome || 'Sem nome'}</span>
                            {p.email && <span className="block truncate text-xs text-ink-3">{p.email}</span>}
                            {/* No celular a coluna Cargo some; o papel continua legível aqui. */}
                            <span className="block text-xs text-ink-3 sm:hidden">{rotuloPapel(p.papel)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-3 py-2 text-xs text-ink-2 sm:table-cell">{rotuloPapel(p.papel)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${TOM_SELO[st.tom]}`}>
                          {st.rotulo}
                        </span>
                        {/* O motivo do bloqueio fica na LINHA quando ele é específico daquela
                            pessoa ("já está no Time Solar") — é a informação que o 409 do backend
                            não dá. O aviso genérico de devolução já está no topo. */}
                        {st.situacao === 'outra_equipe' && (
                          <span className="mt-0.5 block max-w-[22rem] text-[11px] leading-snug text-ink-3">{st.motivo}</span>
                        )}
                        {saiAoSalvar && (
                          <span className="mt-0.5 block text-[11px] font-medium leading-snug text-red-600">
                            Sai ao salvar — leads dela voltam para a fila
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </FolhaModal>

      {/* Fora do FolhaModal, de propósito: dois overlays independentes, no padrão já usado em
          ConversaPainel.tsx para o mesmo tipo de confirmação. */}
      {confirmandoSaida && (
        <ModalConfirmar
          titulo="Confirmar saída de equipe"
          corpo={textoConfirmarRemocao(diff.remover)}
          rotuloConfirmar="Confirmar e salvar"
          tom="perigo"
          ocupado={ocupado}
          onConfirmar={salvar}
          onCancelar={() => setConfirmandoSaida(false)}
        />
      )}
    </>
  )
}
