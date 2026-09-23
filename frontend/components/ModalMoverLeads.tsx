'use client'
// "Mover leads" — o gestor passa leads de UMA pessoa para OUTRA, dentro da mesma equipe.
//
// ─── O QUE ESTA AÇÃO FAZ, E O QUE ELA SÓ FAZ SE PEDIREM (decisão do operador, 2026-09-23) ──
// Por padrão ela só move lead INTOCADO — a mesma regra do rebalanceamento automático. Lead com
// reunião marcada, conversa aberta ou follow-up continua com quem está cuidando dele.
//
// "Incluir os em andamento" AMPLIA o conjunto, e nunca o PREFERE: os intocados continuam saindo
// primeiro e os em andamento só entram quando eles acabam. É o que cobre férias e desligamento
// sem transformar o uso do dia a dia num jeito fácil de tirar negociação da mão de alguém. Quando
// algum lead em andamento vai sair, a ação passa por uma CONFIRMAÇÃO que nomeia os compromissos.
//
// ─── O QUE ESTE COMPONENTE NÃO SABE ─────────────────────────────────────────────────────
// Nenhuma regra. Quem pode ceder, quem pode receber, a prévia, o motivo de um botão desabilitado
// e o texto da confirmação vêm de `lib/equipe-carteira.js` (puro e testado). A validação de
// verdade — inclusive o teto por operação — é do backend (`services/lead-distribuicao.js`).
//
// ⚠️ A prévia é ESTIMATIVA: entre abrir e confirmar, alguém pode ter assumido ou devolvido um
// lead. O número REAL vem na resposta, e é ele que a tela anuncia depois.
import { useEffect, useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import {
  destinosDaTransferencia,
  origensDaTransferencia,
  previaTransferencia,
  validarTransferenciaTela,
} from '@/lib/equipe-area'
import type { LinhaCarteira } from '@/lib/equipe-area'

export type DadosTransferencia = {
  origem_id: string
  destino_id: string
  quantidade: number
  /** Só o booleano `true` inclui os em andamento — o backend recusa qualquer outra coisa. */
  incluir_protegidos: boolean
}

const QUANTIDADE_INICIAL = 10

export default function ModalMoverLeads({
  aberto,
  nomeNicho,
  membros,
  origemInicial,
  ocupado = false,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean
  nomeNicho: string
  /** Só membros ativos desta equipe — o backend recusa qualquer outro id. */
  membros: LinhaCarteira[]
  /** Quando o gestor abre a partir da linha de uma pessoa, ela já vem escolhida como origem. */
  origemInicial?: string | null
  ocupado?: boolean
  onFechar: () => void
  onConfirmar: (dados: DadosTransferencia) => Promise<void> | void
}) {
  const [origemId, setOrigemId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [quantidade, setQuantidade] = useState(String(QUANTIDADE_INICIAL))
  const [incluir, setIncluir] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  // Reabrir com o formulário anterior faria o gestor repetir, sem perceber, a última transferência.
  useEffect(() => {
    if (!aberto) return
    setOrigemId(origemInicial ? String(origemInicial) : '')
    setDestinoId('')
    setQuantidade(String(QUANTIDADE_INICIAL))
    setIncluir(false)
    setConfirmando(false)
  }, [aberto, origemInicial])

  const origens = useMemo(() => origensDaTransferencia(membros), [membros])
  const destinos = useMemo(() => destinosDaTransferencia(membros, origemId), [membros, origemId])
  const origem = useMemo(() => membros.find((m) => String(m.usuario_id) === origemId) || null, [membros, origemId])
  const destino = useMemo(() => membros.find((m) => String(m.usuario_id) === destinoId) || null, [membros, destinoId])

  const previa = useMemo(
    () => previaTransferencia({ origem, destinoNome: destino?.nome || null, quantidade, incluirProtegidos: incluir }),
    [origem, destino, quantidade, incluir]
  )
  const veredito = useMemo(
    () => validarTransferenciaTela({ origemId, destinoId, quantidade, maximo: previa.maximo, incluirProtegidos: incluir }),
    [origemId, destinoId, quantidade, previa.maximo, incluir]
  )

  // Trocar a origem pode deixar o destino igual a ela — limpa em vez de mandar um pedido inválido.
  useEffect(() => {
    if (destinoId && destinoId === origemId) setDestinoId('')
  }, [origemId, destinoId])

  const dados = (): DadosTransferencia => ({
    origem_id: origemId,
    destino_id: destinoId,
    quantidade: Math.trunc(Number(quantidade)) || 0,
    incluir_protegidos: incluir === true,
  })

  // Só pede confirmação quando algum lead EM ANDAMENTO vai sair — mover intocado não tem essa
  // consequência, e confirmar tudo treinaria o gestor a confirmar sem ler.
  function pedirMover() {
    if (!veredito.pode || ocupado) return
    if (previa.dosEmAndamento > 0) { setConfirmando(true); return }
    void onConfirmar(dados())
  }

  async function confirmarComAndamento() {
    setConfirmando(false)
    await onConfirmar(dados())
  }

  const nomeOrigem = origem?.nome || 'essa pessoa'
  const nomeDestino = destino?.nome || 'quem recebe'
  const rotuloBotao = previa.efetiva > 0
    ? `Mover ${previa.efetiva} ${previa.efetiva === 1 ? 'lead' : 'leads'}`
    : 'Mover leads'

  return (
    <>
      <FolhaModal
        aberto={aberto}
        titulo="Mover leads entre pessoas"
        descricao={`Passa leads de ${nomeNicho} de uma pessoa da equipe para outra.`}
        onFechar={onFechar}
        tamanho="md"
        rodape={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-ink-3">
              {veredito.pode
                ? `${nomeOrigem} → ${nomeDestino}. Estimativa: o número real aparece depois de mover.`
                : veredito.motivo}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Botao tamanho="sm" onClick={onFechar} disabled={ocupado}>Cancelar</Botao>
              <Botao
                tamanho="sm"
                variante="primaria"
                onClick={pedirMover}
                carregando={ocupado}
                disabled={!veredito.pode}
                motivoDesabilitado={veredito.motivo}
              >
                {rotuloBotao}
              </Botao>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {origens.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
              Ninguém desta equipe tem leads de {nomeNicho} para ceder agora. Para dar volume à
              equipe, use “Puxar mais leads”.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="De quem sai" obrigatorio>
                  <select value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
                    <option value="">Escolha a pessoa…</option>
                    {origens.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Para quem vai" obrigatorio>
                  <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} disabled={!origemId}>
                    <option value="">{origemId ? 'Escolha a pessoa…' : 'Escolha primeiro de quem sai'}</option>
                    {destinos.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
                  </select>
                </Campo>
              </div>

              {/* ── Quais leads podem sair ──────────────────────────────────────────────── */}
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-ink-2">Quais leads podem sair</legend>
                <div className="space-y-2">
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    !incluir ? 'border-brand bg-brand/5' : 'border-line hover:bg-surface-2'
                  }`}>
                    <input
                      type="radio"
                      name="incluir-em-andamento"
                      checked={!incluir}
                      onChange={() => setIncluir(false)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">Só os que ninguém tocou</span>
                      <span className="block text-xs text-ink-3">
                        {origem
                          ? `${previa.intocados} ${previa.intocados === 1 ? 'lead disponível' : 'leads disponíveis'}. Sem reunião, conversa, follow-up ou abordagem registrada.`
                          : 'Sem reunião, conversa, follow-up ou abordagem registrada.'}
                      </span>
                    </span>
                  </label>

                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    incluir ? 'border-estado-warn bg-estado-warn/5' : 'border-line hover:bg-surface-2'
                  }`}>
                    <input
                      type="radio"
                      name="incluir-em-andamento"
                      checked={incluir}
                      onChange={() => setIncluir(true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">Incluir também os em andamento</span>
                      <span className="block text-xs text-ink-3">
                        {origem
                          ? `+${previa.emAndamento} com trabalho começado. Os intocados saem primeiro; os em andamento só entram quando eles acabam.`
                          : 'Os intocados saem primeiro; os em andamento só entram quando eles acabam.'}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="flex flex-wrap items-end gap-3">
                <Campo etiqueta="Quantos leads" obrigatorio className="w-40">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                  />
                </Campo>
                {/* Atalho para férias e desligamento: mover tudo o que a escolha atual permite. */}
                {origem && previa.maximo > 0 && (
                  <Botao tamanho="sm" variante="neutra" onClick={() => setQuantidade(String(previa.maximo))}>
                    Mover todos ({previa.maximo})
                  </Botao>
                )}
              </div>

              {/* O risco vem ANTES do clique, em texto — cor nunca é o único sinal. */}
              {previa.aviso && (
                <p role="note" className="rounded-lg border border-estado-warn/30 bg-estado-warn/5 px-3 py-2 text-xs text-ink-2">
                  <span className="font-medium text-ink">Atenção:</span> {previa.aviso}
                </p>
              )}
            </>
          )}
        </div>
      </FolhaModal>

      {/* Irmão da folha, e não filho: um clique no fundo da confirmação não pode fechar a folha. */}
      {confirmando && (
        <ModalConfirmar
          titulo="Mover leads em andamento"
          corpo={`${previa.efetiva} ${previa.efetiva === 1 ? 'lead vai' : 'leads vão'} passar de ${nomeOrigem} para ${nomeDestino}, e ${previa.dosEmAndamento} ${previa.dosEmAndamento === 1 ? 'deles tem' : 'deles têm'} trabalho começado.`}
          aviso={previa.aviso || 'Alguns desses leads já têm trabalho começado com a pessoa atual.'}
          rotuloConfirmar="Mover mesmo assim"
          tom="perigo"
          ocupado={ocupado}
          onConfirmar={confirmarComAndamento}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </>
  )
}
