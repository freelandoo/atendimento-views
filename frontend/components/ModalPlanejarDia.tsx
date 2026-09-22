'use client'
/**
 * PLANEJAR MEU DIA — a porta de entrada do Quadro do Dia.
 *
 * ⚠️ NÃO DESPEJA A CARTEIRA. A lista que aparece aqui é a MESMA que a Lista já carregou (na
 * ordem de trabalho que o servidor calculou) e as SUGESTÕES que o backend conseguiu provar:
 * follow-up meu vencido e compromisso meu na agenda de hoje. Nada é adicionado sozinho — a
 * pessoa marca e confirma.
 *
 * Adicionar ao dia **não assume lead de ninguém, não transfere responsável e não dispara
 * abordagem**: é planejamento. A regra vive no backend (`services/plano-dia.js` + a rota);
 * aqui só se escolhe.
 */
import { useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import { classesEntrada } from '@/lib/ui-primitivos'
import { celulaOrigem } from '@/lib/lead-origem'
import { seloOrigemEntrada } from '@/lib/plano-dia'

export type CandidatoDia = {
  id: string
  nome: string | null
  telefone?: string | null
  origem?: string | null
  instagram_handle?: string | null
  cidade?: string | null
}

export type SugestaoDia = {
  prospect_id: string
  nome: string | null
  telefone?: string | null
  origem?: string | null
  cidade?: string | null
  origem_entrada: string
  quando?: string | null
}

export default function ModalPlanejarDia({
  aberto, onFechar, candidatos, sugestoes, jaNoDia, ocupado, onAdicionar, rotuloDia,
}: {
  aberto: boolean
  onFechar: () => void
  /** A carteira já carregada pela Lista, na ordem de trabalho do servidor. */
  candidatos: CandidatoDia[]
  sugestoes: SugestaoDia[]
  /** Ids que já estão no dia — aparecem marcados e bloqueados, nunca somem da lista. */
  jaNoDia: Set<string>
  ocupado: boolean
  onAdicionar: (ids: string[], origem: string) => Promise<void>
  rotuloDia: string
}) {
  const [busca, setBusca] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const base = candidatos.filter((l) => !jaNoDia.has(l.id))
    if (!q) return base.slice(0, 60)
    return base.filter((l) => (
      String(l.nome || '').toLowerCase().includes(q)
      || String(l.telefone || '').includes(q)
      || String(l.cidade || '').toLowerCase().includes(q)
    )).slice(0, 60)
  }, [candidatos, busca, jaNoDia])

  const sugeridos = useMemo(
    () => sugestoes.filter((s) => !jaNoDia.has(s.prospect_id)),
    [sugestoes, jaNoDia]
  )

  function alternar(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function adicionar(ids: string[], origem: string) {
    if (!ids.length) return
    await onAdicionar(ids, origem)
    setMarcados(new Set())
  }

  return (
    <FolhaModal
      aberto={aberto}
      titulo="Planejar meu dia"
      descricao={`Escolha os leads que você pretende trabalhar ${rotuloDia.toLowerCase() === 'hoje' ? 'hoje' : `em ${rotuloDia}`}. Isso é planejamento: não assume lead de ninguém e não envia nada.`}
      onFechar={onFechar}
      tamanho="lg"
      rodape={
        <>
          <Botao variante="neutra" onClick={onFechar}>Fechar</Botao>
          <Botao
            variante="primaria"
            onClick={() => adicionar([...marcados], 'escolha_manual')}
            disabled={!marcados.size}
            carregando={ocupado}
            motivoDesabilitado={!marcados.size ? 'Marque ao menos um lead.' : ''}
          >
            Adicionar {marcados.size > 0 ? `${marcados.size} ` : ''}ao dia
          </Botao>
        </>
      }
    >
      <div className="space-y-5">
        {/* SUGESTÕES — só o que o backend conseguiu PROVAR (follow-up vencido meu, compromisso
            meu na agenda de hoje). Lista vazia aqui é resposta, não falha: significa que a
            escolha do dia é inteiramente sua. */}
        {sugeridos.length > 0 && (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">O que já está te esperando</h3>
              <Botao
                variante="secundaria"
                tamanho="sm"
                onClick={() => adicionar(sugeridos.map((s) => s.prospect_id), 'sugestao_vencidos')}
                carregando={ocupado}
              >
                Adicionar os {sugeridos.length}
              </Botao>
            </div>
            <p className="mt-0.5 text-xs text-ink-3">
              Retornos vencidos e compromissos desta data — o motivo aparece em cada linha.
            </p>
            <ul className="mt-2 space-y-1.5">
              {sugeridos.map((s) => {
                const selo = seloOrigemEntrada(s.origem_entrada)
                return (
                  <li key={s.prospect_id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
                      <input
                        type="checkbox"
                        checked={marcados.has(s.prospect_id)}
                        onChange={() => alternar(s.prospect_id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{s.nome || 'Sem nome'}</span>
                        {selo && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                            title={selo.dica}>
                            {selo.rotulo}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* A CARTEIRA — a mesma lista que está na aba Lista, na ordem de trabalho do servidor.
            Teto de 60 na tela: escolher o dia é decidir sobre um punhado, não varrer a base. */}
        <section>
          <h3 className="text-sm font-semibold text-ink">Da sua carteira</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Na ordem de trabalho. Use a busca para encontrar um lead específico.
          </p>
          <label htmlFor="planejar-busca" className="sr-only">Buscar lead pelo nome, telefone ou cidade</label>
          <input
            id="planejar-busca"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, telefone ou cidade"
            className={classesEntrada({ extra: 'mt-2' })}
          />
          {filtrados.length === 0 ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
              {busca.trim()
                ? 'Nenhum lead da carteira carregada bate com essa busca.'
                : 'Todos os leads carregados já estão no plano deste dia.'}
            </p>
          ) : (
            <ul className="mt-2 max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
              {filtrados.map((l) => {
                const o = celulaOrigem(l)
                return (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
                      <input
                        type="checkbox"
                        checked={marcados.has(l.id)}
                        onChange={() => alternar(l.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{l.nome || 'Sem nome'}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                          <span className={o.classe} title={`${o.rotulo} — ${o.dica}`}>{o.curto}</span>
                          {l.cidade && <span className="truncate">{l.cidade}</span>}
                          {!l.telefone && <span className="text-amber-700">sem telefone</span>}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </FolhaModal>
  )
}
