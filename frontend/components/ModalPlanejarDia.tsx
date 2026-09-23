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
import { useEffect, useMemo, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import { classesEntrada } from '@/lib/ui-primitivos'
import { celulaOrigem } from '@/lib/lead-origem'
import {
  seloOrigemEntrada, opcoesNicho, opcoesCidade, opcoesRegiao, filtrarCarteira,
} from '@/lib/plano-dia'

export type CandidatoDia = {
  id: string
  nome: string | null
  telefone?: string | null
  origem?: string | null
  instagram_handle?: string | null
  cidade?: string | null
  nicho?: string | null
  regiao?: string | null
  regiao_comercial?: string | null
  estado?: string | null
  uf?: string | null
  bairro?: string | null
  endereco?: string | null
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
  const [nicho, setNicho] = useState('')
  const [cidade, setCidade] = useState('')
  const [regiao, setRegiao] = useState('')
  const [aba, setAba] = useState<'esperando' | 'carteira'>('esperando')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  // O seletor conta só quem AINDA pode entrar no dia — contar quem já está lá prometeria
  // leads que a lista não vai mostrar.
  const disponiveis = useMemo(() => candidatos.filter((l) => !jaNoDia.has(l.id)), [candidatos, jaNoDia])
  const nichos = useMemo(() => opcoesNicho(disponiveis), [disponiveis])
  const cidades = useMemo(() => opcoesCidade(disponiveis), [disponiveis])
  const regioes = useMemo(() => opcoesRegiao(disponiveis), [disponiveis])
  const filtrados = useMemo(
    () => filtrarCarteira(candidatos, { busca, nicho, cidade, regiao, jaNoDia }),
    [candidatos, busca, nicho, cidade, regiao, jaNoDia]
  )

  // Nicho que esvaziou (todos foram para o dia) volta para "Todos": um <select> com valor sem
  // <option> correspondente exibe uma coisa e filtra outra.
  useEffect(() => {
    if (nicho && !nichos.some((o) => o.valor === nicho)) setNicho('')
  }, [nicho, nichos])
  useEffect(() => {
    if (cidade && !cidades.some((o) => o.valor === cidade)) setCidade('')
  }, [cidade, cidades])
  useEffect(() => {
    if (regiao && !regioes.some((o) => o.valor === regiao)) setRegiao('')
  }, [regiao, regioes])

  function marcarFiltrados() {
    setMarcados((prev) => {
      const next = new Set(prev)
      for (const l of filtrados) next.add(l.id)
      return next
    })
  }

  const sugeridos = useMemo(
    () => sugestoes.filter((s) => !jaNoDia.has(s.prospect_id)),
    [sugestoes, jaNoDia]
  )

  useEffect(() => {
    if (aberto) setAba(sugeridos.length > 0 ? 'esperando' : 'carteira')
  }, [aberto, sugeridos.length])

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
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-2 p-1" role="tablist" aria-label="Origem dos leads para planejar">
          {[
            { chave: 'esperando' as const, rotulo: 'Para hoje', total: sugeridos.length },
            { chave: 'carteira' as const, rotulo: 'Carteira', total: disponiveis.length },
          ].map((item) => (
            <button
              key={item.chave}
              type="button"
              role="tab"
              aria-selected={aba === item.chave}
              onClick={() => setAba(item.chave)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                aba === item.chave ? 'bg-surface text-brand shadow-card' : 'text-ink-3 hover:bg-surface-3 hover:text-ink'
              }`}
            >
              {item.rotulo} <span className="text-xs font-normal">({item.total})</span>
            </button>
          ))}
        </div>

        {aba === 'esperando' ? (
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">O que já está te esperando</h3>
                <p className="mt-0.5 text-xs text-ink-3">
                  Retornos vencidos e compromissos desta data — o motivo aparece em cada linha.
                </p>
              </div>
              {sugeridos.length > 0 && (
                <Botao
                  variante="secundaria"
                  tamanho="sm"
                  onClick={() => adicionar(sugeridos.map((s) => s.prospect_id), 'sugestao_vencidos')}
                  carregando={ocupado}
                >
                  Adicionar os {sugeridos.length}
                </Botao>
              )}
            </div>
            {sugeridos.length === 0 ? (
              <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
                Nada pendente provado para esta data. Use a carteira para montar o plano.
              </p>
            ) : (
              <ul className="mt-2 max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
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
            )}
          </section>
        ) : (
          <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Da sua carteira</h3>
              <p className="mt-0.5 text-xs text-ink-3">
                Na ordem de trabalho. Busque por nome ou combine filtros de nicho e localização.
              </p>
            </div>
            {filtrados.length > 1 && (
              <Botao variante="secundaria" tamanho="sm" onClick={marcarFiltrados}>
                Marcar os {filtrados.length} da lista
              </Botao>
            )}
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label htmlFor="planejar-busca" className="sr-only">Buscar lead pelo nome, telefone ou cidade</label>
            <input
              id="planejar-busca"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome"
              className={classesEntrada({ extra: 'sm:col-span-2 lg:col-span-1' })}
            />
            {nichos.length > 1 && (
              <>
                <label htmlFor="planejar-nicho" className="sr-only">Filtrar por nicho</label>
                <select
                  id="planejar-nicho"
                  value={nicho}
                  onChange={(e) => setNicho(e.target.value)}
                  className={classesEntrada()}
                >
                  <option value="">Todos os nichos ({disponiveis.length})</option>
                  {nichos.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>
                  ))}
                </select>
              </>
            )}
            {cidades.length > 1 && (
              <>
                <label htmlFor="planejar-cidade" className="sr-only">Filtrar por cidade</label>
                <select
                  id="planejar-cidade"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  className={classesEntrada()}
                >
                  <option value="">Todas as cidades ({disponiveis.length})</option>
                  {cidades.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>
                  ))}
                </select>
              </>
            )}
            {regioes.length > 1 && (
              <>
                <label htmlFor="planejar-regiao" className="sr-only">Filtrar por região</label>
                <select
                  id="planejar-regiao"
                  value={regiao}
                  onChange={(e) => setRegiao(e.target.value)}
                  className={classesEntrada()}
                >
                  <option value="">Todas as regiões ({disponiveis.length})</option>
                  {regioes.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {filtrados.length === 0 ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
              {busca.trim() || nicho
                ? 'Nenhum lead da carteira carregada bate com esse filtro.'
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
                          {l.nicho && (
                            <span className="truncate rounded-md bg-surface-3 px-1.5 py-0.5 text-ink-2">{l.nicho}</span>
                          )}
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
        )}
      </div>
    </FolhaModal>
  )
}
