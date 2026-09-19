'use client'
// Gerenciar membros da equipe — o modal da área de Equipe.
//
// ─── A DIFERENÇA ENTRE ESTA TELA E A REFERÊNCIA VISUAL, E POR QUÊ ───────────────────────
// A referência mostra caixas que se DESMARCAM para remover alguém da equipe. Este produto
// **ainda não sabe remover**: `db/equipes-comerciais.js` recusa com 409 `REMOCAO_EXIGE_DEVOLUCAO`
// porque os leads que a pessoa assumiu ficariam presos com quem saiu do recorte. Desenhar a
// remoção prometeria uma ação que o servidor recusa, e o gestor descobriria no erro.
//
// Então quem já é membro aparece **marcado e bloqueado, com o motivo em texto** — a regra do
// guia visual para controle que a pessoa não pode usar: se há decisão de produto a explicar,
// deixe visível e desabilitado com o motivo; se não há, não renderize.
//
// ─── O QUE ESTE COMPONENTE NÃO SABE ─────────────────────────────────────────────────────
// Nenhuma regra. Situação, contagem, filtro, texto do rodapé e o corpo do PUT vêm de
// `lib/equipe-area.js` (puro e testado) — mesmo contrato de `BolinhaPontuacao`.
import { useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import EstadoVazio from '@/components/ui/EstadoVazio'
import {
  FILTROS_MODAL,
  MOTIVO_REMOCAO_BLOQUEADA,
  contagensDoModal,
  corpoDeParticipantes,
  estadoDaEquipe,
  filtrarPessoasDoModal,
  resumoSelecaoModal,
  rotuloPapel,
  situacaoNoModal,
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
  const [novos, setNovos] = useState<string[]>([])

  const equipeId = equipe ? String(equipe.id) : null
  const contagens = useMemo(() => contagensDoModal(pessoas, equipeId), [pessoas, equipeId])
  const visiveis = useMemo(
    () => filtrarPessoasDoModal(pessoas, { busca, filtro, equipeId }),
    [pessoas, busca, filtro, equipeId],
  )
  const selecao = resumoSelecaoModal(novos)

  function alternar(id: string) {
    setNovos((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function fechar() {
    setBusca('')
    setFiltro('todos')
    setNovos([])
    onFechar()
  }

  async function salvar() {
    await onSalvar(corpoDeParticipantes(pessoas, equipeId, novos))
    setNovos([])
  }

  if (!equipe) return null
  const estado = estadoDaEquipe(equipe)

  return (
    <FolhaModal
      aberto={aberto}
      titulo="Gerenciar membros da equipe"
      descricao="Adicione pessoas à equipe sem sair da página. As alterações valem assim que você salvar."
      tamanho="lg"
      onFechar={fechar}
      rodape={
        <>
          {/* O rodapé conta ADIÇÕES, não marcados: dizer "4 selecionadas" quando 4 já eram
              membros faria o botão prometer uma mudança que não vai acontecer. */}
          <span className="mr-auto text-xs text-ink-3">{selecao.texto}</span>
          <Botao variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao
            variante="primaria"
            onClick={salvar}
            carregando={ocupado}
            disabled={!selecao.podeSalvar}
            motivoDesabilitado={selecao.motivo}
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

      {/* ── Por que não dá para retirar ninguém. Dito UMA vez, no topo, em vez de repetido
             em cada linha bloqueada. ───────────────────────────────────────────────────── */}
      <p className="mt-3 rounded-lg border border-estado-warn/30 bg-estado-warn/10 px-3 py-2 text-xs text-ink-2">
        <span className="font-medium text-ink">Só dá para adicionar.</span> {MOTIVO_REMOCAO_BLOQUEADA}
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
                const marcado = st.marcado || novos.includes(id)
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
                          st.selecionavel
                            ? `Adicionar ${p.nome || 'pessoa'} à equipe`
                            : `${p.nome || 'Pessoa'} — ${st.rotulo}. ${st.motivo}`
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
                          não dá. O motivo genérico de remoção já está no topo. */}
                      {st.situacao === 'outra_equipe' && (
                        <span className="mt-0.5 block max-w-[22rem] text-[11px] leading-snug text-ink-3">{st.motivo}</span>
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
  )
}
