'use client'
// Área de EQUIPE — a tela única de gestão de equipes, pessoas e desempenho.
//
// ─── O QUE ESTA TELA UNIFICOU, E POR QUÊ ────────────────────────────────────────────────
// Até 2026-09-19 havia DUAS telas para o mesmo trabalho: `/dashboard/equipe` (quem está com o
// quê) e `/dashboard/equipes-comerciais` (quem trabalha qual nicho). São o mesmo fluxo — montar
// a equipe e depois olhar o resultado —, e o gestor tinha de trocar de página no meio dele.
//
// A unificação é de APRESENTAÇÃO. **Nenhuma rota, nenhuma regra e nenhuma permissão mudaram:**
// as duas telas já exigiam a MESMA capacidade (`MEMBROS_GERENCIAR`), então ninguém ganhou nem
// perdeu acesso. A única mudança de backend foi o `PATCH /equipes-comerciais/:id`, que renomeia
// a equipe — o nicho continua imutável, porque é ele que recorta a carteira dos membros.
//
// ─── O QUE ESTA TELA DELIBERADAMENTE NÃO É ──────────────────────────────────────────────
// • **Não é placar.** As contagens medem coisas diferentes (carteira, fila, compromisso,
//   histórico) e não se somam num total. Cada coluna e cada cartão diz o que mede, pelo mesmo
//   motivo do `oQueMede` obrigatório da `BolinhaPontuacao`.
// • **Não é auditoria agregada.** A linha do tempo é rastreabilidade — a migration 047 declara
//   que a auditoria não deve ser fonte de dashboard —, então ela aparece crua, sem nenhum número
//   derivado dela.
// • **Não é a tela de contas.** Adicionar pessoa à empresa, desativar e trocar papel vivem em
//   `/dashboard/contas-empresa`. Lá se decide ACESSO; aqui se decide CARTEIRA.
//
// Toda a tradução (ordem, rótulos, avisos, filtros, métricas) vive em `lib/equipe-area.js`; esta
// tela só desenha.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import CabecalhoPagina from '@/components/ui/CabecalhoPagina'
import Botao from '@/components/ui/Botao'
import Card from '@/components/ui/Card'
import Carregando from '@/components/ui/Carregando'
import EstadoVazio from '@/components/ui/EstadoVazio'
import Abas, { PainelAba } from '@/components/ui/Abas'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import ModalGerenciarMembros from '@/components/ModalGerenciarMembros'
import ModalEquipe, { type DadosEquipe, type Nicho } from '@/components/ModalEquipe'
import ModalPuxarLeads, { type DadosPuxada } from '@/components/ModalPuxarLeads'
import ModalMoverLeads, { type DadosTransferencia } from '@/components/ModalMoverLeads'
import {
  ABAS,
  ATIVIDADE_HOJE_COLUNAS,
  AVISO_ENCERRAR,
  COLUNAS_CARTEIRA,
  COLUNAS_MEMBRO,
  METRICAS_EQUIPE,
  OPCOES_STATUS_PESSOA,
  abaValida,
  alertasDaEquipe,
  alertasGerais,
  atividadeHoje,
  avisoDeInativo,
  avisoMembrosOcultos,
  descreverAtividade,
  estadoDaEquipe,
  filtrarEquipes,
  filtrarPessoas,
  formatarDinheiro,
  juntarAvisos,
  montarEquipes,
  montarPessoas,
  ordenarEquipe,
  ordenarPorAtividadeHoje,
  papeisPresentes,
  podeEncerrar,
  pontosDeAtencao,
  resumoDaDevolucao,
  resumoDaPuxada,
  resumoDaTransferencia,
  resumoDeMembros,
  resumoDoRebalanceamento,
  resumoDoRecorte,
  resumoGeral,
  resumoProtegidos,
  rotuloPapel,
  rotuloUltimoAcesso,
  temTrabalhoSemDono,
  tomDaCarteira,
  tomDaColuna,
  valorDaCarteira,
  valorDaColuna,
} from '@/lib/equipe-area'
import type {
  AlertaEquipe,
  AvisoCarteira,
  CartaoResumo,
  EquipeArea,
  EquipeResumo,
  EventoAuditoria,
  LinhaCarteira,
  LinhaEquipe,
  MotivoProtegido,
  PessoaArea,
  PessoaElegivel,
  ResultadoDevolucao,
  ResultadoPuxada,
  ResultadoRebalanceamento,
  ResultadoTransferencia,
} from '@/lib/equipe-area'

type RespostaEquipe = {
  equipe: LinhaEquipe[]
  sem_responsavel: LinhaEquipe
  avisos: { inativos_com_carga: { usuario_id: string | null; nome: string }[] }
}

// Missão e ranking são CONSOLIDAÇÃO DE LEITURA: os mesmos endpoints que a tela de Comissão já
// usa. Se divergirem daquela tela, é defeito — não há regra nova aqui.
type MissaoAtiva = {
  missao: { id: string; titulo: string; alvo_valor: string | number } | null
  alcancaram?: { usuario_id: string; nome: string | null; valor: number }[] | null
}
type LinhaRanking = { usuario_id: string; nome: string | null; originado: number }

// A carteira do NICHO da equipe — recorte diferente do de `RespostaEquipe`, que conta a carteira
// de cada pessoa na EMPRESA INTEIRA. Os dois convivem na tela, e cada um declara o que mede.
type RespostaCarteira = {
  equipe: { id: string; nome: string; status: string; nicho_id: string; nicho_nome: string | null }
  membros: LinhaCarteira[]
  livres: LinhaCarteira
  disponiveis_para_puxar: number
  protegidos: MotivoProtegido[]
  // Pontos de atencao (2026-09-23). Contagens prontas do backend; a tela so' traduz.
  aguardando_triagem?: number
  sem_nicho?: number
  fora_da_equipe?: { leads: number; pessoas: number } | null
}

const CHAVE_ABA = 'equipeArea.aba'

// Tom dos avisos. Cor é REFORÇO — o título e a descrição dizem a mesma coisa em texto.
const TOM_AVISO: Record<string, string> = {
  perigo: 'border-estado-danger/30 bg-estado-danger/5',
  alerta: 'border-estado-warn/30 bg-estado-warn/5',
  neutro: 'border-line bg-surface-2',
}
const TOM_NUMERO: Record<string, string> = {
  perigo: 'text-estado-danger',
  alerta: 'text-estado-warn',
  neutro: 'text-ink',
}
const TOM_CELULA: Record<string, string> = {
  perigo: 'font-semibold text-estado-danger',
  alerta: 'font-semibold text-estado-warn',
  neutro: 'text-ink-2',
}

export default function EquipePage() {
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const base = `/api/empresas/${empresaId}/equipes-comerciais`

  const [dados, setDados] = useState<RespostaEquipe | null>(null)
  const [equipesBrutas, setEquipesBrutas] = useState<EquipeResumo[]>([])
  const [elegiveis, setElegiveis] = useState<PessoaElegivel[]>([])
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [ranking, setRanking] = useState<LinhaRanking[]>([])
  const [missao, setMissao] = useState<MissaoAtiva | null>(null)
  const [prazoParado, setPrazoParado] = useState(0)

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [aba, setAba] = useState<string>('visao')
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [buscaEquipe, setBuscaEquipe] = useState('')

  // Filtros da aba Pessoas — de TELA, não de permissão (quem chega aqui já vê todo mundo).
  const [buscaPessoa, setBuscaPessoa] = useState('')
  const [filtroEquipe, setFiltroEquipe] = useState('')
  const [filtroPapel, setFiltroPapel] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('ativos')

  const [atividadeDe, setAtividadeDe] = useState<PessoaArea | null>(null)
  const [membrosDe, setMembrosDe] = useState<EquipeArea | null>(null)
  const [editando, setEditando] = useState<EquipeArea | null>(null)
  const [criando, setCriando] = useState(false)
  const [encerrando, setEncerrando] = useState<EquipeArea | null>(null)
  const [puxandoDe, setPuxandoDe] = useState<EquipeArea | null>(null)
  // Mover leads ENTRE pessoas. `origem` vem preenchida quando o gestor clica na linha de alguem.
  const [movendo, setMovendo] = useState<{ equipe: EquipeArea; origem: string | null } | null>(null)

  // A carteira do nicho é carregada SÓ para a equipe aberta: são contagens sobre a carteira
  // inteira do nicho, caras demais para virem junto da lista de equipes.
  const [carteira, setCarteira] = useState<RespostaCarteira | null>(null)
  const [carregandoCarteira, setCarregandoCarteira] = useState(false)
  const [erroCarteira, setErroCarteira] = useState('')
  const pedidoCarteira = useRef(0)

  // A aba sobrevive ao recarregamento e é compartilhável pela URL — mesmo padrão da Aquisição
  // (`history.replaceState`, sem `useSearchParams`, que forçaria Suspense na página inteira).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const daUrl = new URLSearchParams(window.location.search).get('aba')
    const guardada = window.sessionStorage.getItem(CHAVE_ABA)
    setAba(abaValida(daUrl || guardada))
  }, [])

  function trocarAba(id: string) {
    const nova = abaValida(id)
    setAba(nova)
    if (typeof window === 'undefined') return
    try { window.sessionStorage.setItem(CHAVE_ABA, nova) } catch { /* modo privado: a aba só não persiste */ }
    const url = new URL(window.location.href)
    url.searchParams.set('aba', nova)
    window.history.replaceState(null, '', url.toString())
  }

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setCarregando(true)
    setErro('')
    try {
      // As quatro juntas: a tela não serve para nada com uma delas faltando, e um erro parcial
      // esconderia por que a lista está vazia.
      const [eq, times, el, ni] = await Promise.all([
        apiFetch<RespostaEquipe, { parado_dias: number }>(`/api/empresas/${empresaId}/equipe`),
        apiFetch<EquipeResumo[]>(base),
        apiFetch<PessoaElegivel[]>(`${base}/elegiveis`),
        apiFetch<Nicho[]>(`/api/empresas/${empresaId}/nichos`),
      ])
      setDados(eq.data)
      setPrazoParado(Number(eq.meta?.parado_dias) || 0)
      setEquipesBrutas(times.data || [])
      setElegiveis(el.data || [])
      setNichos((ni.data || []).filter((n) => n.ativo !== false))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a área de equipe.')
    } finally {
      setCarregando(false)
    }

    // Missão e ranking carregam SEPARADO e em silêncio: são consolidação, e uma falha neles não
    // pode derrubar o painel de carga, que é o dado que o gestor vem redistribuir.
    apiFetch<MissaoAtiva>(`/api/empresas/${empresaId}/missoes`)
      .then((r) => setMissao(r.data))
      .catch(() => setMissao(null))
    apiFetch<{ ranking: LinhaRanking[] }>(`/api/empresas/${empresaId}/comissao/ranking`)
      .then((r) => setRanking(r.data.ranking || []))
      .catch(() => setRanking([]))
  }, [base, empresaId])

  useEffect(() => { carregar() }, [carregar])

  // ── Junção das fontes: uma linha por pessoa, uma linha por equipe ─────────────────────
  const pessoas = useMemo(
    () => montarPessoas({ linhas: dados?.equipe, elegiveis, ranking }),
    [dados, elegiveis, ranking],
  )
  const equipes = useMemo(() => montarEquipes({ equipes: equipesBrutas, pessoas }), [equipesBrutas, pessoas])
  const ativas = useMemo(() => equipes.filter((e) => e.status === 'ativa'), [equipes])
  const encerradas = useMemo(() => equipes.filter((e) => e.status !== 'ativa'), [equipes])
  const cartoes = useMemo(
    () => resumoGeral({ pessoas, equipes, semDono: dados?.sem_responsavel, prazoParado }),
    [pessoas, equipes, dados, prazoParado],
  )

  // A primeira equipe ativa abre sozinha: chegar na aba Equipes e ver o painel direito vazio
  // faria parecer que não há nada, quando só falta um clique.
  useEffect(() => {
    if (!ativas.length) { setSelecionada(null); return }
    setSelecionada((atual) => (atual && equipes.some((e) => String(e.id) === atual) ? atual : String(ativas[0].id)))
  }, [ativas, equipes])

  const equipeAberta = useMemo(
    () => equipes.find((e) => String(e.id) === String(selecionada)) || null,
    [equipes, selecionada],
  )
  const listaEsquerda = useMemo(() => filtrarEquipes(equipes, buscaEquipe), [equipes, buscaEquipe])

  const pessoasFiltradas = useMemo(
    () => filtrarPessoas(pessoas, { busca: buscaPessoa, equipeId: filtroEquipe, papel: filtroPapel, status: filtroStatus }),
    [pessoas, buscaPessoa, filtroEquipe, filtroPapel, filtroStatus],
  )

  // ── A carteira do nicho da equipe aberta ─────────────────────────────────────────────
  //
  // Token de requisição + limpeza a cada troca (mesmo contrato de `ConversaPainel`): clicar
  // rápido de uma equipe para outra nunca pode mostrar a carteira da anterior como se fosse a
  // desta. Falha aqui NÃO derruba o detalhe — o resto da tela continua servindo.
  const carregarCarteira = useCallback(async (equipeId: string | null) => {
    if (!empresaId || !equipeId) { setCarteira(null); setErroCarteira(''); return }
    const meu = ++pedidoCarteira.current
    setCarregandoCarteira(true)
    setErroCarteira('')
    setCarteira(null)
    try {
      const r = await apiFetch<RespostaCarteira>(`${base}/${equipeId}/carteira`)
      if (meu !== pedidoCarteira.current) return
      setCarteira(r.data)
    } catch (e) {
      if (meu !== pedidoCarteira.current) return
      setErroCarteira(e instanceof Error ? e.message : 'Não foi possível carregar a carteira do nicho.')
    } finally {
      if (meu === pedidoCarteira.current) setCarregandoCarteira(false)
    }
  }, [empresaId, base])

  useEffect(() => { void carregarCarteira(selecionada) }, [selecionada, carregarCarteira])

  // ── Escritas ──────────────────────────────────────────────────────────────────────────
  async function criarEquipe(d: DadosEquipe) {
    await fb.runTask(
      () => apiFetch(base, { method: 'POST', body: JSON.stringify({ nome: d.nome, nicho_id: d.nicho_id, usuario_ids: d.usuario_ids }) }),
      { sucesso: 'Equipe criada.' },
    )
    setCriando(false)
    await carregar()
  }

  async function salvarEdicao(d: DadosEquipe) {
    if (!editando) return
    // Só nome: o nicho é imutável e o backend recusa `nicho_id` com 400 `NICHO_NAO_EDITAVEL`.
    await fb.runTask(
      () => apiFetch(`${base}/${editando.id}`, { method: 'PATCH', body: JSON.stringify({ nome: d.nome }) }),
      { sucesso: 'Equipe atualizada.' },
    )
    setEditando(null)
    await carregar()
  }

  async function salvarMembros(usuarioIds: string[]) {
    if (!membrosDe) return
    const alvo = membrosDe
    // Entrar na equipe REDISTRIBUI a carteira intocada do nicho; sair DEVOLVE toda a carteira da
    // pessoa para a fila. As duas rodam na mesma transação de `PUT /participantes`, e os dois
    // resumos vêm do servidor. `null` em cada um é comum e legítimo (ninguém entrou/ninguém
    // saiu, ou nada havia para mover) — anunciar "0" mandaria procurar defeito onde não há.
    await fb.runTask(
      () => apiFetch<{ distribuicao?: ResultadoRebalanceamento | null; devolucao?: ResultadoDevolucao[] | null }>(
        `${base}/${alvo.id}/participantes`,
        { method: 'PUT', body: JSON.stringify({ usuario_ids: usuarioIds }) },
      ),
      {
        sucesso: (r) => [
          resumoDoRebalanceamento(r?.data?.distribuicao ?? null),
          resumoDaDevolucao(r?.data?.devolucao ?? null),
        ].filter(Boolean).join(' ') || 'Equipe atualizada.',
      },
    )
    setMembrosDe(null)
    await carregar()
    await carregarCarteira(alvo.id)
  }

  async function confirmarPuxada(d: DadosPuxada) {
    if (!puxandoDe) return
    const alvo = puxandoDe
    const nomePorId: Record<string, string> = {}
    for (const m of carteira?.membros || []) nomePorId[String(m.usuario_id)] = m.nome || 'sem nome'
    await fb.runTask(
      () => apiFetch<ResultadoPuxada>(`${base}/${alvo.id}/distribuicao`, { method: 'POST', body: JSON.stringify(d) }),
      // ⚠️ Sem mensagem fixa: quem diz o que aconteceu é o número REAL devolvido, que pode ser
      // menor que o pedido (alguém assumiu o lead entre a leitura e a escrita, ou os livres
      // acabaram). Um "Leads distribuídos." fixo afirmaria o que o banco não fez.
      { sucesso: (r) => resumoDaPuxada(r?.data, nomePorId).texto },
    )
    setPuxandoDe(null)
    await carregar()
    await carregarCarteira(alvo.id)
  }

  async function confirmarTransferencia(d: DadosTransferencia) {
    if (!movendo) return
    const alvo = movendo.equipe
    const nomePorId: Record<string, string> = {}
    for (const m of carteira?.membros || []) nomePorId[String(m.usuario_id)] = m.nome || 'sem nome'
    await fb.runTask(
      () => apiFetch<ResultadoTransferencia>(`${base}/${alvo.id}/transferencia`, { method: 'POST', body: JSON.stringify(d) }),
      // Sem mensagem fixa, pelo mesmo motivo da puxada: quem diz o que aconteceu e' o numero REAL,
      // e ele pode ser menor que o pedido (alguem mexeu num lead entre a tela e o clique).
      { sucesso: (r) => resumoDaTransferencia(r?.data, nomePorId).texto },
    )
    setMovendo(null)
    await carregar()
    await carregarCarteira(alvo.id)
  }

  async function confirmarEncerramento() {
    if (!encerrando) return
    const alvo = encerrando
    setEncerrando(null)
    await fb.runTask(
      () => apiFetch(`${base}/${alvo.id}/encerrar`, { method: 'POST', body: JSON.stringify({}) }),
      { sucesso: 'Equipe encerrada.' },
    )
    await carregar()
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Equipe"
        descricao="Gerencie suas equipes comerciais, acompanhe o desempenho e veja o que cada pessoa está fazendo."
        acoes={<Botao variante="primaria" onClick={() => setCriando(true)}>Nova equipe</Botao>}
      />

      {erro && (
        <div className="mb-4 rounded-lg border border-estado-danger/30 bg-estado-danger/5 px-3 py-2 text-sm text-estado-danger">
          {erro}{' '}
          <button onClick={carregar} className="underline underline-offset-2">Tentar de novo</button>
        </div>
      )}

      <Abas abas={[...ABAS]} ativa={aba} onMudar={trocarAba} idBase="equipe" ariaLabel="Seções da área de equipe" />

      {/* ── Resumo: quatro perguntas diferentes, que NÃO se somam ───────────────────────
          Ficam fora das abas de propósito: são o estado da operação, e trocar de recorte não
          muda quantas pessoas existem nem quantos follow-ups estão vencidos. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cartoes.map((c) => <CartaoResumoBloco key={c.chave} cartao={c} />)}
      </div>

      {carregando && !dados && <Carregando variante="bloco" texto="Carregando a equipe…" />}

      {dados && (
        <div className="mt-4">
          <PainelAba id="visao" idBase="equipe" ativa={aba}>
            <VisaoGeral
              pessoas={pessoas}
              semDono={dados.sem_responsavel}
              missao={missao}
              ranking={ranking}
              onVerAtividade={setAtividadeDe}
            />
          </PainelAba>

          <PainelAba id="equipes" idBase="equipe" ativa={aba}>
            <ListaEDetalhe
              equipes={listaEsquerda}
              total={equipes.length}
              aberta={equipeAberta}
              busca={buscaEquipe}
              prazoParado={prazoParado}
              carteira={carteira}
              carregandoCarteira={carregandoCarteira}
              erroCarteira={erroCarteira}
              onBuscar={setBuscaEquipe}
              onSelecionar={setSelecionada}
              onNova={() => setCriando(true)}
              onEditar={setEditando}
              onMembros={setMembrosDe}
              onEncerrar={setEncerrando}
              onPuxar={setPuxandoDe}
              onMover={(eq, origem) => setMovendo({ equipe: eq, origem: origem || null })}
              onRecarregarCarteira={() => void carregarCarteira(selecionada)}
              onVerAtividade={setAtividadeDe}
            />
          </PainelAba>

          <PainelAba id="pessoas" idBase="equipe" ativa={aba}>
            <AbaPessoas
              pessoas={pessoasFiltradas}
              total={pessoas.length}
              papeis={papeisPresentes(pessoas)}
              equipes={ativas}
              filtros={{ busca: buscaPessoa, equipeId: filtroEquipe, papel: filtroPapel, status: filtroStatus }}
              onBusca={setBuscaPessoa}
              onEquipe={setFiltroEquipe}
              onPapel={setFiltroPapel}
              onStatus={setFiltroStatus}
              onLimpar={() => { setBuscaPessoa(''); setFiltroEquipe(''); setFiltroPapel(''); setFiltroStatus('ativos') }}
              onVerAtividade={setAtividadeDe}
            />
          </PainelAba>
        </div>
      )}

      {/* ── Equipes encerradas: histórico, recolhido ────────────────────────────────────
          Só na aba Equipes: é o contexto delas, e no resto da tela seria ruído. */}
      {aba === 'equipes' && encerradas.length > 0 && (
        <details className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-card">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            Encerradas ({encerradas.length})
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {encerradas.map((eq) => (
              <li key={eq.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-ink-2">{eq.nome}</span>
                <span className="text-xs text-ink-3">
                  {eq.nicho_nome || 'sem nicho'} · {estadoDaEquipe(eq).descricao}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── Modais ─────────────────────────────────────────────────────────────────────── */}
      <ModalEquipe
        aberto={criando || Boolean(editando)}
        equipe={editando}
        nichos={nichos}
        equipes={equipes}
        pessoas={pessoas}
        ocupado={fb.ocupado}
        onFechar={() => { setCriando(false); setEditando(null) }}
        onSalvar={editando ? salvarEdicao : criarEquipe}
      />

      <ModalGerenciarMembros
        aberto={Boolean(membrosDe)}
        equipe={membrosDe}
        pessoas={pessoas}
        ocupado={fb.ocupado}
        onFechar={() => setMembrosDe(null)}
        onSalvar={salvarMembros}
      />

      <ModalPuxarLeads
        aberto={Boolean(puxandoDe) && Boolean(carteira)}
        nomeEquipe={puxandoDe?.nome || ''}
        nomeNicho={carteira?.equipe.nicho_nome || puxandoDe?.nicho_nome || 'este nicho'}
        membros={carteira?.membros || []}
        disponiveis={carteira?.disponiveis_para_puxar || 0}
        protegidos={carteira?.protegidos || []}
        ocupado={fb.ocupado}
        onFechar={() => setPuxandoDe(null)}
        onConfirmar={confirmarPuxada}
      />

      <ModalMoverLeads
        aberto={Boolean(movendo) && Boolean(carteira)}
        nomeNicho={carteira?.equipe.nicho_nome || movendo?.equipe.nicho_nome || 'este nicho'}
        membros={carteira?.membros || []}
        origemInicial={movendo?.origem || null}
        ocupado={fb.ocupado}
        onFechar={() => setMovendo(null)}
        onConfirmar={confirmarTransferencia}
      />

      {encerrando && (
        <ModalConfirmar
          titulo="Encerrar equipe"
          corpo={`Encerrar ${encerrando.nome}? Ela deixa de recortar a operação e vai para o histórico.`}
          aviso={AVISO_ENCERRAR}
          rotuloConfirmar="Encerrar"
          tom="perigo"
          ocupado={fb.ocupado}
          onConfirmar={confirmarEncerramento}
          onCancelar={() => setEncerrando(null)}
        />
      )}

      {atividadeDe && atividadeDe.usuario_id && (
        <ModalAtividade empresaId={empresaId} pessoa={atividadeDe} onFechar={() => setAtividadeDe(null)} />
      )}
    </div>
  )
}

// ─── Blocos ───────────────────────────────────────────────────────────────────────────────

/** Um cartão do resumo. `oQueMede` vai para o `title`: o número sozinho não se explica. */
function CartaoResumoBloco({ cartao }: { cartao: CartaoResumo }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-card" title={cartao.oQueMede}>
      <div className={`text-2xl font-bold tabular-nums ${TOM_NUMERO[cartao.tom || 'neutro']}`}>{cartao.valor}</div>
      <div className="mt-0.5 text-sm font-medium text-ink-2">{cartao.rotulo}</div>
      <div className="mt-0.5 text-xs text-ink-3">{cartao.apoio}</div>
    </div>
  )
}

/** Os gestos que um aviso pode oferecer. Ausente = o aviso não ganha botão (nunca um inerte). */
type AcoesDoAviso = { mover?: () => void; puxar?: () => void }

// Destinos de NAVEGAÇÃO dos avisos. Só abrem outra tela; nenhum escreve nada.
const DESTINO_DO_AVISO: Record<string, string> = {
  banco_leads: '/dashboard/banco-leads',
  triagem: '/dashboard/aquisicao',
}

/** Um aviso. O tom é reforço; título e descrição dizem tudo em texto. */
function Aviso({ alerta, acoes }: { alerta: AlertaEquipe | AvisoCarteira; acoes?: AcoesDoAviso }) {
  const acao = 'acao' in alerta ? alerta.acao : undefined
  const handler = acao?.tipo === 'mover' ? acoes?.mover : acao?.tipo === 'puxar' ? acoes?.puxar : undefined
  const destino = acao ? DESTINO_DO_AVISO[acao.tipo] : undefined
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${TOM_AVISO[alerta.tom] || TOM_AVISO.neutro}`}>
      <p className="text-sm font-medium text-ink">{alerta.titulo}</p>
      <p className="mt-0.5 text-xs text-ink-3">{alerta.descricao}</p>
      {acao && handler && (
        <button type="button" onClick={handler} className="mt-1.5 text-xs font-medium text-brand underline-offset-2 hover:underline">
          {acao.rotulo}
        </button>
      )}
      {acao && !handler && destino && (
        <a href={destino} className="mt-1.5 inline-block text-xs font-medium text-brand underline-offset-2 hover:underline">
          {acao.rotulo}
        </a>
      )}
    </div>
  )
}

// ─── Aba: Visão geral ─────────────────────────────────────────────────────────────────────

function VisaoGeral({
  pessoas, semDono, missao, ranking, onVerAtividade,
}: {
  pessoas: PessoaArea[]
  semDono: LinhaEquipe
  missao: MissaoAtiva | null
  ranking: LinhaRanking[]
  onVerAtividade: (p: PessoaArea) => void
}) {
  const alertas = alertasGerais({ semDono })
  const doDia = ordenarPorAtividadeHoje(pessoas).filter((p) => p.ativo !== false)

  return (
    <div className="space-y-4">
      {(missao?.missao || ranking.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {missao?.missao && (
            <Card titulo="Missão ativa" descricao={`Alvo ${formatarDinheiro(missao.missao.alvo_valor)}`}>
              <p className="text-sm text-ink-2">{missao.missao.titulo}</p>
              {/* Quem ALCANÇOU, não quem está em que ponto: o progresso parcial é pessoal, e
                  esta lista existe para o dono saber a quem pagar a recompensa. */}
              <p className="mt-2 text-xs text-ink-3">
                {missao.alcancaram == null
                  ? 'O progresso de cada pessoa é pessoal.'
                  : missao.alcancaram.length === 0
                    ? 'Ninguém alcançou o alvo ainda.'
                    : `${missao.alcancaram.length === 1 ? '1 pessoa alcançou' : `${missao.alcancaram.length} pessoas alcançaram`} o alvo: ${missao.alcancaram.map((a) => a.nome || 'Sem nome').join(', ')}.`}
              </p>
              <a href="/dashboard/comissao" className="mt-3 inline-block text-xs text-brand underline-offset-2 hover:underline">
                Ver na Comissão
              </a>
            </Card>
          )}

          {ranking.length > 0 && (
            <Card titulo="Faturamento originado no mês" descricao="Resultado pago, não atividade.">
              {/* Faturamento PAGO originado, nunca a comissão de ninguém: quanto cada um ganha é
                  assunto dele com a empresa (decisão D4, 18/09). */}
              <ul className="divide-y divide-line">
                {ranking.slice(0, 5).map((l) => (
                  <li key={l.usuario_id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-ink-2">{l.nome || 'Sem nome'}</span>
                    <span className="font-medium tabular-nums text-ink">{formatarDinheiro(l.originado)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Trabalho sem dono é FILA, não anomalia — mas é o que o gestor abre esta tela para
          redistribuir. Zerado, não aparece: não há nada a fazer. */}
      {alertas.length > 0 && (
        <Card titulo="Precisa de atenção" descricao="Trabalho que hoje não tem ninguém respondendo por ele.">
          <div className="grid gap-2 sm:grid-cols-2">
            {alertas.map((a) => <Aviso key={a.chave} alerta={a} />)}
          </div>
        </Card>
      )}

      {!temTrabalhoSemDono(semDono) && alertas.length === 0 && (
        <Card>
          <p className="text-sm text-ink-2">
            Nenhum trabalho sem responsável agora. Leads, conversas e follow-ups estão todos
            atribuídos a alguém.
          </p>
        </Card>
      )}

      <Card
        titulo="Movimento de hoje"
        descricao="Ações registradas desde o início do dia. É rastreabilidade — não é medida de produtividade."
      >
        {doDia.length === 0 ? (
          <EstadoVazio titulo="Ninguém com acesso ativo nesta empresa ainda." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {doDia.map((p) => {
              const a = atividadeHoje(p)
              return (
                <article key={p.usuario_id || p.nome} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{p.nome}</div>
                      <div className="text-xs text-ink-3">{rotuloPapel(p.papel)}</div>
                    </div>
                    <button
                      onClick={() => onVerAtividade(p)}
                      className="shrink-0 text-xs text-brand underline-offset-2 hover:underline"
                    >
                      Atividade
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {ATIVIDADE_HOJE_COLUNAS.map((c) => (
                      <div key={c.chave} title={c.oQueMede} className="rounded-md bg-surface px-2 py-1.5 text-center">
                        <div className="text-base font-semibold tabular-nums text-ink">
                          {(a as unknown as Record<string, number>)[c.chave] ?? 0}
                        </div>
                        <div className="text-[10px] text-ink-3">{c.rotulo}</div>
                      </div>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Aba: Equipes (lista à esquerda, detalhe à direita) ───────────────────────────────────

function ListaEDetalhe({
  equipes, total, aberta, busca, prazoParado, carteira, carregandoCarteira, erroCarteira,
  onBuscar, onSelecionar, onNova, onEditar, onMembros, onEncerrar, onPuxar, onMover,
  onRecarregarCarteira, onVerAtividade,
}: {
  equipes: EquipeArea[]
  total: number
  aberta: EquipeArea | null
  busca: string
  prazoParado: number
  carteira: RespostaCarteira | null
  carregandoCarteira: boolean
  erroCarteira: string
  onBuscar: (v: string) => void
  onSelecionar: (id: string) => void
  onNova: () => void
  onEditar: (e: EquipeArea) => void
  onMembros: (e: EquipeArea) => void
  onEncerrar: (e: EquipeArea) => void
  onPuxar: (e: EquipeArea) => void
  onMover: (e: EquipeArea, origem?: string | null) => void
  onRecarregarCarteira: () => void
  onVerAtividade: (p: PessoaArea) => void
}) {
  if (total === 0) {
    return (
      <Card>
        <EstadoVazio
          titulo="Nenhuma equipe ainda"
          descricao="Enquanto não houver equipe, ninguém é recortado: todo mundo continua vendo a carteira como antes."
          acao={<Botao variante="primaria" onClick={onNova}>Criar a primeira equipe</Botao>}
        />
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* ── Coluna esquerda ───────────────────────────────────────────────────────────── */}
      <Card titulo="Equipes comerciais" semPadding className="self-start">
        <div className="px-4 pb-3">
          <label className="block">
            <span className="sr-only">Buscar equipe por nome ou nicho</span>
            <input
              type="search"
              value={busca}
              onChange={(e) => onBuscar(e.target.value)}
              placeholder="Buscar equipe ou nicho…"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
        </div>

        {equipes.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma equipe com essa busca"
            descricao="Confira a escrita ou limpe a busca."
            acao={<Botao tamanho="sm" onClick={() => onBuscar('')}>Limpar busca</Botao>}
          />
        ) : (
          <ul className="max-h-[32rem] overflow-y-auto border-t border-line" role="list">
            {equipes.map((eq) => {
              const estado = estadoDaEquipe(eq)
              const ativa = String(eq.id) === String(aberta?.id)
              return (
                <li key={eq.id}>
                  <button
                    type="button"
                    aria-current={ativa ? 'true' : undefined}
                    onClick={() => onSelecionar(String(eq.id))}
                    className={`flex w-full items-start gap-2.5 border-b border-line px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${
                      ativa ? 'bg-brand/5' : 'hover:bg-surface-2'
                    }`}
                  >
                    {/* A bolinha é decorativa: o estado vem escrito no selo ao lado. */}
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eq.status === 'ativa' ? 'bg-estado-ok' : 'bg-line-strong'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm font-semibold ${ativa ? 'text-brand' : 'text-ink'}`}>
                          {eq.nome}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            eq.status === 'ativa'
                              ? 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok'
                              : 'border-line bg-surface-3 text-ink-3'
                          }`}
                        >
                          {estado.rotulo}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-3">
                        {eq.nicho_nome || 'sem nicho'} · {eq.total_membros === 1 ? '1 membro' : `${eq.total_membros} membros`}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* ── Coluna direita ────────────────────────────────────────────────────────────── */}
      {aberta ? (
        <DetalheEquipe
          equipe={aberta}
          prazoParado={prazoParado}
          carteira={carteira}
          carregandoCarteira={carregandoCarteira}
          erroCarteira={erroCarteira}
          onEditar={onEditar}
          onMembros={onMembros}
          onEncerrar={onEncerrar}
          onPuxar={onPuxar}
          onMover={onMover}
          onRecarregarCarteira={onRecarregarCarteira}
          onVerAtividade={onVerAtividade}
        />
      ) : (
        <Card>
          <EstadoVazio titulo="Escolha uma equipe à esquerda" descricao="O detalhe aparece aqui, sem trocar de página." />
        </Card>
      )}
    </div>
  )
}

function DetalheEquipe({
  equipe, prazoParado, carteira, carregandoCarteira, erroCarteira,
  onEditar, onMembros, onEncerrar, onPuxar, onMover, onRecarregarCarteira, onVerAtividade,
}: {
  equipe: EquipeArea
  prazoParado: number
  carteira: RespostaCarteira | null
  carregandoCarteira: boolean
  erroCarteira: string
  onEditar: (e: EquipeArea) => void
  onMembros: (e: EquipeArea) => void
  onEncerrar: (e: EquipeArea) => void
  onPuxar: (e: EquipeArea) => void
  onMover: (e: EquipeArea, origem?: string | null) => void
  onRecarregarCarteira: () => void
  onVerAtividade: (p: PessoaArea) => void
}) {
  const estado = estadoDaEquipe(equipe)
  const fim = podeEncerrar(equipe)
  // UM bloco de PONTOS DE ATENCAO, no topo: o que a carteira do nicho revela (lead que a pessoa
  // nao enxerga, triagem pendente, lead fora da equipe, sem nicho, desequilibrio) junto dos
  // alertas da equipe. Antes ficavam espalhados — parte no rodape da carteira, parte no fim da
  // pagina — e o gestor so' os via depois de ja' ter distribuido.
  const avisos = juntarAvisos(pontosDeAtencao(carteira), alertasDaEquipe(equipe, prazoParado))
  const ocultos = avisoMembrosOcultos(equipe)
  const membros = ordenarEquipe(equipe.membros)
  const podeMover = Boolean(carteira) && (carteira?.membros || []).filter((m) => (m.leads || 0) > 0).length > 0
    && (carteira?.membros || []).length >= 2
  const acoesDoAviso: AcoesDoAviso = {
    mover: equipe.status === 'ativa' && podeMover ? () => onMover(equipe, null) : undefined,
    puxar: equipe.status === 'ativa' ? () => onPuxar(equipe) : undefined,
  }

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho da equipe ───────────────────────────────────────────────────────── */}
      <Card>
        <nav aria-label="Trilha" className="text-xs text-ink-3">
          Equipe <span aria-hidden="true">/</span>{' '}
          <span className="text-ink-2">{equipe.nicho_nome || 'sem nicho'}</span>
        </nav>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-bold text-ink">{equipe.nome}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
              <span>Nicho: <span className="font-medium text-ink-2">{equipe.nicho_nome || 'sem nome'}</span></span>
              <span aria-hidden="true">·</span>
              <span>{resumoDeMembros(equipe)}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  equipe.status === 'ativa'
                    ? 'border-estado-ok/30 bg-estado-ok/10 text-estado-ok'
                    : 'border-line bg-surface-3 text-ink-3'
                }`}
              >
                {estado.rotulo}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {equipe.status === 'ativa' && (
              <>
                {/* A ação primária desta tela: é por ela que a equipe ganha volume. Desabilitada
                    COM MOTIVO quando não há o que distribuir — botão inerte só convida ao clique. */}
                <Botao
                  tamanho="sm"
                  variante="primaria"
                  onClick={() => onPuxar(equipe)}
                  disabled={!carteira || carteira.disponiveis_para_puxar <= 0 || carteira.membros.length === 0}
                  motivoDesabilitado={
                    !carteira ? 'Carregando a carteira do nicho…'
                      : carteira.membros.length === 0 ? 'Adicione pessoas à equipe antes de distribuir leads.'
                        : 'Não há lead livre e sem trabalho começado neste nicho.'
                  }
                >
                  Puxar mais leads
                </Botao>
                {/* Mover ENTRE pessoas. Desabilitado COM motivo quando nao ha a quem ou de quem mover. */}
                <Botao
                  tamanho="sm"
                  onClick={() => onMover(equipe, null)}
                  disabled={!podeMover}
                  motivoDesabilitado={
                    !carteira ? 'Carregando a carteira do nicho…'
                      : (carteira.membros || []).length < 2 ? 'É preciso ter pelo menos duas pessoas na equipe.'
                        : 'Ninguém da equipe tem leads deste nicho para ceder.'
                  }
                >
                  Mover leads
                </Botao>
                <Botao tamanho="sm" onClick={() => onMembros(equipe)}>Gerenciar membros</Botao>
                <Botao tamanho="sm" onClick={() => onEditar(equipe)}>Editar equipe</Botao>
              </>
            )}
            {/* Encerrar fica visível e DESABILITADO com o motivo: o backend recusa equipe com
                gente (409), e oferecer o clique faria o gestor achar que é defeito. */}
            <Botao
              tamanho="sm"
              variante="perigosa"
              onClick={() => onEncerrar(equipe)}
              disabled={!fim.pode}
              motivoDesabilitado={fim.motivo}
            >
              Encerrar
            </Botao>
          </div>
        </div>

        {ocultos && <p className="mt-3 text-xs text-estado-warn">{ocultos}</p>}
      </Card>

      {/* ── Pontos de atenção: NO TOPO, antes das métricas ─────────────────────────────
          O que impede a distribuição de sair certa tem de ser visto ANTES de distribuir. Some
          quando não há nada a fazer — não se ocupa espaço para dizer que está tudo bem. */}
      {avisos.length > 0 && (
        <section
          aria-label="Pontos de atenção da distribuição"
          className="rounded-lg border border-line bg-surface p-4 shadow-card"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">
              {avisos.length === 1 ? '1 ponto de atenção' : `${avisos.length} pontos de atenção`}
            </h4>
            <p className="text-xs text-ink-3">Resolva antes de distribuir, para os leads chegarem a quem vai trabalhá-los.</p>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {avisos.map((a) => <Aviso key={a.chave} alerta={a} acoes={acoesDoAviso} />)}
          </div>
        </section>
      )}

      {/* ── Métricas da equipe ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {METRICAS_EQUIPE.map((m) => {
          const bruto = (equipe.metricas as unknown as Record<string, number | null>)[m.chave]
          return (
            <div key={m.chave} className="rounded-lg border border-line bg-surface p-3 shadow-card" title={m.oQueMede}>
              <div className="text-lg font-bold tabular-nums text-ink">
                {m.dinheiro ? formatarDinheiro(bruto) : (bruto ?? 0)}
              </div>
              <div className="mt-0.5 text-xs text-ink-3">{m.rotulo}</div>
            </div>
          )
        })}
      </div>

      {/* ── Carteira do nicho ─────────────────────────────────────────────────────────── */}
      <CarteiraDoNicho
        equipe={equipe}
        carteira={carteira}
        carregando={carregandoCarteira}
        erro={erroCarteira}
        onRecarregar={onRecarregarCarteira}
        onPuxar={() => onPuxar(equipe)}
        onMover={equipe.status === 'ativa' ? (origem) => onMover(equipe, origem) : undefined}
      />

      {/* ── Membros ───────────────────────────────────────────────────────────────────── */}
      <Card
        titulo="Membros da equipe"
        descricao="Desempenho individual de quem trabalha este nicho. As colunas medem coisas diferentes e não se somam."
        semPadding
      >
        {membros.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma pessoa nesta equipe"
            descricao="Enquanto não houver membros, esta equipe não recorta a carteira de ninguém."
            acao={equipe.status === 'ativa' ? <Botao tamanho="sm" variante="primaria" onClick={() => onMembros(equipe)}>Adicionar pessoas</Botao> : undefined}
          />
        ) : (
          <TabelaPessoas membros={membros} comEquipe={false} onVerAtividade={onVerAtividade} />
        )}
      </Card>

    </div>
  )
}

// ─── A carteira do NICHO da equipe ────────────────────────────────────────────────────────
//
// ⚠️ NÃO é a mesma carteira da tabela "Membros da equipe" logo abaixo. Ali os números são da
// EMPRESA INTEIRA (`GET /equipe`); aqui são só do nicho desta equipe. Os dois são verdadeiros e
// diferentes, e é por isso que cada coluna carrega `oQueMede` no cabeçalho.
//
// A tela não decide nada: "intocado", "protegido" e as contagens vêm resolvidas do servidor
// (`backend/src/services/lead-distribuicao.js`). Aqui só se traduz.
function CarteiraDoNicho({
  equipe, carteira, carregando, erro, onRecarregar, onPuxar, onMover,
}: {
  equipe: EquipeArea
  carteira: RespostaCarteira | null
  carregando: boolean
  erro: string
  onRecarregar: () => void
  onPuxar: () => void
  /** Ausente em equipe encerrada: ali nao se move nada. */
  onMover?: (origem: string) => void
}) {
  const membros = carteira?.membros || []
  const protegido = resumoProtegidos(carteira?.protegidos || [])
  // Desequilibrio e "sem leads livres" sairam daqui: sao PONTOS DE ATENCAO e vivem no topo do
  // detalhe da equipe, antes das metricas. Aqui ficaria duplicado.
  const podeCeder = Boolean(onMover) && membros.length >= 2
  const nicho = carteira?.equipe.nicho_nome || equipe.nicho_nome || 'este nicho'

  return (
    <Card
      titulo={`Carteira de ${nicho}`}
      descricao="Só os leads deste nicho. Todas as colunas contam leads e NÃO se somam: intocados e em andamento dividem o total; parados, follow-ups e reuniões são recortes que cruzam os dois."
      semPadding
    >
      {/* Falha aqui não derruba o detalhe da equipe — o resto da tela continua servindo. */}
      {erro && (
        <div className="mx-4 mb-3 rounded-lg border border-estado-danger/30 bg-estado-danger/5 px-3 py-2 text-sm text-estado-danger">
          {erro}{' '}
          <button onClick={onRecarregar} className="underline underline-offset-2">Tentar de novo</button>
        </div>
      )}

      {carregando && !carteira && (
        <div className="px-4 pb-4"><Carregando variante="bloco" texto="Carregando a carteira do nicho…" /></div>
      )}

      {carteira && membros.length === 0 && (
        <EstadoVazio
          titulo="Ninguém nesta equipe ainda"
          descricao={`Há ${carteira.disponiveis_para_puxar} lead${carteira.disponiveis_para_puxar === 1 ? '' : 's'} livre${carteira.disponiveis_para_puxar === 1 ? '' : 's'} em ${nicho} esperando alguém para trabalhar.`}
        />
      )}

      {carteira && membros.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-xs text-ink-3">
                  <th scope="col" className="px-4 py-2 font-medium">Pessoa</th>
                  {COLUNAS_CARTEIRA.map((c) => (
                    <th key={c.chave} scope="col" className="px-3 py-2 text-right font-medium" title={c.oQueMede}>
                      {c.rotulo}
                    </th>
                  ))}
                  {podeCeder && <th scope="col" className="px-3 py-2"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {membros.map((m) => (
                  <tr key={m.usuario_id} className="hover:bg-surface-3">
                    <td className="px-4 py-2 text-ink">{m.nome || 'sem nome'}</td>
                    {COLUNAS_CARTEIRA.map((c) => {
                      const v = valorDaCarteira(m, c)
                      return (
                        <td key={c.chave} className={`px-3 py-2 text-right tabular-nums ${TOM_CELULA[tomDaCarteira(c, v)]}`}>
                          {v}
                        </td>
                      )
                    })}
                    {podeCeder && (
                      <td className="px-3 py-2 text-right">
                        {/* Só quem TEM lead do nicho pode ceder; quem não tem não ganha botão inerte. */}
                        {(m.leads || 0) > 0 && onMover && (
                          <button
                            type="button"
                            onClick={() => onMover(String(m.usuario_id))}
                            className="text-xs text-brand underline-offset-2 hover:underline"
                            aria-label={`Mover leads de ${m.nome || 'sem nome'}`}
                          >
                            Mover
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {/* A fila de LIVRES é linha própria: é o que a equipe ainda pode puxar, e sem ela
                    a soma das linhas não fecharia com a carteira do nicho. */}
                <tr className="bg-surface-2 text-ink-2">
                  <td className="px-4 py-2 font-medium" title="Leads deste nicho sem responsável. Não estão parados — estão na fila, disponíveis para a equipe.">
                    Na fila (sem responsável)
                  </td>
                  {COLUNAS_CARTEIRA.map((c) => (
                    <td key={c.chave} className="px-3 py-2 text-right tabular-nums">
                      {c.chave === 'parados' ? '—' : valorDaCarteira(carteira.livres, c)}
                    </td>
                  ))}
                  {podeCeder && <td className="px-3 py-2" />}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-2">
              <span className="font-semibold tabular-nums text-ink">{carteira.disponiveis_para_puxar}</span>{' '}
              {carteira.disponiveis_para_puxar === 1 ? 'lead livre e intocado' : 'leads livres e intocados'} para distribuir.{' '}
              {protegido && (
                <span className="text-ink-3">
                  {protegido.titulo} não entram: {protegido.itens.map((i) => `${i.total} ${i.rotulo}`).join(' · ')}.
                </span>
              )}
            </p>
            {equipe.status === 'ativa' && carteira.disponiveis_para_puxar > 0 && (
              <Botao tamanho="sm" onClick={onPuxar}>Puxar mais leads</Botao>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

// ─── Aba: Pessoas ─────────────────────────────────────────────────────────────────────────

function AbaPessoas({
  pessoas, total, papeis, equipes, filtros,
  onBusca, onEquipe, onPapel, onStatus, onLimpar, onVerAtividade,
}: {
  pessoas: PessoaArea[]
  total: number
  papeis: { id: string; rotulo: string }[]
  equipes: EquipeArea[]
  filtros: { busca: string; equipeId: string; papel: string; status: string }
  onBusca: (v: string) => void
  onEquipe: (v: string) => void
  onPapel: (v: string) => void
  onStatus: (v: string) => void
  onLimpar: () => void
  onVerAtividade: (p: PessoaArea) => void
}) {
  const entrada = 'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20'
  const filtrando = Boolean(filtros.busca || filtros.equipeId || filtros.papel || filtros.status !== 'ativos')

  return (
    <Card
      titulo="Todas as pessoas"
      descricao="Independente de equipe. É filtro de tela — não muda o que cada pessoa enxerga no sistema."
      semPadding
      acoes={filtrando ? <Botao tamanho="sm" onClick={onLimpar}>Limpar filtros</Botao> : undefined}
    >
      <div className="grid gap-2 px-5 pb-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="sr-only">Buscar pessoa por nome ou e-mail</span>
          <input
            type="search"
            value={filtros.busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail…"
            className={`w-full ${entrada}`}
          />
        </label>
        <label className="block">
          <span className="sr-only">Filtrar por equipe</span>
          <select value={filtros.equipeId} onChange={(e) => onEquipe(e.target.value)} className={`w-full ${entrada}`}>
            <option value="">Todas as equipes</option>
            <option value="sem_equipe">Sem equipe</option>
            {equipes.map((eq) => <option key={eq.id} value={String(eq.id)}>{eq.nome}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Filtrar por cargo</span>
          <select value={filtros.papel} onChange={(e) => onPapel(e.target.value)} className={`w-full ${entrada}`}>
            <option value="">Todos os cargos</option>
            {papeis.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Filtrar por situação do acesso</span>
          <select value={filtros.status} onChange={(e) => onStatus(e.target.value)} className={`w-full ${entrada}`}>
            {OPCOES_STATUS_PESSOA.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </label>
      </div>

      {pessoas.length === 0 ? (
        <EstadoVazio
          titulo={filtrando ? 'Nenhuma pessoa com estes filtros' : 'Nenhuma pessoa nesta empresa ainda'}
          descricao={
            filtrando
              ? 'Limpe os filtros para ver a lista inteira.'
              : 'Contas são criadas em Configurações › Contas da empresa.'
          }
          acao={filtrando ? <Botao tamanho="sm" onClick={onLimpar}>Limpar filtros</Botao> : undefined}
        />
      ) : (
        <>
          <TabelaPessoas membros={pessoas} comEquipe onVerAtividade={onVerAtividade} />
          <p className="border-t border-line px-5 py-2.5 text-xs text-ink-3">
            {resumoDoRecorte(total, pessoas.length)}
          </p>
        </>
      )}
    </Card>
  )
}

// ─── A tabela, usada nas duas abas ────────────────────────────────────────────────────────
//
// UMA tabela para "membros da equipe" e "todas as pessoas": são a mesma linha, com uma coluna a
// mais. Duas implementações divergiriam no primeiro ajuste de coluna.

function TabelaPessoas({
  membros, comEquipe, onVerAtividade,
}: {
  membros: PessoaArea[]
  comEquipe: boolean
  onVerAtividade: (p: PessoaArea) => void
}) {
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-ink-3">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">Pessoa</th>
            {comEquipe && <th scope="col" className="px-4 py-2 text-left font-medium">Equipe</th>}
            {COLUNAS_MEMBRO.map((c) => (
              <th key={c.chave} scope="col" className="px-3 py-2 text-right font-medium" title={c.oQueMede}>
                {c.rotulo}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Faturamento pago originado por esta pessoa no mês.">
              Faturamento
            </th>
            <th scope="col" className="px-4 py-2 text-left font-medium" title="Quando esta pessoa acessou esta empresa pela última vez.">
              Último acesso
            </th>
            <th scope="col" className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {membros.map((p) => {
            const aviso = avisoDeInativo(p)
            return (
              <tr key={p.usuario_id || p.nome} className={p.ativo === false ? 'bg-surface-2/60' : 'hover:bg-surface-2'}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink">{p.nome}</div>
                  {p.email && <div className="text-xs text-ink-3">{p.email}</div>}
                  <div className="text-xs text-ink-3">{rotuloPapel(p.papel)}</div>
                  {/* Desativar revoga o acesso e NÃO redistribui: sem este aviso a carteira
                      ficaria parada sem ninguém notar. */}
                  {aviso && <div className="mt-0.5 max-w-xs text-[11px] leading-snug text-estado-warn">{aviso}</div>}
                </td>
                {comEquipe && (
                  <td className="px-4 py-2.5 text-xs text-ink-2">
                    {p.equipe_atual ? p.equipe_atual.nome : <span className="text-ink-3">Sem equipe</span>}
                  </td>
                )}
                {COLUNAS_MEMBRO.map((c) => {
                  const v = valorDaColuna(p, c)
                  return (
                    <td key={c.chave} className={`px-3 py-2.5 text-right tabular-nums ${TOM_CELULA[tomDaColuna(c, v)]}`}>
                      {v}
                    </td>
                  )
                })}
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{formatarDinheiro(p.originado)}</td>
                <td className="px-4 py-2.5 text-xs text-ink-3">{rotuloUltimoAcesso(p.ultimo_acesso_em)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => onVerAtividade(p)}
                    className="text-xs text-brand underline-offset-2 hover:underline"
                  >
                    Atividade
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Linha do tempo de uma pessoa ─────────────────────────────────────────────────────────
//
// RASTREABILIDADE, não métrica. Ordem cronológica inversa, limite baixo, nenhum agregado: a
// migration 047 declara que a auditoria não deve ser fonte de dashboard. O `contexto` não é
// exibido cru; os módulos que o escrevem já o mantêm sem PII, mas exibi-lo aqui convidaria a
// tela a virar um visualizador de dado técnico do lead.

function ModalAtividade({ empresaId, pessoa, onFechar }: {
  empresaId: string
  pessoa: PessoaArea
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Atividade de ${pessoa.nome}`}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Atividade de {pessoa.nome}</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Últimas ações registradas. É rastreabilidade — não é medida de produtividade.
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="px-2 text-xl leading-none text-ink-3 hover:text-ink">×</button>
        </div>

        {carregando && <div className="flex justify-center py-8"><Spinner /></div>}
        {erro && <p className="mt-4 rounded-lg bg-estado-danger/5 px-3 py-2 text-sm text-estado-danger">{erro}</p>}
        {!carregando && !erro && eventos.length === 0 && (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-ink-3">
            Nenhuma ação registrada para esta pessoa nesta empresa.
          </p>
        )}

        {eventos.length > 0 && (
          <ul className="mt-4 space-y-2">
            {eventos.map((ev, i) => {
              const d = descreverAtividade(ev)
              return (
                <li key={ev.id || i} className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-2 text-xs last:border-0">
                  {/* Ação nova no servidor aparece como o slug que ela é — nunca como "—". */}
                  <span className={d.conhecida ? 'text-ink-2' : 'font-mono text-ink-3'}>{d.rotulo}</span>
                  {d.entidade && <span className="text-ink-3">({d.entidade})</span>}
                  <span className="ml-auto tabular-nums text-ink-3">{d.quando}</span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end">
          <Botao tamanho="sm" onClick={onFechar}>Fechar</Botao>
        </div>
      </div>
    </div>
  )
}
