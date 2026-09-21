'use client'
// "Puxar mais leads" — o gestor traz leads LIVRES do nicho para a equipe.
//
// ─── O QUE ESTA AÇÃO FAZ, E O QUE ELA NUNCA FAZ ─────────────────────────────────────────
// Ela só entrega leads que estão SEM DONO e sem nenhum trabalho registrado. Lead com reunião
// marcada, conversa aberta, follow-up, ligação ou disparo nunca é tocado — nem para equilibrar
// a carteira. Quem decide isso é `backend/src/services/lead-distribuicao.js`; esta tela apenas
// mostra o veredito e o resumo do que ficou protegido.
//
// ─── O QUE ESTE COMPONENTE NÃO SABE ─────────────────────────────────────────────────────
// Nenhuma regra. Critérios, modos, validação, prévia e resumo vêm de `lib/equipe-carteira.js`
// (puro e testado) — mesmo contrato de `ModalGerenciarMembros` e `BolinhaPontuacao`.
//
// ⚠️ A prévia é ESTIMATIVA e o texto diz isso: entre abrir o modal e confirmar, um vendedor
// pode ter assumido um dos leads livres. O número REAL vem na resposta, e é ele que a tela
// anuncia depois — prometer o pedido e entregar menos seria a tela mentindo.
import { useEffect, useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import Campo from '@/components/ui/Campo'
import {
  CRITERIOS,
  MODOS_DISTRIBUICAO,
  QUANTIDADE_PADRAO,
  previaDaPuxada,
  resumoProtegidos,
  validarPuxada,
} from '@/lib/equipe-area'
import type { LinhaCarteira, MotivoProtegido } from '@/lib/equipe-area'

export type DadosPuxada = {
  quantidade: number
  criterio: string
  entre: string
  usuario_ids: string[]
}

export default function ModalPuxarLeads({
  aberto,
  nomeEquipe,
  nomeNicho,
  membros,
  disponiveis,
  protegidos,
  ocupado = false,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean
  nomeEquipe: string
  nomeNicho: string
  /** Só quem é membro ativo da equipe pode receber — o backend recusa qualquer outro id. */
  membros: LinhaCarteira[]
  /** Leads livres E intocados do nicho, contados pelo servidor. */
  disponiveis: number
  protegidos: MotivoProtegido[]
  ocupado?: boolean
  onFechar: () => void
  onConfirmar: (dados: DadosPuxada) => Promise<void> | void
}) {
  const [quantidade, setQuantidade] = useState(String(QUANTIDADE_PADRAO))
  const [criterio, setCriterio] = useState(CRITERIOS[1].id)
  const [entre, setEntre] = useState(MODOS_DISTRIBUICAO[0].id)
  const [selecionados, setSelecionados] = useState<string[]>([])

  // Reabrir com o formulário do uso anterior faria o gestor puxar de novo o que já puxou.
  useEffect(() => {
    if (!aberto) return
    setQuantidade(String(Math.min(QUANTIDADE_PADRAO, Math.max(1, disponiveis || 1))))
    setCriterio(CRITERIOS[1].id)
    setEntre(MODOS_DISTRIBUICAO[0].id)
    setSelecionados([])
  }, [aberto, disponiveis])

  const protegido = useMemo(() => resumoProtegidos(protegidos), [protegidos])
  const veredito = useMemo(
    () => validarPuxada({ quantidade, entre, selecionados, disponiveis }),
    [quantidade, entre, selecionados, disponiveis]
  )
  const previa = useMemo(
    () => previaDaPuxada({ quantidade, disponiveis, entre, selecionados, membros }),
    [quantidade, disponiveis, entre, selecionados, membros]
  )

  function alternar(id: string) {
    setSelecionados((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]))
  }

  async function confirmar() {
    if (!veredito.pode || ocupado) return
    await onConfirmar({
      quantidade: Math.trunc(Number(quantidade)) || QUANTIDADE_PADRAO,
      criterio,
      entre,
      usuario_ids: entre === 'selecionados' ? selecionados : [],
    })
  }

  return (
    <FolhaModal
      aberto={aberto}
      titulo="Puxar mais leads"
      descricao={`Traz leads livres de ${nomeNicho} para ${nomeEquipe}.`}
      onFechar={onFechar}
      tamanho="md"
      rodape={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-ink-3">{veredito.pode ? previa : veredito.motivo}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Botao tamanho="sm" onClick={onFechar} disabled={ocupado}>Cancelar</Botao>
            <Botao
              tamanho="sm"
              variante="primaria"
              onClick={confirmar}
              disabled={!veredito.pode || ocupado}
              motivoDesabilitado={veredito.motivo}
            >
              {ocupado ? 'Distribuindo…' : 'Distribuir'}
            </Botao>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── O que existe para distribuir ─────────────────────────────────────────────── */}
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <p className="text-sm text-ink">
            <span className="text-lg font-bold tabular-nums">{disponiveis}</span>{' '}
            {disponiveis === 1 ? 'lead livre e sem trabalho começado' : 'leads livres e sem trabalho começado'} em{' '}
            <span className="font-medium">{nomeNicho}</span>.
          </p>
          {protegido && (
            <p className="mt-2 text-xs text-ink-3">
              {protegido.titulo} não entram nesta conta:{' '}
              {protegido.itens.map((i) => `${i.total} ${i.rotulo}`).join(' · ')}. {protegido.explicacao}
            </p>
          )}
        </div>

        <Campo etiqueta="Nicho">
          {/* Bloqueado com o motivo em texto: o nicho É a carteira da equipe, e trocá-lo aqui
              moveria lead de um mercado para outro. Mudar de nicho é encerrar e criar outra. */}
          <input value={nomeNicho} disabled readOnly aria-describedby="ajuda-nicho" />
        </Campo>
        <p id="ajuda-nicho" className="-mt-3 text-xs text-ink-3">
          Definido pela equipe. Cada equipe trabalha um nicho.
        </p>

        <Campo
          etiqueta="Quantos leads"
          ajuda="Se houver menos leads livres do que o pedido, só os disponíveis são distribuídos."
          obrigatorio
        >
          <input
            type="number"
            min={1}
            max={disponiveis || 1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </Campo>

        <Campo etiqueta="Quais leads primeiro" ajuda={CRITERIOS.find((c) => c.id === criterio)?.ajuda}>
          <select value={criterio} onChange={(e) => setCriterio(e.target.value)}>
            {CRITERIOS.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
          </select>
        </Campo>

        <Campo etiqueta="Distribuir entre" ajuda={MODOS_DISTRIBUICAO.find((m) => m.id === entre)?.ajuda}>
          <select value={entre} onChange={(e) => setEntre(e.target.value)}>
            {MODOS_DISTRIBUICAO.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
          </select>
        </Campo>

        {entre === 'selecionados' && (
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-2">Quem recebe</legend>
            <ul className="space-y-1">
              {membros.map((m) => (
                <li key={m.usuario_id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-3">
                    <input
                      type="checkbox"
                      checked={selecionados.includes(String(m.usuario_id))}
                      onChange={() => alternar(String(m.usuario_id))}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{m.nome || 'sem nome'}</span>
                    {/* Carga atual ao lado: é a informação que decide quem deve receber. */}
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">
                      {m.leads} na carteira · {m.intocados} intocados
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <p className="text-xs text-ink-3">
          Leads com reunião marcada, conversa aberta, follow-up, ligação ou mensagem já enviada
          nunca são movidos — nem por esta ação, nem automaticamente.
        </p>
      </div>
    </FolhaModal>
  )
}
