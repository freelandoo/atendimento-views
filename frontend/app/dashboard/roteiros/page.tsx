'use client'
// Roteiros humanos versionados (módulo Prospecção & Inteligência Comercial).
// Lista lateral + editor de etapas por versão. Consome /api/empresas/:id/roteiros.
//
// DOIS ciclos de vida convivem aqui, e confundi-los é o erro fácil desta tela:
//   • VERSÃO (`rascunho | publicada | arquivada`): versão publicada é IMUTÁVEL — para editar,
//     cria-se uma nova versão. Regra do backend (src/db/roteiros.js).
//   • ROTEIRO (`rascunho | publicado | arquivado`): estado do cabeçalho, guardado em
//     `app.roteiros.ativo`. NÃO é derivável do status das versões — `publicarVersao` arquiva
//     a versão publicada anterior sozinha, então quase todo roteiro saudável tem versão
//     arquivada sem estar arquivado.
// Quem resolve os dois é `lib/roteiros-lista.js` (puro e testado); aqui é só desenho.
//
// NÃO EXISTE EXCLUSÃO DE ROTEIRO, de propósito. As FKs de histórico (app.ligacoes,
// ligacao_etapas/sinais/objecoes/perguntas, campanhas.roteiro_versao_id) são ON DELETE SET
// NULL: um DELETE não seria barrado pelo banco — ele desligaria em silêncio as ligações já
// realizadas do roteiro que as gerou. Arquivar é a operação segura equivalente, e é
// reversível. Não reintroduza um botão de excluir aqui.
//
// "Copiar contexto para IA" (ao lado do selo da versão publicada): monta um JSON da versão
// EXIBIDA e copia para a área de transferência, para o operador colar numa IA externa e pedir
// sugestões. É export MANUAL — não chama provedor de IA, não envia nada para fora e não
// escreve no banco. Montagem do JSON em lib/roteiro-contexto-ia.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import {
  IconPlus, IconTrash, IconSend, IconClose, IconCopySparkle, IconArchive, IconUndo, IconChevron,
} from '@/components/ui/icons'
import ModalConfirmar from '@/components/ui/ModalConfirmar'
import { podeExportarContextoIA, serializarContextoIA } from '@/lib/roteiro-contexto-ia'
import {
  montarListaRoteiros, statusDoRoteiro, versaoInicial, acoesDoRoteiro, textoConfirmacao,
  rotuloStatusRoteiro, fraseStatusRoteiro, rotuloStatusVersao, fraseStatusVersao,
  type StatusRoteiro, type RoteiroComStatus,
} from '@/lib/roteiros-lista'

const TIPOS: { v: EtapaTipo; label: string }[] = [
  { v: 'abertura', label: 'Abertura' }, { v: 'permissao', label: 'Permissão' },
  { v: 'situacao', label: 'Situação' }, { v: 'descoberta', label: 'Descoberta' },
  { v: 'problema', label: 'Problema' }, { v: 'implicacao', label: 'Implicação' },
  { v: 'insight', label: 'Insight' }, { v: 'qualificacao', label: 'Qualificação' },
  { v: 'objecoes', label: 'Objeções' }, { v: 'convite_reuniao', label: 'Convite p/ reunião' },
  { v: 'proxima_acao', label: 'Próxima ação' },
]
type EtapaTipo = 'abertura' | 'permissao' | 'situacao' | 'descoberta' | 'problema' | 'implicacao'
  | 'insight' | 'qualificacao' | 'objecoes' | 'convite_reuniao' | 'proxima_acao'
type StatusVersao = 'rascunho' | 'publicada' | 'arquivada'

type RoteiroLista = {
  id: string; nome: string; descricao: string | null; nicho: string | null; ativo: boolean
  versao_publicada: number | null; total_versoes: number
}
type Versao = { id: string; versao: number; status: StatusVersao; publicada_em: string | null }
type RoteiroDetalhe = RoteiroLista & { versoes: Versao[]; campanhas_usando?: number }
type Objecao = { objecao: string; resposta: string }
type Etapa = {
  ordem: number; tipo: EtapaTipo; titulo: string; objetivo: string; frase_sugerida: string
  perguntas: string[]; sinais_interesse: string[]; sinais_resistencia: string[]; objecoes: Objecao[]
}
type VersaoDetalhe = Versao & { roteiro_id: string; etapas: EtapaApi[] }
type EtapaApi = {
  ordem: number; tipo: EtapaTipo; titulo: string | null; objetivo: string | null; frase_sugerida: string | null
  perguntas_json: string[]; sinais_interesse_json: string[]; sinais_resistencia_json: string[]; objecoes_json: Objecao[]
}

// Cor é REFORÇO, nunca a informação: todo selo carrega o rótulo em texto ao lado.
const STATUS_ROTEIRO_STYLE: Record<StatusRoteiro, string> = {
  rascunho: 'bg-amber-100 text-amber-800 border-amber-200',
  publicado: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  arquivado: 'bg-slate-100 text-slate-600 border-slate-200',
}
const STATUS_VERSAO_STYLE: Record<StatusVersao, string> = {
  rascunho: 'bg-amber-100 text-amber-800 border-amber-200',
  publicada: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  arquivada: 'bg-slate-100 text-slate-600 border-slate-200',
}

// Cópia direta (sem modal): Clipboard API quando o navegador permite (exige contexto
// seguro/HTTPS) e, se ela falhar, o caminho legado execCommand. Se os dois falharem, a
// tela mostra o JSON para cópia manual — o conteúdo nunca se perde.
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true }
  } catch { /* segue para o fallback */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

function etapaVazia(ordem: number): Etapa {
  return { ordem, tipo: 'abertura', titulo: '', objetivo: '', frase_sugerida: '', perguntas: [], sinais_interesse: [], sinais_resistencia: [], objecoes: [] }
}
function daApi(e: EtapaApi): Etapa {
  return {
    ordem: e.ordem, tipo: e.tipo, titulo: e.titulo || '', objetivo: e.objetivo || '', frase_sugerida: e.frase_sugerida || '',
    perguntas: e.perguntas_json || [], sinais_interesse: e.sinais_interesse_json || [],
    sinais_resistencia: e.sinais_resistencia_json || [], objecoes: e.objecoes_json || [],
  }
}
const msgErro = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao)

export default function RoteirosPage() {
  const fb = useFeedback()
  const base = `/api/empresas/${typeof window !== 'undefined' ? localStorage.getItem('empresa_id') : ''}/roteiros`

  const [roteiros, setRoteiros] = useState<RoteiroLista[]>([])
  const [loading, setLoading] = useState(true)
  const [listaErro, setListaErro] = useState<string | null>(null)

  // `selId` é a seleção do operador; `sel` é o que já chegou do servidor. Separá-los é o que
  // permite destacar a linha na hora e, ao mesmo tempo, não mostrar conteúdo antigo como se
  // fosse do roteiro novo.
  const [selId, setSelId] = useState<string | null>(null)
  const [sel, setSel] = useState<RoteiroDetalhe | null>(null)
  const [detalheCarregando, setDetalheCarregando] = useState(false)
  const [detalheErro, setDetalheErro] = useState<string | null>(null)

  const [versaoAtiva, setVersaoAtiva] = useState<VersaoDetalhe | null>(null)
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [novoAberto, setNovoAberto] = useState<{ nicho: string } | null>(null)
  const [arquivadosAbertos, setArquivadosAbertos] = useState(false)
  const [confirmacao, setConfirmacao] = useState<{ acao: 'arquivar' | 'desarquivar' } | null>(null)
  // JSON exibido para cópia MANUAL quando o navegador bloqueia a área de transferência.
  const [contextoManual, setContextoManual] = useState<string | null>(null)

  // Token de requisição: só a resposta do ÚLTIMO clique pode escrever na tela. Sem isto, uma
  // resposta lenta do roteiro A chegando depois da do roteiro B repintaria o painel com o
  // conteúdo de A sob o título de B — exatamente o que esta tela não pode fazer.
  const pedido = useRef(0)

  const carregar = useCallback(async () => {
    setLoading(true)
    setListaErro(null)
    try {
      const r = await apiFetch<RoteiroLista[]>(base)
      setRoteiros(r.data)
    } catch (e) { setListaErro(msgErro(e, 'Falha ao carregar os roteiros.')) }
    finally { setLoading(false) }
  }, [base])

  useEffect(() => { carregar() }, [carregar])

  const abrirRoteiro = useCallback(async (id: string, versaoDesejadaId?: string) => {
    const meu = ++pedido.current
    setSelId(id)
    setDetalheErro(null)
    setDetalheCarregando(true)
    // Limpa o conteúdo do roteiro anterior IMEDIATAMENTE — o painel entra em skeleton.
    setSel(null); setVersaoAtiva(null); setEtapas([]); setContextoManual(null)
    try {
      const r = await apiFetch<RoteiroDetalhe>(`${base}/${id}`)
      if (pedido.current !== meu) return
      setSel(r.data)
      const alvo = r.data.versoes.find((v) => v.id === versaoDesejadaId) || versaoInicial(r.data.versoes)
      if (alvo) {
        const rv = await apiFetch<VersaoDetalhe>(`${base}/versoes/${alvo.id}`)
        if (pedido.current !== meu) return
        setVersaoAtiva(rv.data)
        setEtapas(rv.data.etapas.map(daApi))
      }
    } catch (e) {
      if (pedido.current !== meu) return
      setDetalheErro(msgErro(e, 'Não foi possível carregar este roteiro.'))
    } finally {
      if (pedido.current === meu) setDetalheCarregando(false)
    }
  }, [base])

  // Troca de versão dentro do MESMO roteiro. Usa o mesmo token: trocar de roteiro no meio
  // desta busca invalida a resposta.
  const abrirVersao = useCallback(async (versaoId: string) => {
    const meu = ++pedido.current
    setDetalheCarregando(true)
    setDetalheErro(null)
    setVersaoAtiva(null); setEtapas([]); setContextoManual(null)
    try {
      const r = await apiFetch<VersaoDetalhe>(`${base}/versoes/${versaoId}`)
      if (pedido.current !== meu) return
      setVersaoAtiva(r.data)
      setEtapas(r.data.etapas.map(daApi))
    } catch (e) {
      if (pedido.current !== meu) return
      setDetalheErro(msgErro(e, 'Não foi possível carregar esta versão.'))
    } finally {
      if (pedido.current === meu) setDetalheCarregando(false)
    }
  }, [base])

  const lista = useMemo(() => montarListaRoteiros(roteiros), [roteiros])

  // Identificação do selecionado durante o carregamento: sai da LISTA (já em memória), não do
  // detalhe que ainda está vindo. É o que mantém nome e status visíveis no skeleton.
  const resumoSelecionado = useMemo(
    () => roteiros.find((r) => r.id === selId) || null,
    [roteiros, selId],
  )
  const nomeSelecionado = sel?.nome || resumoSelecionado?.nome || ''
  const statusRoteiro: StatusRoteiro = statusDoRoteiro(sel || resumoSelecionado)
  const acoes = acoesDoRoteiro({
    statusRoteiro,
    statusVersao: versaoAtiva?.status,
    carregando: detalheCarregando,
    temVersao: !!versaoAtiva,
  })
  const exportavel = acoes.podeExportar && podeExportarContextoIA(versaoAtiva)

  // Export MANUAL do roteiro publicado: serializa o que está na tela e copia. Não há
  // request, não há gravação — só leitura do estado local + área de transferência.
  const copiarContextoIA = useCallback(async () => {
    if (!sel || !versaoAtiva || !podeExportarContextoIA(versaoAtiva)) return
    let json: string
    try {
      json = serializarContextoIA({
        roteiro: { nome: sel.nome, descricao: sel.descricao, nicho: sel.nicho },
        versao: { versao: versaoAtiva.versao, status: versaoAtiva.status, publicada_em: versaoAtiva.publicada_em },
        etapas: etapas.map((e) => ({
          tipo: e.tipo, titulo: e.titulo, objetivo: e.objetivo, frase_sugerida: e.frase_sugerida,
          perguntas: e.perguntas, sinais_interesse: e.sinais_interesse,
          sinais_resistencia: e.sinais_resistencia, objecoes: e.objecoes,
        })),
        tiposDeEtapaPermitidos: TIPOS.map((t) => t.v),
      })
    } catch (e) {
      fb.toast(msgErro(e, 'Não foi possível montar o contexto.'), 'error')
      return
    }
    if (await copiarTexto(json)) {
      setContextoManual(null)
      fb.toast('Contexto copiado')
    } else {
      setContextoManual(json)
      fb.toast('Não foi possível copiar automaticamente — o conteúdo ficou abaixo para copiar à mão.', 'error')
    }
  }, [sel, versaoAtiva, etapas, fb])

  const salvarEtapas = useCallback(async () => {
    if (!versaoAtiva) return
    await fb.runTask(async () => {
      await apiFetch(`${base}/versoes/${versaoAtiva.id}/etapas`, {
        method: 'PUT',
        body: JSON.stringify({ etapas: etapas.map((e, i) => ({ ...e, ordem: i + 1 })) }),
      })
    }, { sucesso: 'Etapas salvas' })
  }, [base, versaoAtiva, etapas, fb])

  const publicar = useCallback(async () => {
    if (!versaoAtiva || !sel) return
    const versaoId = versaoAtiva.id
    await fb.runTask(async () => {
      await apiFetch(`${base}/versoes/${versaoId}/publicar`, { method: 'POST' })
      await carregar()
      await abrirRoteiro(sel.id, versaoId)
    }, { sucesso: 'Versão publicada' })
  }, [base, versaoAtiva, sel, fb, abrirRoteiro, carregar])

  const novaVersao = useCallback(async () => {
    if (!sel || !versaoAtiva) return
    const roteiroId = sel.id
    await fb.runTask(async () => {
      const r = await apiFetch<{ versao_id: string }>(`${base}/${roteiroId}/versoes`, {
        method: 'POST', body: JSON.stringify({ basear_em_versao_id: versaoAtiva.id }),
      })
      await carregar()
      // Abre já na versão nova: `abrirRoteiro` sozinho cairia na publicada (versaoInicial).
      await abrirRoteiro(roteiroId, r.data.versao_id)
    }, { sucesso: 'Nova versão criada (rascunho)' })
  }, [base, sel, versaoAtiva, fb, abrirRoteiro, carregar])

  // Arquivar/desarquivar: reversível, não apaga nada. A confirmação já explicou a consequência.
  const confirmarArquivamento = useCallback(async () => {
    if (!sel || !confirmacao) return
    const { acao } = confirmacao
    const roteiroId = sel.id
    setConfirmacao(null)
    await fb.runTask(async () => {
      await apiFetch(`${base}/${roteiroId}/${acao}`, { method: 'POST' })
      await carregar()
      await abrirRoteiro(roteiroId, versaoAtiva?.id)
    }, { sucesso: acao === 'arquivar' ? 'Roteiro arquivado' : 'Roteiro desarquivado' })
    // Arquivar esconde o roteiro da lista principal; abrir a seção evita que ele "suma".
    if (acao === 'arquivar') setArquivadosAbertos(true)
  }, [base, sel, confirmacao, versaoAtiva, fb, abrirRoteiro, carregar])

  // edição de etapas
  const upd = (i: number, patch: Partial<Etapa>) => setEtapas((a) => a.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const addEtapa = () => setEtapas((a) => [...a, etapaVazia(a.length + 1)])
  const rmEtapa = (i: number) => setEtapas((a) => a.filter((_, j) => j !== i))
  const mover = (i: number, dir: -1 | 1) => setEtapas((a) => {
    const j = i + dir; if (j < 0 || j >= a.length) return a
    const c = [...a];[c[i], c[j]] = [c[j], c[i]]; return c
  })

  const textos = confirmacao
    ? textoConfirmacao(confirmacao.acao, { nome: nomeSelecionado, campanhas_usando: sel?.campanhas_usando })
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Roteiros</h1>
          <p className="text-sm text-slate-500">
            Roteiros de venda estruturados e versionados. Versão publicada é imutável — para editar, crie uma nova versão.
          </p>
        </div>
        <button
          onClick={() => setNovoAberto({ nicho: '' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
        >
          <IconPlus className="h-4 w-4" /> Novo roteiro
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        {/* ───────── Lista lateral ───────── */}
        <nav className="rounded-2xl border bg-white p-2 shadow-sm" aria-label="Roteiros">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : listaErro ? (
            <div className="space-y-2 p-5 text-center">
              <p className="text-sm text-red-600">{listaErro}</p>
              <button onClick={carregar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Tentar novamente</button>
            </div>
          ) : roteiros.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">Nenhum roteiro. Crie o primeiro.</div>
          ) : (
            <div className="space-y-3">
              {lista.grupos.map((g) => (
                <div key={g.chave}>
                  <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
                    <h2 className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {g.rotulo} <span className="font-normal normal-case text-slate-300">· {g.itens.length}</span>
                    </h2>
                  </div>
                  <ul className="space-y-1">
                    {g.itens.map((r) => (
                      <li key={r.id}>
                        <ItemRoteiro roteiro={r} selecionado={selId === r.id} carregando={detalheCarregando && selId === r.id} onAbrir={() => abrirRoteiro(r.id)} />
                      </li>
                    ))}
                  </ul>
                  {/* O "Novo roteiro" do grupo já nasce com o nicho dele preenchido — é o
                      "Atendimento X > Novo roteiro" possível com os dados que existem. */}
                  {g.chave !== '__sem_nicho__' && (
                    <button
                      onClick={() => setNovoAberto({ nicho: g.rotulo })}
                      className="mt-1 w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-brand transition hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      + Novo roteiro em {g.rotulo}
                    </button>
                  )}
                </div>
              ))}

              {/* Arquivados: recolhido por padrão, no fim da lista. Preserva o acesso ao
                  histórico sem competir com o trabalho do dia. */}
              {lista.totalArquivados > 0 && (
                <div className="border-t pt-2">
                  <button
                    type="button"
                    onClick={() => setArquivadosAbertos((v) => !v)}
                    aria-expanded={arquivadosAbertos}
                    aria-controls="lista-roteiros-arquivados"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <IconChevron className={`h-4 w-4 shrink-0 transition-transform ${arquivadosAbertos ? '' : '-rotate-90'}`} />
                    <span className="flex-1">Arquivados</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{lista.totalArquivados}</span>
                  </button>
                  <ul id="lista-roteiros-arquivados" hidden={!arquivadosAbertos} className="mt-1 space-y-1">
                    {lista.arquivados.map((r) => (
                      <li key={r.id}>
                        <ItemRoteiro roteiro={r} selecionado={selId === r.id} carregando={detalheCarregando && selId === r.id} onAbrir={() => abrirRoteiro(r.id)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* ───────── Painel de detalhes ───────── */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          {!selId ? (
            <div className="flex h-64 items-center justify-center text-center text-slate-400">
              Selecione um roteiro para ver as versões e etapas.
            </div>
          ) : (
            <div className="space-y-4">
              {/* O cabeçalho é montado com o que já se sabe do roteiro selecionado, então ele
                  aparece completo ANTES do conteúdo chegar — a seleção nunca fica muda. */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-800">{nomeSelecionado || 'Carregando…'}</h2>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_ROTEIRO_STYLE[statusRoteiro]}`}>
                      {rotuloStatusRoteiro(statusRoteiro)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{fraseStatusRoteiro(statusRoteiro)}</p>
                  {sel?.descricao && <p className="mt-1 text-sm text-slate-500">{sel.descricao}</p>}
                </div>

                {/* Arquivar/desarquivar à direita do cabeçalho, separado das ações de conteúdo.
                    Não há excluir: ver o cabeçalho deste arquivo. */}
                <div className="flex shrink-0 items-center gap-2">
                  {acoes.podeArquivar && (
                    <button
                      type="button"
                      onClick={() => setConfirmacao({ acao: 'arquivar' })}
                      title="Arquivar roteiro"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                    >
                      <IconArchive className="h-4 w-4" />
                      <span className="hidden sm:inline">Arquivar</span>
                    </button>
                  )}
                  {acoes.podeDesarquivar && (
                    <button
                      type="button"
                      onClick={() => setConfirmacao({ acao: 'desarquivar' })}
                      title="Desarquivar roteiro"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                    >
                      <IconUndo className="h-4 w-4" />
                      <span className="hidden sm:inline">Desarquivar</span>
                    </button>
                  )}
                </div>
              </div>

              {detalheErro ? (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                  <p className="text-sm text-red-700">{detalheErro}</p>
                  <button
                    onClick={() => selId && abrirRoteiro(selId)}
                    className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : detalheCarregando ? (
                <SkeletonDetalhe />
              ) : (
                <>
                  {/* Seletor de versão + selo + export */}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-medium text-slate-500" htmlFor="seletor-versao">Versão</label>
                    <select
                      id="seletor-versao"
                      value={versaoAtiva?.id || ''}
                      onChange={(e) => abrirVersao(e.target.value)}
                      className="rounded-lg border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {(sel?.versoes || []).map((v) => (
                        <option key={v.id} value={v.id}>v{v.versao} · {rotuloStatusVersao(v.status)}</option>
                      ))}
                    </select>
                    {versaoAtiva && (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_VERSAO_STYLE[versaoAtiva.status]}`}>
                        {rotuloStatusVersao(versaoAtiva.status)}
                      </span>
                    )}
                    {exportavel && (
                      <button
                        type="button"
                        onClick={copiarContextoIA}
                        title="Copiar contexto para IA"
                        aria-label="Copiar contexto para IA"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1"
                      >
                        <IconCopySparkle className="h-4 w-4" />
                        <span className="hidden sm:inline">Copiar contexto para IA</span>
                      </button>
                    )}
                  </div>

                  {versaoAtiva && (
                    <p className="text-xs text-slate-500">{fraseStatusVersao(versaoAtiva.status)}</p>
                  )}

                  {/* Ações da versão */}
                  <div className="flex flex-wrap gap-2 border-b pb-3">
                    {acoes.podeEditar ? (
                      <>
                        <button onClick={addEtapa} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"><IconPlus className="mr-1 inline h-4 w-4" />Etapa</button>
                        <button onClick={salvarEtapas} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">Salvar etapas</button>
                        <button onClick={publicar} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"><IconSend className="h-4 w-4" />Publicar</button>
                      </>
                    ) : acoes.podeCriarVersao ? (
                      <button onClick={novaVersao} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1">Nova versão para editar</button>
                    ) : statusRoteiro === 'arquivado' ? (
                      <span className="self-center text-sm text-slate-500">Roteiro arquivado (somente leitura). Desarquive para voltar a editar.</span>
                    ) : (
                      <span className="self-center text-sm text-slate-500">Somente leitura.</span>
                    )}
                  </div>

                  {/* Cópia bloqueada pelo navegador: o conteúdo continua disponível aqui. */}
                  {contextoManual && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Contexto para IA — cópia manual">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-amber-900">
                          O navegador bloqueou a cópia automática (a área de transferência costuma exigir HTTPS).
                          Selecione o conteúdo abaixo e copie com <b>Ctrl+C</b>.
                        </p>
                        <button type="button" onClick={() => setContextoManual(null)} aria-label="Fechar contexto para cópia manual"
                          className="shrink-0 text-amber-700 hover:text-amber-900"><IconClose className="h-4 w-4" /></button>
                      </div>
                      <textarea readOnly rows={8} value={contextoManual} aria-label="Contexto do roteiro em JSON"
                        onFocus={(e) => e.currentTarget.select()}
                        className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-2 font-mono text-[11px] text-slate-700" />
                    </div>
                  )}

                  {/* Etapas */}
                  {etapas.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-400">{acoes.podeEditar ? 'Adicione a primeira etapa.' : 'Esta versão não tem etapas.'}</div>
                  ) : (
                    <div className="space-y-3">
                      {etapas.map((e, i) => (
                        <EtapaCard key={i} etapa={e} idx={i} total={etapas.length} editavel={acoes.podeEditar}
                          onChange={(p) => upd(i, p)} onRemove={() => rmEtapa(i)} onMover={(d) => mover(i, d)} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {novoAberto && (
        <ModalNovo
          base={base}
          nichoInicial={novoAberto.nicho}
          onFechar={() => setNovoAberto(null)}
          onCriado={async (id) => { setNovoAberto(null); await carregar(); await abrirRoteiro(id) }}
          fb={fb}
        />
      )}

      {textos && (
        <ModalConfirmar
          titulo={textos.titulo}
          corpo={textos.corpo}
          aviso={textos.aviso}
          rotuloConfirmar={textos.confirmar}
          onConfirmar={confirmarArquivamento}
          onCancelar={() => setConfirmacao(null)}
        />
      )}
    </div>
  )
}

/** Linha da lista lateral: selo compacto + estado de carregamento do próprio item. */
function ItemRoteiro({ roteiro, selecionado, carregando, onAbrir }: {
  roteiro: RoteiroComStatus; selecionado: boolean; carregando: boolean; onAbrir: () => void
}) {
  const status = roteiro.status as StatusRoteiro
  return (
    <button
      onClick={onAbrir}
      aria-current={selecionado ? 'true' : undefined}
      className={`w-full rounded-xl p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
        selecionado ? 'bg-brand/10 ring-1 ring-brand/30' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{roteiro.nome}</span>
        {carregando ? (
          <span className="shrink-0 text-[10px] font-medium text-slate-400">carregando…</span>
        ) : (
          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_ROTEIRO_STYLE[status]}`}>
            {rotuloStatusRoteiro(status)}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-slate-400">
        {roteiro.total_versoes} versão(ões){roteiro.versao_publicada ? ` · v${roteiro.versao_publicada} publicada` : ''}
      </div>
    </button>
  )
}

/** Esqueleto do painel: ocupa o mesmo espaço do conteúdo real, sem repetir o do anterior. */
function SkeletonDetalhe() {
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Carregando o roteiro selecionado…</span>
      <div className="flex gap-2">
        <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="border-b pb-3"><div className="h-8 w-48 animate-pulse rounded-lg bg-slate-100" /></div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-xl border p-3">
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="grid gap-2 md:grid-cols-2">
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EtapaCard({ etapa, idx, total, editavel, onChange, onRemove, onMover }: {
  etapa: Etapa; idx: number; total: number; editavel: boolean
  onChange: (p: Partial<Etapa>) => void; onRemove: () => void; onMover: (d: -1 | 1) => void
}) {
  const inputCls = 'w-full rounded-lg border px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500'
  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">#{idx + 1}</span>
        <select value={etapa.tipo} disabled={!editavel} onChange={(ev) => onChange({ tipo: ev.target.value as EtapaTipo })} className="rounded-lg border px-2 py-1 text-sm disabled:bg-slate-50">
          {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <input className={inputCls} placeholder="Título (opcional)" value={etapa.titulo} disabled={!editavel} onChange={(e) => onChange({ titulo: e.target.value })} />
        {editavel && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => onMover(-1)} disabled={idx === 0} aria-label="Mover etapa para cima" className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">▲</button>
            <button onClick={() => onMover(1)} disabled={idx === total - 1} aria-label="Mover etapa para baixo" className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">▼</button>
            <button onClick={onRemove} aria-label="Remover etapa" className="rounded px-1.5 py-1 text-red-400 hover:bg-red-50"><IconTrash className="h-4 w-4" /></button>
          </div>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <textarea className={inputCls} rows={2} placeholder="Objetivo da etapa" value={etapa.objetivo} disabled={!editavel} onChange={(e) => onChange({ objetivo: e.target.value })} />
        <textarea className={inputCls} rows={2} placeholder="Frase sugerida" value={etapa.frase_sugerida} disabled={!editavel} onChange={(e) => onChange({ frase_sugerida: e.target.value })} />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <ListaEditavel titulo="Perguntas" itens={etapa.perguntas} editavel={editavel} onChange={(v) => onChange({ perguntas: v })} />
        <ListaEditavel titulo="Sinais de interesse" itens={etapa.sinais_interesse} editavel={editavel} onChange={(v) => onChange({ sinais_interesse: v })} />
        <ListaEditavel titulo="Sinais de resistência" itens={etapa.sinais_resistencia} editavel={editavel} onChange={(v) => onChange({ sinais_resistencia: v })} />
      </div>
      <ObjecoesEditor objecoes={etapa.objecoes} editavel={editavel} onChange={(v) => onChange({ objecoes: v })} />
    </div>
  )
}

function ListaEditavel({ titulo, itens, editavel, onChange }: { titulo: string; itens: string[]; editavel: boolean; onChange: (v: string[]) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{titulo}</div>
      <div className="space-y-1">
        {itens.map((it, i) => (
          <div key={i} className="flex gap-1">
            <input className="w-full rounded border px-2 py-1 text-xs disabled:bg-slate-50" value={it} disabled={!editavel}
              aria-label={`${titulo} ${i + 1}`}
              onChange={(e) => onChange(itens.map((x, j) => (j === i ? e.target.value : x)))} />
            {editavel && <button onClick={() => onChange(itens.filter((_, j) => j !== i))} aria-label={`Remover ${titulo} ${i + 1}`} className="text-red-400">×</button>}
          </div>
        ))}
        {editavel && <button onClick={() => onChange([...itens, ''])} className="text-xs text-brand hover:underline">+ adicionar</button>}
      </div>
    </div>
  )
}

function ObjecoesEditor({ objecoes, editavel, onChange }: { objecoes: Objecao[]; editavel: boolean; onChange: (v: Objecao[]) => void }) {
  if (!editavel && objecoes.length === 0) return null
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs font-medium text-slate-500">Objeções e respostas</div>
      <div className="space-y-1">
        {objecoes.map((o, i) => (
          <div key={i} className="flex gap-1">
            <input className="w-1/3 rounded border px-2 py-1 text-xs disabled:bg-slate-50" placeholder="Objeção" value={o.objecao} disabled={!editavel}
              aria-label={`Objeção ${i + 1}`}
              onChange={(e) => onChange(objecoes.map((x, j) => (j === i ? { ...x, objecao: e.target.value } : x)))} />
            <input className="w-2/3 rounded border px-2 py-1 text-xs disabled:bg-slate-50" placeholder="Resposta" value={o.resposta} disabled={!editavel}
              aria-label={`Resposta ${i + 1}`}
              onChange={(e) => onChange(objecoes.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)))} />
            {editavel && <button onClick={() => onChange(objecoes.filter((_, j) => j !== i))} aria-label={`Remover objeção ${i + 1}`} className="text-red-400">×</button>}
          </div>
        ))}
        {editavel && <button onClick={() => onChange([...objecoes, { objecao: '', resposta: '' }])} className="text-xs text-brand hover:underline">+ objeção</button>}
      </div>
    </div>
  )
}

function ModalNovo({ base, nichoInicial, onFechar, onCriado, fb }: {
  base: string; nichoInicial: string; onFechar: () => void; onCriado: (id: string) => void; fb: ReturnType<typeof useFeedback>
}) {
  const [nome, setNome] = useState('')
  const [nicho, setNicho] = useState(nichoInicial)
  const [descricao, setDescricao] = useState('')
  const primeiro = useRef<HTMLInputElement>(null)
  const origem = useRef<HTMLElement | null>(null)

  useEffect(() => {
    origem.current = document.activeElement as HTMLElement | null
    primeiro.current?.focus()
    return () => { origem.current?.focus?.() }
  }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  const criar = async () => {
    if (!nome.trim()) { fb.toast('Informe o nome', 'error'); return }
    await fb.runTask(async () => {
      const r = await apiFetch<{ roteiro_id: string }>(base, { method: 'POST', body: JSON.stringify({ nome: nome.trim(), nicho: nicho.trim() || undefined, descricao: descricao.trim() || undefined }) })
      onCriado(r.data.roteiro_id)
    }, { sucesso: 'Roteiro criado' })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="modal-novo-roteiro" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 id="modal-novo-roteiro" className="text-lg font-semibold">Novo roteiro{nichoInicial ? ` · ${nichoInicial}` : ''}</h3>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600"><IconClose className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input ref={primeiro} className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nome do roteiro" aria-label="Nome do roteiro" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nicho (ex.: barbearia)" aria-label="Nicho" value={nicho} onChange={(e) => setNicho(e.target.value)} />
          <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} placeholder="Descrição (opcional)" aria-label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
          <button onClick={criar} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">Criar</button>
        </div>
      </div>
    </div>
  )
}
