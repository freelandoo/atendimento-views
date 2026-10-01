'use client'
/**
 * PLANEJAR MEU DIA — a porta de entrada do Quadro do Dia.
 *
 * ⚠️ NÃO DESPEJA A CARTEIRA NO DIA. A lista que aparece aqui vem de uma leitura própria de
 * planejamento (mesmo recorte de responsável/nicho, sem herdar filtros da Lista) e das
 * SUGESTÕES que o backend conseguiu provar: follow-up meu vencido e compromisso meu na agenda
 * de hoje. Nada é adicionado sozinho — a pessoa marca e confirma.
 *
 * Adicionar ao dia **não assume lead de ninguém, não transfere responsável e não dispara
 * abordagem**: é planejamento. A regra vive no backend (`services/plano-dia.js` + a rota);
 * aqui só se escolhe.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import FolhaModal from '@/components/ui/FolhaModal'
import Botao from '@/components/ui/Botao'
import { IconGear } from '@/components/ui/icons'
import { classesEntrada } from '@/lib/ui-primitivos'
import { celulaOrigem, OPCOES_FILTRO_ORIGEM, rotuloFiltroOrigem } from '@/lib/lead-origem'
import { ordemIcp, seloIcp } from '@/lib/lead-icp'
import { nomePais } from '@/lib/paises'
import {
  seloOrigemEntrada, opcoesNicho, opcoesCidade, opcoesRegiao, opcoesCategoria, opcoesPais,
  gruposPlanejamento, motivoPlanejamento, origemBateFiltro, sugestaoPlanoDoDia, filtrarCarteira,
  totalAcoes, notaLead, resumoAcoes,
} from '@/lib/plano-dia'

export type CandidatoDia = {
  id: string
  nome: string | null
  telefone?: string | null
  origem?: string | null
  instagram_handle?: string | null
  cidade?: string | null
  nicho?: string | null
  categoria?: string | null
  categoria_perfil?: string | null
  classificacao_url?: string | null
  pais?: string | null
  country?: string | null
  regiao?: string | null
  regiao_comercial?: string | null
  estado?: string | null
  uf?: string | null
  bairro?: string | null
  endereco?: string | null
  icp_faixa?: string | null
  icp_score?: number | null
  rating?: number | null
  n_followups?: number | null
  n_ligacoes?: number | null
  n_disparos?: number | null
}

export type SugestaoDia = {
  prospect_id: string
  nome: string | null
  telefone?: string | null
  origem?: string | null
  cidade?: string | null
  icp_faixa?: string | null
  icp_score?: number | null
  origem_entrada: string
  quando?: string | null
}

type LeadComIcp = {
  icp_faixa?: string | null
  icp_score?: number | null
}

function SeloIcpPlanejamento({ lead }: { lead: LeadComIcp }) {
  const selo = seloIcp(lead.icp_faixa, lead.icp_score)
  const rotulo = selo.chave === 'sem_icp' ? 'ICP pendente' : `ICP ${selo.chave}`
  const detalhe = selo.score == null ? 'sem nota' : `${selo.score} pts`
  return (
    <span
      className={`shrink-0 rounded-md border px-2 py-1 text-right text-[11px] leading-tight ${selo.classe}`}
      title={`${selo.rotulo}: ${selo.descricao}`}
    >
      <span className="block font-semibold">{rotulo}</span>
      <span className="block font-normal opacity-80">{detalhe}</span>
    </span>
  )
}

export default function ModalPlanejarDia({
  aberto, onFechar, candidatos, carregandoCarteira, erroCarteira, onRecarregarCarteira,
  sugestoes, jaNoDia, ocupado, onAdicionar, rotuloDia, vagasSugeridas,
}: {
  aberto: boolean
  onFechar: () => void
  /** A carteira de planejamento, na ordem de trabalho do servidor. */
  candidatos: CandidatoDia[]
  carregandoCarteira?: boolean
  erroCarteira?: string
  onRecarregarCarteira?: () => void
  sugestoes: SugestaoDia[]
  /** Ids que já estão no dia — aparecem marcados e bloqueados, nunca somem da lista. */
  jaNoDia: Set<string>
  ocupado: boolean
  onAdicionar: (ids: string[], origem: string) => Promise<void>
  rotuloDia: string
  vagasSugeridas?: number
}) {
  const [busca, setBusca] = useState('')
  const [nicho, setNicho] = useState('')
  const [categoria, setCategoria] = useState('')
  const [pais, setPais] = useState('')
  const [cidade, setCidade] = useState('')
  const [regiao, setRegiao] = useState('')
  const [origemFiltro, setOrigemFiltro] = useState('')
  const [grupoRapido, setGrupoRapido] = useState('')
  const [filtrosAbertosCarteira, setFiltrosAbertosCarteira] = useState(false)
  const [aba, setAba] = useState<'esperando' | 'carteira'>('esperando')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  // O seletor conta só quem AINDA pode entrar no dia — contar quem já está lá prometeria
  // leads que a lista não vai mostrar.
  const disponiveis = useMemo(() => candidatos.filter((l) => !jaNoDia.has(l.id)), [candidatos, jaNoDia])
  const nichos = useMemo(() => opcoesNicho(disponiveis), [disponiveis])
  const categorias = useMemo(() => opcoesCategoria(disponiveis), [disponiveis])
  const paises = useMemo(() => opcoesPais(disponiveis), [disponiveis])
  const cidades = useMemo(() => opcoesCidade(disponiveis), [disponiveis])
  const regioes = useMemo(() => opcoesRegiao(disponiveis), [disponiveis])
  const gruposRapidos = useMemo(() => gruposPlanejamento(disponiveis), [disponiveis])
  const sugeridos = useMemo(
    () => sugestoes.filter((s) => !jaNoDia.has(s.prospect_id) && origemBateFiltro(s, origemFiltro)),
    [sugestoes, jaNoDia, origemFiltro]
  )
  const filtrados = useMemo(
    () => filtrarCarteira(candidatos, { busca, nicho, categoria, pais, cidade, regiao, origem: origemFiltro, grupo: grupoRapido, jaNoDia }),
    [candidatos, busca, nicho, categoria, pais, cidade, regiao, origemFiltro, grupoRapido, jaNoDia]
  )
  const carteiraOrdenada = useMemo(
    () => filtrados
      .map((lead, indice) => ({ lead, indice }))
      // ICP/nota primeiro (decisão do operador, 2026-10-01); entre parecidos, o mais trabalhado sobe.
      .sort((a, b) => {
        const porIcp = ordemIcp(b.lead) - ordemIcp(a.lead)
        if (porIcp) return porIcp
        const porNota = notaLead(b.lead) - notaLead(a.lead)
        if (porNota) return porNota
        const porAcoes = totalAcoes(b.lead) - totalAcoes(a.lead)
        return porAcoes || a.indice - b.indice
      })
      .map((item) => item.lead),
    [filtrados]
  )
  const sugestaoAutomatica = useMemo(
    () => sugestaoPlanoDoDia({
      sugeridos,
      carteira: carteiraOrdenada,
      jaNoDia,
      limite: Math.max(0, Number(vagasSugeridas || 0)),
    }),
    [sugeridos, carteiraOrdenada, jaNoDia, vagasSugeridas]
  )
  const filtrosCarteira = [busca.trim(), nicho, categoria, pais, cidade, regiao, origemFiltro, grupoRapido].filter(Boolean).length
  const rotuloOrigemAtiva = rotuloFiltroOrigem(origemFiltro)
  const mostrarFiltrosCarteira = filtrosAbertosCarteira || filtrosCarteira > 0

  // Nicho que esvaziou (todos foram para o dia) volta para "Todos": um <select> com valor sem
  // <option> correspondente exibe uma coisa e filtra outra.
  useEffect(() => {
    if (nicho && !nichos.some((o) => o.valor === nicho)) setNicho('')
  }, [nicho, nichos])
  useEffect(() => {
    if (categoria && !categorias.some((o) => o.valor === categoria)) setCategoria('')
  }, [categoria, categorias])
  useEffect(() => {
    if (pais && !paises.some((o) => o.valor === pais)) setPais('')
  }, [pais, paises])
  useEffect(() => {
    if (cidade && !cidades.some((o) => o.valor === cidade)) setCidade('')
  }, [cidade, cidades])
  useEffect(() => {
    if (regiao && !regioes.some((o) => o.valor === regiao)) setRegiao('')
  }, [regiao, regioes])
  useEffect(() => {
    if (grupoRapido && !gruposRapidos.some((o) => o.chave === grupoRapido)) setGrupoRapido('')
  }, [grupoRapido, gruposRapidos])

  function marcarFiltrados() {
    setMarcados((prev) => {
      const next = new Set(prev)
      for (const l of filtrados) next.add(l.id)
      return next
    })
  }

  function limparFiltrosCarteira() {
    setBusca('')
    setNicho('')
    setCategoria('')
    setPais('')
    setCidade('')
    setRegiao('')
    setOrigemFiltro('')
    setGrupoRapido('')
  }

  // A aba padrão é escolhida UMA vez por abertura. Reavaliar a cada mudança de `sugeridos.length`
  // bouncava o operador de volta para "Para hoje" quando ele mexia no filtro de origem (que altera
  // `sugeridos`) — a seção da carteira, com o painel de filtros, desmontava no clique.
  const abaDefinidaRef = useRef(false)
  useEffect(() => {
    if (!aberto) { abaDefinidaRef.current = false; return }
    if (abaDefinidaRef.current) return
    abaDefinidaRef.current = true
    setAba(sugeridos.length > 0 ? 'esperando' : 'carteira')
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

  function marcarSugestaoAutomatica() {
    if (!sugestaoAutomatica.ids.length) return
    setMarcados(new Set(sugestaoAutomatica.ids))
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
            { chave: 'carteira' as const, rotulo: 'Carteira', total: carregandoCarteira ? '...' : disponiveis.length },
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

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Sugestão do dia</p>
            <p className="mt-0.5 text-xs text-ink-3">
              {sugestaoAutomatica.total
                ? `${sugestaoAutomatica.total} lead(s): ${sugestaoAutomatica.texto}. Revise antes de adicionar.`
                : 'Sem vagas sugeridas agora. Você ainda pode escolher leads manualmente.'}
            </p>
          </div>
          <Botao
            variante="secundaria"
            tamanho="sm"
            onClick={marcarSugestaoAutomatica}
            disabled={!sugestaoAutomatica.total}
            motivoDesabilitado={!sugestaoAutomatica.total ? 'A capacidade sugerida já está preenchida ou não há candidatos neste recorte.' : ''}
          >
            Marcar sugestão
          </Botao>
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
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{s.nome || 'Sem nome'}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                            {selo && (
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800"
                                title={selo.dica}
                              >
                                {selo.rotulo}
                              </span>
                            )}
                            {s.cidade && <span className="truncate">{s.cidade}</span>}
                          </span>
                        </span>
                        <SeloIcpPlanejamento lead={s} />
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
                ICP mais forte primeiro. Abra os filtros para recortar por origem, nicho e local.
              </p>
            </div>
            {!carregandoCarteira && !erroCarteira && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFiltrosAbertosCarteira((v) => !v)}
                  aria-expanded={mostrarFiltrosCarteira}
                  aria-label="Abrir filtros do planejamento"
                  title={rotuloOrigemAtiva ? `Filtros ativos: ${rotuloOrigemAtiva}` : 'Filtros do planejamento'}
                  className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    filtrosCarteira > 0
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-line bg-surface text-ink-2 hover:border-brand/40 hover:bg-surface-3'
                  }`}
                >
                  <IconGear />
                  {filtrosCarteira > 0 && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1 text-[10px] font-semibold leading-4 text-white">
                      {filtrosCarteira}
                    </span>
                  )}
                </button>
                {filtrosCarteira > 0 && (
                  <Botao variante="neutra" tamanho="sm" onClick={limparFiltrosCarteira}>
                    Limpar filtros
                  </Botao>
                )}
                {filtrados.length > 1 && (
                  <Botao variante="secundaria" tamanho="sm" onClick={marcarFiltrados}>
                    Marcar os {filtrados.length} da lista
                  </Botao>
                )}
              </div>
            )}
          </div>

          {mostrarFiltrosCarteira && (
            <div className="mt-2 rounded-lg border border-line bg-surface-2 p-2">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <label htmlFor="planejar-busca" className="sr-only">Buscar lead por nome, telefone, nicho, categoria ou cidade</label>
                <input
                  id="planejar-busca"
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar carteira"
                  className={classesEntrada({ extra: 'sm:col-span-2 lg:col-span-1' })}
                />
                <label htmlFor="planejar-origem" className="sr-only">Filtrar por origem</label>
                <select
                  id="planejar-origem"
                  value={origemFiltro}
                  onChange={(e) => setOrigemFiltro(e.target.value)}
                  className={classesEntrada()}
                >
                  {OPCOES_FILTRO_ORIGEM.map((o) => (
                    <option key={o.valor || 'todas'} value={o.valor}>{o.label}</option>
                  ))}
                </select>
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
                {categorias.length > 1 && (
                  <>
                    <label htmlFor="planejar-categoria" className="sr-only">Filtrar por categoria</label>
                    <select
                      id="planejar-categoria"
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                      className={classesEntrada()}
                    >
                      <option value="">Todas as categorias ({disponiveis.length})</option>
                      {categorias.map((o) => (
                        <option key={o.valor} value={o.valor}>{o.valor} ({o.total})</option>
                      ))}
                    </select>
                  </>
                )}
                {paises.length > 1 && (
                  <>
                    <label htmlFor="planejar-pais" className="sr-only">Filtrar por país</label>
                    <select
                      id="planejar-pais"
                      value={pais}
                      onChange={(e) => setPais(e.target.value)}
                      className={classesEntrada()}
                    >
                      <option value="">Todos os países ({disponiveis.length})</option>
                      {paises.map((o) => (
                        <option key={o.valor} value={o.valor}>{nomePais(o.valor)} ({o.total})</option>
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

              {gruposRapidos.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Blocos rápidos</span>
                  {gruposRapidos.map((g) => (
                    <button
                      key={g.chave}
                      type="button"
                      onClick={() => setGrupoRapido((atual) => (atual === g.chave ? '' : g.chave))}
                      title={g.dica}
                      className={`rounded-md border px-2 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                        grupoRapido === g.chave
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-line bg-surface text-ink-2 hover:border-brand/40 hover:bg-surface-3'
                      }`}
                    >
                      {g.rotulo} <span className="font-normal">({g.total})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {carregandoCarteira ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
              Carregando carteira de planejamento…
            </p>
          ) : erroCarteira ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-center text-xs text-amber-800">
              <p>{erroCarteira}</p>
              {onRecarregarCarteira && (
                <button type="button" onClick={onRecarregarCarteira} className="mt-1 font-medium text-brand underline-offset-2 hover:underline">
                  Tentar novamente
                </button>
              )}
            </div>
          ) : filtrados.length === 0 ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-4 text-center text-xs text-ink-3">
              {filtrosCarteira > 0
                ? 'Nenhum lead da carteira carregada bate com esse filtro.'
                : 'Todos os leads carregados já estão no plano deste dia.'}
            </p>
          ) : (
            <ul className="mt-2 max-h-[40vh] space-y-1.5 overflow-y-auto pr-1">
              {carteiraOrdenada.map((l) => {
                const o = celulaOrigem(l)
                const motivo = motivoPlanejamento(l)
                const acoes = resumoAcoes(l)
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
                          <span className={`rounded-md border px-1.5 py-0.5 font-medium ${motivo.classe}`} title={motivo.dica}>
                            {motivo.rotulo}
                          </span>
                          {acoes && (
                            <span
                              className="rounded-md border border-line bg-surface-3 px-1.5 py-0.5 font-medium text-ink-2"
                              title={`Atenção já dada: ${acoes.detalhe}`}
                            >
                              {acoes.rotulo}
                            </span>
                          )}
                          <span className={o.classe} title={`${o.rotulo} — ${o.dica}`}>{o.curto}</span>
                          {l.nicho && (
                            <span className="truncate rounded-md bg-surface-3 px-1.5 py-0.5 text-ink-2">{l.nicho}</span>
                          )}
                          {(l.categoria_perfil || l.categoria || l.classificacao_url) && (
                            <span className="truncate rounded-md bg-surface-3 px-1.5 py-0.5 text-ink-2">
                              {l.categoria_perfil || l.categoria || l.classificacao_url}
                            </span>
                          )}
                          {(l.pais || l.country) && (
                            <span className="truncate">{nomePais(l.pais || l.country)}</span>
                          )}
                          {l.cidade && <span className="truncate">{l.cidade}</span>}
                        </span>
                      </span>
                      <SeloIcpPlanejamento lead={l} />
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
