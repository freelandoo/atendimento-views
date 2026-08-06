'use client'
// Roteiros humanos versionados (módulo Prospecção & Inteligência Comercial).
// Lista de roteiros + editor de etapas por versão. Regra: versão PUBLICADA é read-only
// (imutável); para editar, cria-se uma NOVA versão. Consome /api/empresas/:id/roteiros.
//
// "Copiar contexto para IA" (ao lado do selo da versão publicada): monta um JSON da
// versão EXIBIDA e copia para a área de transferência, para o operador colar numa IA
// externa e pedir sugestões. É export MANUAL — não chama provedor de IA, não envia nada
// para fora e não escreve no banco. Montagem do JSON em lib/roteiro-contexto-ia.js.
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import { IconPlus, IconTrash, IconSend, IconClose, IconCopySparkle } from '@/components/ui/icons'
import { podeExportarContextoIA, serializarContextoIA } from '@/lib/roteiro-contexto-ia'

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
  id: string; nome: string; descricao: string | null; nicho: string | null
  versao_publicada: number | null; total_versoes: number
}
type Versao = { id: string; versao: number; status: StatusVersao; publicada_em: string | null }
type RoteiroDetalhe = RoteiroLista & { versoes: Versao[] }
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

const STATUS_STYLE: Record<StatusVersao, string> = {
  rascunho: 'bg-amber-100 text-amber-700', publicada: 'bg-emerald-100 text-emerald-700', arquivada: 'bg-slate-100 text-slate-500',
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

export default function RoteirosPage() {
  const fb = useFeedback()
  const base = `/api/empresas/${typeof window !== 'undefined' ? localStorage.getItem('empresa_id') : ''}/roteiros`

  const [roteiros, setRoteiros] = useState<RoteiroLista[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<RoteiroDetalhe | null>(null)
  const [versaoAtiva, setVersaoAtiva] = useState<VersaoDetalhe | null>(null)
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [novoAberto, setNovoAberto] = useState(false)
  // JSON exibido para cópia MANUAL quando o navegador bloqueia a área de transferência.
  const [contextoManual, setContextoManual] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch<RoteiroLista[]>(base)
      setRoteiros(r.data)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao carregar', 'error') }
    finally { setLoading(false) }
  }, [base, fb])

  useEffect(() => { carregar() }, [carregar])

  const abrirRoteiro = useCallback(async (id: string) => {
    try {
      const r = await apiFetch<RoteiroDetalhe>(`${base}/${id}`)
      setSel(r.data)
      const v = r.data.versoes[0]
      if (v) await abrirVersao(v.id)
      else { setVersaoAtiva(null); setEtapas([]) }
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha', 'error') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, fb])

  const abrirVersao = useCallback(async (versaoId: string) => {
    const r = await apiFetch<VersaoDetalhe>(`${base}/versoes/${versaoId}`)
    setVersaoAtiva(r.data)
    setEtapas(r.data.etapas.map(daApi))
    setContextoManual(null)
  }, [base])

  const editavel = versaoAtiva?.status === 'rascunho'
  const exportavel = podeExportarContextoIA(versaoAtiva)

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
      fb.toast(e instanceof Error ? e.message : 'Não foi possível montar o contexto.', 'error')
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
    await fb.runTask(async () => {
      await apiFetch(`${base}/versoes/${versaoAtiva.id}/publicar`, { method: 'POST' })
      await abrirRoteiro(sel.id); await carregar()
    }, { sucesso: 'Versão publicada' })
  }, [base, versaoAtiva, sel, fb, abrirRoteiro, carregar])

  const novaVersao = useCallback(async () => {
    if (!sel || !versaoAtiva) return
    await fb.runTask(async () => {
      const r = await apiFetch<{ versao_id: string }>(`${base}/${sel.id}/versoes`, {
        method: 'POST', body: JSON.stringify({ basear_em_versao_id: versaoAtiva.id }),
      })
      await abrirRoteiro(sel.id); await carregar()
      await abrirVersao(r.data.versao_id)
    }, { sucesso: 'Nova versão criada (rascunho)' })
  }, [base, sel, versaoAtiva, fb, abrirRoteiro, abrirVersao, carregar])

  // edição de etapas
  const upd = (i: number, patch: Partial<Etapa>) => setEtapas((a) => a.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const addEtapa = () => setEtapas((a) => [...a, etapaVazia(a.length + 1)])
  const rmEtapa = (i: number) => setEtapas((a) => a.filter((_, j) => j !== i))
  const mover = (i: number, dir: -1 | 1) => setEtapas((a) => {
    const j = i + dir; if (j < 0 || j >= a.length) return a
    const c = [...a];[c[i], c[j]] = [c[j], c[i]]; return c
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roteiros</h1>
          <p className="text-sm text-slate-500">Roteiros de venda estruturados e versionados. Versão publicada é imutável — para editar, crie uma nova versão.</p>
        </div>
        <button onClick={() => setNovoAberto(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          <IconPlus className="h-4 w-4" /> Novo roteiro
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        {/* Lista */}
        <div className="rounded-2xl border bg-white p-2 shadow-sm">
          {loading ? <div className="flex justify-center py-10"><Spinner /></div>
            : roteiros.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">Nenhum roteiro. Crie o primeiro.</div>
              : roteiros.map((r) => (
                <button key={r.id} onClick={() => abrirRoteiro(r.id)}
                  className={`w-full rounded-xl p-3 text-left transition ${sel?.id === r.id ? 'bg-brand/10' : 'hover:bg-slate-50'}`}>
                  <div className="font-medium text-slate-800">{r.nome}</div>
                  <div className="text-xs text-slate-400">
                    {r.nicho || 'sem nicho'} · {r.total_versoes} versão(ões){r.versao_publicada ? ` · v${r.versao_publicada} publicada` : ''}
                  </div>
                </button>
              ))}
        </div>

        {/* Editor */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          {!sel ? (
            <div className="flex h-64 items-center justify-center text-slate-400">Selecione um roteiro para ver as versões e etapas.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{sel.nome}</div>
                  {sel.descricao && <div className="text-sm text-slate-500">{sel.descricao}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={versaoAtiva?.id || ''}
                    onChange={(e) => abrirVersao(e.target.value)}
                    className="rounded-lg border px-2 py-1.5 text-sm"
                  >
                    {sel.versoes.map((v) => <option key={v.id} value={v.id}>v{v.versao} · {v.status}</option>)}
                  </select>
                  {versaoAtiva && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[versaoAtiva.status]}`}>{versaoAtiva.status}</span>}
                  {/* Só aparece com versão PUBLICADA — é a única fonte de verdade do export. */}
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
              </div>

              {/* Ações da versão */}
              <div className="flex flex-wrap gap-2 border-b pb-3">
                {editavel ? (
                  <>
                    <button onClick={addEtapa} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"><IconPlus className="mr-1 inline h-4 w-4" />Etapa</button>
                    <button onClick={salvarEtapas} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">Salvar etapas</button>
                    <button onClick={publicar} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"><IconSend className="h-4 w-4" />Publicar</button>
                  </>
                ) : (
                  <>
                    <span className="self-center text-sm text-slate-500">Versão {versaoAtiva?.status} (somente leitura).</span>
                    <button onClick={novaVersao} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">Nova versão para editar</button>
                  </>
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
                <div className="py-10 text-center text-sm text-slate-400">{editavel ? 'Adicione a primeira etapa.' : 'Esta versão não tem etapas.'}</div>
              ) : (
                <div className="space-y-3">
                  {etapas.map((e, i) => (
                    <EtapaCard key={i} etapa={e} idx={i} total={etapas.length} editavel={!!editavel}
                      onChange={(p) => upd(i, p)} onRemove={() => rmEtapa(i)} onMover={(d) => mover(i, d)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {novoAberto && <ModalNovo base={base} onFechar={() => setNovoAberto(false)} onCriado={async (id) => { setNovoAberto(false); await carregar(); await abrirRoteiro(id) }} fb={fb} />}
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
            <button onClick={() => onMover(-1)} disabled={idx === 0} className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">▲</button>
            <button onClick={() => onMover(1)} disabled={idx === total - 1} className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">▼</button>
            <button onClick={onRemove} className="rounded px-1.5 py-1 text-red-400 hover:bg-red-50"><IconTrash className="h-4 w-4" /></button>
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
              onChange={(e) => onChange(itens.map((x, j) => (j === i ? e.target.value : x)))} />
            {editavel && <button onClick={() => onChange(itens.filter((_, j) => j !== i))} className="text-red-400">×</button>}
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
              onChange={(e) => onChange(objecoes.map((x, j) => (j === i ? { ...x, objecao: e.target.value } : x)))} />
            <input className="w-2/3 rounded border px-2 py-1 text-xs disabled:bg-slate-50" placeholder="Resposta" value={o.resposta} disabled={!editavel}
              onChange={(e) => onChange(objecoes.map((x, j) => (j === i ? { ...x, resposta: e.target.value } : x)))} />
            {editavel && <button onClick={() => onChange(objecoes.filter((_, j) => j !== i))} className="text-red-400">×</button>}
          </div>
        ))}
        {editavel && <button onClick={() => onChange([...objecoes, { objecao: '', resposta: '' }])} className="text-xs text-brand hover:underline">+ objeção</button>}
      </div>
    </div>
  )
}

function ModalNovo({ base, onFechar, onCriado, fb }: { base: string; onFechar: () => void; onCriado: (id: string) => void; fb: ReturnType<typeof useFeedback> }) {
  const [nome, setNome] = useState('')
  const [nicho, setNicho] = useState('')
  const [descricao, setDescricao] = useState('')
  const criar = async () => {
    if (!nome.trim()) { fb.toast('Informe o nome', 'error'); return }
    await fb.runTask(async () => {
      const r = await apiFetch<{ roteiro_id: string }>(base, { method: 'POST', body: JSON.stringify({ nome: nome.trim(), nicho: nicho.trim() || undefined, descricao: descricao.trim() || undefined }) })
      onCriado(r.data.roteiro_id)
    }, { sucesso: 'Roteiro criado' })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Novo roteiro</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600"><IconClose className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nome do roteiro" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="Nicho (ex.: barbearia)" value={nicho} onChange={(e) => setNicho(e.target.value)} />
          <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
          <button onClick={criar} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white">Criar</button>
        </div>
      </div>
    </div>
  )
}
