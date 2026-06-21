'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'

// ─── Tipos ───────────────────────────────────────────────────────────────────
export type Contexto = {
  id: string
  nome: string
  conteudo: string
  contexto_form_json: Record<string, string>
  criado_em: string
  runtime_ativo?: boolean
  thumbnail_url?: string | null
}
type Versao = {
  id: string
  versao: number
  conteudo_json: Record<string, unknown>
  conteudo_markdown: string | null
  gerado_por: string
  status: 'rascunho' | 'ativo' | 'arquivado'
  criado_em: string
  ativado_em: string | null
  playbook_schema_version: string | null
}
type Fonte = {
  id: string
  tipo: 'site' | 'pdf' | 'documento' | 'texto_manual'
  url: string | null
  filename: string | null
  titulo: string | null
  status: 'pendente' | 'analisando' | 'analisado' | 'erro'
  erro: string | null
  tem_conteudo: boolean
  conteudo_chars: number
  resumo_json: Record<string, unknown>
  created_at: string
  updated_at: string
}
type SugestaoCtx1 = {
  sugestao: Record<string, unknown>
  contexto_atual: Record<string, string>
}

const CONTEXTO1_FIELDS: { name: string; label: string; type?: 'text' | 'textarea' }[] = [
  { name: 'nome_empresa', label: 'Nome da empresa' },
  { name: 'tipo_negocio', label: 'Tipo de negócio' },
  { name: 'nicho', label: 'Nicho' },
  { name: 'cidade_regiao', label: 'Cidade / Região' },
  { name: 'proposta_de_valor', label: 'Proposta de valor', type: 'textarea' },
  { name: 'como_funciona', label: 'Como funciona', type: 'textarea' },
  { name: 'servicos_produtos', label: 'Serviços / Produtos', type: 'textarea' },
  { name: 'maquinas_modulos_funcionalidades', label: 'Máquinas / Módulos / Funcionalidades', type: 'textarea' },
  { name: 'precos_planos', label: 'Preços / Planos', type: 'textarea' },
  { name: 'plano_gratuito', label: 'Plano gratuito (existe? quais limites?)' },
  { name: 'publico_alvo', label: 'Público-alvo' },
  { name: 'cliente_ideal', label: 'Cliente ideal' },
  { name: 'diferenciais', label: 'Diferenciais', type: 'textarea' },
  { name: 'diferenciais_competitivos', label: 'Diferenciais competitivos', type: 'textarea' },
  { name: 'problemas_que_resolve', label: 'Problemas que resolve', type: 'textarea' },
  { name: 'tom_de_voz', label: 'Tom de voz' },
  { name: 'horario_atendimento', label: 'Horário de atendimento' },
  { name: 'formas_pagamento', label: 'Formas de pagamento' },
  { name: 'objecoes_comuns', label: 'Objeções comuns', type: 'textarea' },
  { name: 'perguntas_frequentes', label: 'Perguntas frequentes', type: 'textarea' },
  { name: 'quando_chamar_humano', label: 'Quando chamar humano', type: 'textarea' },
  { name: 'ctas_principais', label: 'CTAs principais (botões)', type: 'textarea' },
  { name: 'link_principal', label: 'Link principal (site)' },
  { name: 'link_cadastro', label: 'Link de cadastro' },
  { name: 'link_login', label: 'Link de login' },
  { name: 'whatsapp', label: 'WhatsApp' },
  { name: 'telefone', label: 'Telefone' },
  { name: 'email', label: 'E-mail' },
  { name: 'instagram', label: 'Instagram' },
  { name: 'endereco', label: 'Endereço', type: 'textarea' },
  { name: 'links_uteis', label: 'Outros links úteis', type: 'textarea' },
  { name: 'informacoes_extras', label: 'Informações extras', type: 'textarea' },
]

const PLAYBOOK_TABS = [
  'resumo_empresa', 'tom_de_voz', 'servicos', 'dados_para_coletar',
  'fluxo_atendimento', 'respostas_base', 'regras_orcamento', 'regras_reuniao',
  'objecoes', 'lead_scoring', 'runtime_policy', 'aprendizado_continuo',
  'limites_da_ia', 'handoff',
]

// ─── Orquestrador — edita UM contexto (dono de uma instância) ─────────────────
export default function ContextoEditor({ empresaId, contextoId }: { empresaId: string; contextoId: string }) {
  const [contexto, setContexto] = useState<Contexto | null>(null)
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [gerando, setGerando] = useState(false)
  // Incrementado após o pipeline (gerar/analisar/remover fonte) pra forçar os
  // sub-cards (Fontes, Estágios) a recarregarem seus próprios dados.
  const [pipelineNonce, setPipelineNonce] = useState(0)
  const fb = useFeedback()

  const carregar = useCallback(async () => {
    if (!empresaId || !contextoId) return
    try {
      const r = await apiFetch<Contexto[]>(`/api/empresas/${empresaId}/contextos`)
      setContexto(r.data.find((c) => c.id === contextoId) || null)
    } catch {}
  }, [empresaId, contextoId])

  const carregarVersoes = useCallback(async () => {
    if (!empresaId || !contextoId) return
    try {
      const r = await apiFetch<Versao[]>(`/api/empresas/${empresaId}/contextos/${contextoId}/versoes`)
      setVersoes(r.data)
    } catch {}
  }, [empresaId, contextoId])

  useEffect(() => { carregar(); carregarVersoes() }, [carregar, carregarVersoes])

  async function gerarPlaybook() {
    setGerando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/gerar-playbook`, { method: 'POST' }), {
        pesada: true,
        sucesso: 'Playbook gerado',
        detalhe: 'Criado como rascunho. Revise no card "Playbook" e ative.',
      })
      await carregarVersoes()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setGerando(false) }
  }

  // Recarrega tudo que deriva das fontes e sinaliza os sub-cards via pipelineNonce.
  async function recarregarDerivados() {
    await carregar()
    await carregarVersoes()
    setPipelineNonce((n) => n + 1)
  }

  // "Analisar" = pipeline completo: analisa as fontes, preenche o Contexto 1, gera
  // os estágios e o playbook — tudo numa chamada — e recarrega os painéis.
  async function rodarPipeline() {
    setGerando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/gerar-tudo`, { method: 'POST', timeoutMs: 600000 }), {
        pesada: true,
        sucesso: 'Fontes analisadas',
        detalhe: 'Contexto 1, estágios e playbook gerados. Revise e ative.',
      })
      await recarregarDerivados()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setGerando(false) }
  }

  async function ativarVersao(versaoId: string) {
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/versoes/${versaoId}/ativar`, { method: 'POST' }),
        { sucesso: 'Versão ativada — o agente passa a usar esse playbook.' })
      await carregarVersoes()
    } catch { /* erro já exibido pelo feedback */ }
  }

  async function ativarContexto(ativar: boolean) {
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/${ativar ? 'ativar' : 'desativar'}`, { method: 'POST' }),
        { sucesso: ativar ? 'Contexto ativado.' : 'Contexto desativado.' })
      await carregar()
    } catch { /* erro já exibido pelo feedback */ }
  }

  if (!contexto) {
    return <p className="text-sm text-gray-400">Carregando contexto…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Contexto</h2>
          {contexto.runtime_ativo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ativo</span>}
        </div>
        {contexto.runtime_ativo ? (
          <button onClick={() => ativarContexto(false)} className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50">
            Desativar contexto
          </button>
        ) : (
          <button onClick={() => ativarContexto(true)} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
            Ativar contexto
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardFontes
          empresaId={empresaId}
          contextoId={contexto.id}
          contextoAtual={contexto.contexto_form_json || {}}
          reloadKey={pipelineNonce}
          onAnalisarTudo={() => rodarPipeline()}
          onAposRemover={() => recarregarDerivados()}
          onAplicarSugestao={async (novoForm) => {
            await apiFetch(`/api/empresas/${empresaId}/contextos/${contexto.id}`, {
              method: 'PUT',
              body: JSON.stringify({ contexto_form_json: novoForm }),
            })
            await carregar()
            fb.toast('Contexto 1 atualizado pela sugestão das fontes.')
          }}
        />
        <CardContexto1 empresaId={empresaId} contexto={contexto} onSalvo={carregar} />
        <CardPlaybook
          contextoId={contexto.id}
          versoes={versoes}
          gerando={gerando}
          onGerar={gerarPlaybook}
          onAtivar={ativarVersao}
          empresaId={empresaId}
        />
        <CardTeste empresaId={empresaId} contextoForm={contexto.contexto_form_json || {}} versaoAtiva={versoes.find((v) => v.status === 'ativo') || null} />
      </div>
      <CardEstagios empresaId={empresaId} contextoId={contexto.id} contextoNome={contexto.nome} reloadKey={pipelineNonce} onAtivacao={carregar} />
    </div>
  )
}

// ─── Card 1 — Fontes ─────────────────────────────────────────────────────────
function CardFontes({ empresaId, contextoId, contextoAtual, reloadKey, onAnalisarTudo, onAposRemover, onAplicarSugestao }: {
  empresaId: string
  contextoId: string
  contextoAtual: Record<string, unknown>
  reloadKey?: number
  onAnalisarTudo: () => Promise<void> | void
  onAposRemover: () => Promise<void> | void
  onAplicarSugestao: (novoForm: Record<string, string>) => Promise<void>
}) {
  const [fontes, setFontes] = useState<Fonte[]>([])
  const [tipo, setTipo] = useState<'link' | 'pdf' | 'texto'>('link')
  const [url, setUrl] = useState('')
  const [texto, setTexto] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [analisando, setAnalisando] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [sugestao, setSugestao] = useState<SugestaoCtx1 | null>(null)
  const [sugerindo, setSugerindo] = useState(false)
  const fb = useFeedback()

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Fonte[]>(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes`)
      setFontes(r.data || [])
    } catch {}
  }, [empresaId, contextoId])

  // reloadKey força recarregar as fontes após o pipeline (analisar/remover).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregar() }, [carregar, reloadKey])

  async function adicionar() {
    // Validação client-side antes de disparar (erros vão pro toast).
    let req: () => Promise<unknown>
    let limpar: () => void
    if (tipo === 'link') {
      if (!/^https?:\/\//i.test(url)) { fb.toast('URL precisa começar com http:// ou https://', 'error'); return }
      req = () => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/link`, { method: 'POST', body: JSON.stringify({ url }) })
      limpar = () => setUrl('')
    } else if (tipo === 'texto') {
      if (texto.trim().length < 10) { fb.toast('Cole pelo menos 10 caracteres.', 'error'); return }
      req = () => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/texto`, { method: 'POST', body: JSON.stringify({ texto }) })
      limpar = () => setTexto('')
    } else {
      if (!arquivo) { fb.toast('Selecione um arquivo PDF.', 'error'); return }
      const fd = new FormData()
      fd.append('arquivo', arquivo)
      req = () => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/documento`, { method: 'POST', body: fd })
      limpar = () => setArquivo(null)
    }
    setCarregando(true)
    try {
      await fb.runTask(req, { sucesso: 'Fonte adicionada.' })
      limpar()
      await carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setCarregando(false) }
  }

  // Analisar = pipeline completo (analisa as fontes pendentes, preenche Contexto 1,
  // gera estágios e playbook). O pai recarrega os painéis via pipelineNonce.
  async function analisar(fonteId: string) {
    setAnalisando(fonteId)
    setErro('')
    try {
      await onAnalisarTudo()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar.')
    } finally {
      setAnalisando(null)
    }
  }

  // Remover fonte = apaga + re-gera tudo das fontes restantes (ou limpa, se zerar).
  async function remover(fonteId: string) {
    if (!confirm('Remover esta fonte?\n\nO Contexto 1, os estágios e o playbook serão regerados a partir das fontes restantes (ou limpos, se não sobrar nenhuma). Pode levar 1-2 min.')) return
    setAnalisando(fonteId)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/${fonteId}`, { method: 'DELETE', timeoutMs: 600000 }), {
        pesada: true,
        sucesso: 'Fonte removida',
        detalhe: 'Contexto 1, estágios e playbook regerados a partir das fontes restantes.',
      })
      await onAposRemover()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setAnalisando(null) }
  }

  async function sugerir() {
    setSugerindo(true)
    try {
      const r = await fb.runTask(() => apiFetch<SugestaoCtx1>(`/api/empresas/${empresaId}/contextos/${contextoId}/sugerir-contexto1`, { method: 'POST' }),
        { sucesso: 'Sugestão gerada.' })
      setSugestao(r.data)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSugerindo(false) }
  }

  async function aplicarSugestao() {
    if (!sugestao) return
    const novoForm: Record<string, string> = normalizarFormContexto(sugestao.contexto_atual || {})
    for (const f of CONTEXTO1_FIELDS) {
      const atual = (novoForm[f.name] || '').trim()
      const novo = normalizarValorContexto((sugestao.sugestao as Record<string, unknown>)?.[f.name]).trim()
      if (!atual && novo) novoForm[f.name] = novo
    }
    await onAplicarSugestao(novoForm)
    setSugestao(null)
  }

  const analisadas = fontes.filter((f) => f.status === 'analisado').length
  const statsFontes = fontes
    .filter((f) => f.status === 'analisado')
    .reduce((acc, fonte) => {
      const resumo = (fonte.resumo_json || {}) as Record<string, unknown>
      const meta = (resumo.meta || {}) as Record<string, unknown>
      const crawlStats = (meta.crawl_stats || {}) as Record<string, unknown>
      const paginasLidas = Number(crawlStats.paginas_lidas || meta.paginas_crawladas || 0)
      const linksInternos = Number(crawlStats.links_internos_descobertos || 0)
      const linksExternos = Number(crawlStats.links_externos_uteis || 0)
      return {
        sites: acc.sites + (fonte.tipo === 'site' ? 1 : 0),
        paginas: acc.paginas + (Number.isFinite(paginasLidas) ? paginasLidas : 0),
        links: acc.links + (Number.isFinite(linksInternos) ? linksInternos : 0) + (Number.isFinite(linksExternos) ? linksExternos : 0),
      }
    }, { sites: 0, paginas: 0, links: 0 })
  const contextoBaseStats = normalizarFormContexto(sugestao?.contexto_atual || contextoAtual)
  const camposPreenchidosStats = CONTEXTO1_FIELDS.filter((f) => (contextoBaseStats[f.name] || '').trim()).length
  const labelFontesStats = statsFontes.sites > 0
    ? `${statsFontes.sites} site${statsFontes.sites === 1 ? '' : 's'} analisado${statsFontes.sites === 1 ? '' : 's'}`
    : `${analisadas} fonte${analisadas === 1 ? '' : 's'} analisada${analisadas === 1 ? '' : 's'}`

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Fontes de informação</h3>
        <span className="text-xs text-gray-500">{analisadas}/{fontes.length} analisadas</span>
      </div>

      {analisadas > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          {labelFontesStats} · {statsFontes.paginas} página{statsFontes.paginas === 1 ? '' : 's'} lida{statsFontes.paginas === 1 ? '' : 's'} · {statsFontes.links} link{statsFontes.links === 1 ? '' : 's'} encontrado{statsFontes.links === 1 ? '' : 's'} · {camposPreenchidosStats}/{CONTEXTO1_FIELDS.length} campos preenchidos
        </div>
      )}

      <div className="space-y-2">
        <div className="flex gap-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as 'link' | 'pdf' | 'texto')} className="border rounded-lg px-2 py-1.5 text-xs">
            <option value="link">Link do site</option>
            <option value="pdf">PDF / Documento</option>
            <option value="texto">Texto manual</option>
          </select>
          {tipo === 'link' && (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="flex-1 border rounded-lg px-2 py-1.5 text-xs" />
          )}
          {tipo === 'pdf' && (
            <input type="file" accept=".pdf,.txt" onChange={(e) => setArquivo(e.target.files?.[0] || null)} className="flex-1 text-xs" />
          )}
          <button onClick={adicionar} disabled={carregando} className="bg-brand text-white px-3 py-1.5 rounded-lg text-xs disabled:opacity-50">
            {carregando ? '…' : 'Inserir'}
          </button>
        </div>
        {tipo === 'texto' && (
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} placeholder="Cole o texto…" className="w-full border rounded-lg px-2 py-1.5 text-xs" />
        )}
      </div>

      {erro && <p className="text-xs text-red-600">{erro}</p>}

      <div className="space-y-1.5">
        {fontes.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">Nenhuma fonte ainda.</p>
        ) : (
          fontes.map((f) => (
            <div key={f.id} className="border rounded-lg p-2 text-xs flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                f.status === 'analisado' ? 'bg-green-100 text-green-700'
                  : f.status === 'analisando' ? 'bg-amber-100 text-amber-700'
                  : f.status === 'erro' ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>{f.status}</span>
              <span className="flex-1 truncate" title={f.url || f.filename || f.titulo || ''}>
                <span className="text-gray-500 mr-1">[{f.tipo}]</span>
                {f.titulo || f.url || f.filename || '(sem título)'}
              </span>
              {f.status === 'pendente' && f.tem_conteudo && (
                <button onClick={() => analisar(f.id)} disabled={analisando !== null} title="Analisa e já gera Contexto 1 + estágios + playbook" className="text-brand hover:underline disabled:opacity-50">
                  {analisando !== null ? 'Processando…' : 'Analisar'}
                </button>
              )}
              {f.status === 'erro' && (
                <button onClick={() => analisar(f.id)} disabled={analisando !== null} className="text-amber-600 hover:underline disabled:opacity-50" title={f.erro || ''}>
                  Tentar de novo
                </button>
              )}
              <button onClick={() => remover(f.id)} disabled={analisando !== null} className="text-gray-400 hover:text-red-600 disabled:opacity-50" title="Remover (regenera o resto)">×</button>
            </div>
          ))
        )}
      </div>

      {analisadas > 0 && !sugestao && (
        <button onClick={sugerir} disabled={sugerindo} className="w-full text-xs bg-gray-100 hover:bg-brand hover:text-white px-3 py-2 rounded-lg disabled:opacity-50">
          {sugerindo ? 'Consolidando com IA…' : `Sugerir Contexto 1 a partir de ${analisadas} fonte(s)`}
        </button>
      )}

      {sugestao && (
        <div className="border-2 border-brand rounded-lg p-3 space-y-2 bg-blue-50">
          <p className="text-xs font-semibold">Sugestão consolidada (preserva seus dados manuais)</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {CONTEXTO1_FIELDS.map((f) => {
              const novo = normalizarValorContexto((sugestao.sugestao as Record<string, unknown>)?.[f.name]).trim()
              const atual = normalizarValorContexto(sugestao.contexto_atual?.[f.name]).trim()
              if (!novo) return null
              const conflito = atual && atual !== novo
              return (
                <div key={f.name} className="text-[11px]">
                  <span className="font-medium text-gray-700">{f.label}:</span>{' '}
                  <span className={conflito ? 'text-amber-700' : 'text-gray-600'}>
                    {novo.slice(0, 200)}{novo.length > 200 ? '…' : ''}
                  </span>
                  {conflito && <span className="ml-1 text-amber-700">(⚠ atual: {atual.slice(0, 80)})</span>}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={aplicarSugestao} className="flex-1 text-xs bg-brand text-white px-3 py-1.5 rounded-lg">
              Aplicar (preserva dados manuais existentes)
            </button>
            <button onClick={() => setSugestao(null)} className="text-xs px-3 py-1.5 rounded-lg border">
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Normaliza qualquer valor (string/array/object) em string amigável pra exibir no form.
// Resolve [object Object] quando IA devolve links como { label, url } ou arrays.
function normalizarValorContexto(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    return v.map((x) => normalizarValorContexto(x)).filter(Boolean).join('\n')
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.label === 'string' && typeof o.url === 'string') return `${o.label}: ${o.url}`
    if (typeof o.url === 'string') return String(o.url)
    if (typeof o.nome === 'string' && typeof o.descricao === 'string') return `${o.nome}: ${o.descricao}`
    return Object.entries(o).map(([k, val]) => `${k}: ${normalizarValorContexto(val)}`).join(' · ')
  }
  return String(v)
}

function normalizarFormContexto(form: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!form) return out
  for (const [k, v] of Object.entries(form)) out[k] = normalizarValorContexto(v)
  return out
}

// ─── Card 2 — Contexto 1 editável ────────────────────────────────────────────
function CardContexto1({ empresaId, contexto, onSalvo }: {
  empresaId: string
  contexto: Contexto
  onSalvo: () => Promise<void>
}) {
  const [form, setForm] = useState<Record<string, string>>(() => normalizarFormContexto(contexto.contexto_form_json))
  const [salvando, setSalvando] = useState(false)
  const fb = useFeedback()

  useEffect(() => { setForm(normalizarFormContexto(contexto.contexto_form_json)) }, [contexto.id, contexto.contexto_form_json])

  async function salvar() {
    setSalvando(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contexto.id}`, {
        method: 'PUT',
        body: JSON.stringify({ contexto_form_json: form }),
      }), { sucesso: 'Contexto 1 salvo.' })
      await onSalvo()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSalvando(false) }
  }

  const preenchidos = CONTEXTO1_FIELDS.filter((f) => (form[f.name] || '').trim()).length

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Contexto 1 — Dados editáveis</h3>
        <span className="text-xs text-gray-500">{preenchidos}/{CONTEXTO1_FIELDS.length} campos</span>
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {CONTEXTO1_FIELDS.map((f) => (
          <div key={f.name}>
            <label className="block text-[10px] uppercase text-gray-500 mb-0.5">{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea
                rows={2}
                value={form[f.name] || ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1 text-xs"
              />
            ) : (
              <input
                value={form[f.name] || ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                className="w-full border rounded-lg px-2 py-1 text-xs"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-2 text-xs bg-brand text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
          {salvando && <Spinner size={13} />}
          {salvando ? 'Salvando…' : 'Salvar Contexto 1'}
        </button>
      </div>
    </div>
  )
}

// ─── Card 3 — Playbook ───────────────────────────────────────────────────────
function CardPlaybook({ contextoId: _contextoId, empresaId, versoes, gerando, onGerar, onAtivar }: {
  contextoId: string
  empresaId: string
  versoes: Versao[]
  gerando: boolean
  onGerar: () => void
  onAtivar: (versaoId: string) => void
}) {
  const ativa = versoes.find((v) => v.status === 'ativo')
  const labelBotao = ativa ? 'Atualizar Playbook (nova versão)' : 'Gerar Playbook com IA'

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Contexto 2 — Playbook Comercial</h3>
        {ativa && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ativo: v{ativa.versao}</span>}
      </div>
      <button onClick={onGerar} disabled={gerando} className="w-full text-xs bg-brand text-white px-3 py-2 rounded-lg disabled:opacity-50">
        {gerando ? 'Gerando…' : labelBotao}
      </button>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {versoes.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">Nenhuma versão ainda.</p>
        ) : (
          versoes.map((v) => (
            <VersaoCard key={v.id} empresaId={empresaId} versao={v} onAtivar={() => onAtivar(v.id)} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Card 4 — Teste de atendimento ───────────────────────────────────────────
type TestResp = {
  extracao?: {
    intencao?: string
    intencoes?: string[]
    intencao_principal?: string
    temperatura?: string
    proxima_melhor_acao?: string
  }
  decisao?: { mensagem_pro_lead?: string; etapa_proxima?: string }
}

function CardTeste({ empresaId, contextoForm, versaoAtiva }: {
  empresaId: string
  contextoForm: Record<string, string>
  versaoAtiva: Versao | null
}) {
  const [mensagem, setMensagem] = useState('')
  const [resultado, setResultado] = useState<TestResp | null>(null)
  const [testando, setTestando] = useState(false)
  const fb = useFeedback()

  async function testar() {
    if (!versaoAtiva) { fb.toast('Ative uma versão do Playbook primeiro.', 'error'); return }
    if (!mensagem.trim()) return
    setTestando(true)
    setResultado(null)
    try {
      const r = await fb.runTask(() => apiFetch<TestResp>(`/api/empresas/${empresaId}/contextos/versoes/${versaoAtiva.id}/testar`, {
        method: 'POST', body: JSON.stringify({ mensagem, historico: [] }),
      }), { sucesso: null })
      setResultado(r.data)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setTestando(false) }
  }

  const resposta = resultado?.decisao?.mensagem_pro_lead || ''
  const generico = avaliarGenerico(resposta, contextoForm, mensagem)

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-sm">Teste de atendimento</h3>
      {!versaoAtiva && <p className="text-xs text-amber-700">⚠ Sem playbook ativo. Gere e ative um pra testar.</p>}
      <textarea
        rows={2}
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        placeholder="Mensagem simulada do lead"
        className="w-full border rounded-lg px-2 py-1.5 text-xs"
      />
      <button onClick={testar} disabled={testando || !versaoAtiva || !mensagem.trim()} className="inline-flex w-full items-center justify-center gap-2 text-xs bg-brand text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
        {testando && <Spinner size={13} />}
        {testando ? 'Testando…' : 'Simular atendimento'}
      </button>
      {resultado && (
        <div className="border rounded-lg overflow-hidden bg-gray-50">
          <div className="px-3 py-2 border-b bg-white text-[10px] text-gray-500">
            Intenções: <b>{(resultado.extracao?.intencoes || [resultado.extracao?.intencao || '?']).join(', ')}</b>
            {' · '}Temperatura: <b>{resultado.extracao?.temperatura || '?'}</b>
            {resultado.extracao?.proxima_melhor_acao && <> · Próxima ação: <b>{resultado.extracao.proxima_melhor_acao}</b></>}
          </div>
          <div className="px-3 py-3 space-y-1.5">
            <div className="max-w-[85%] rounded-2xl px-3 py-1.5 text-xs bg-white border border-gray-200 mr-auto">
              <div className="text-[9px] uppercase text-gray-500 mb-0.5">Lead</div>
              <div className="whitespace-pre-wrap break-words">{mensagem}</div>
            </div>
            {resposta ? (
              <div className="max-w-[85%] rounded-2xl px-3 py-1.5 text-xs bg-brand text-white ml-auto">
                <div className="text-[9px] uppercase text-white/70 mb-0.5">Agente</div>
                <div className="whitespace-pre-wrap break-words">{resposta}</div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-2">(agente não respondeu)</p>
            )}
          </div>
          {generico && (
            <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-800 space-y-0.5">
              <div>⚠ A resposta pode estar genérica — não usou dados de cadastro, preço, link ou ofertas do contexto:</div>
              <ul className="list-disc list-inside">
                {generico.falhas.map((f, i) => (<li key={i}>{f}</li>))}
              </ul>
            </div>
          )}
          <details className="border-t bg-white">
            <summary className="px-3 py-1.5 text-[10px] text-gray-500 cursor-pointer hover:bg-gray-50">Ver JSON completo</summary>
            <pre className="text-[10px] bg-gray-50 p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-words border-t">
              {JSON.stringify(resultado, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

// Avaliação multi-critério: detecta resposta genérica considerando intenções do lead.
// Retorna null se passou; objeto com warnings se falhou.
function avaliarGenerico(
  resposta: string,
  ctx: Record<string, string>,
  mensagemLead: string,
): { termos_esperados: string[]; falhas: string[] } | null {
  const r = (resposta || '').toLowerCase()
  const lead = (mensagemLead || '').toLowerCase()
  if (!r) return null

  const falhas: string[] = []

  // Frases que sinalizam resposta genérica (lista preta)
  const fraseGenerica = [
    'depende da sua necessidade',
    'preciso entender melhor',
    'nossos serviços variam',
    'pra te ajudar melhor',
    'qual é o seu nome',
    'qual seu nome',
  ]
  if (fraseGenerica.some((f) => r.includes(f))) falhas.push('contém frase genérica de fuga')

  // Pediu nome cedo (e o lead não pediu cadastro real)?
  const pediuNome = /(qual\s+(é\s+)?(o\s+)?seu\s+nome|me\s+(diz|fala)\s+seu\s+nome|seu\s+nome\?)/i.test(resposta)
  if (pediuNome) falhas.push('pediu nome no início (regra: responder antes de qualificar)')

  // Lead pediu link e a resposta não tem URL?
  const pediuLink = /(tem\s+link|qual\s+(o\s+)?site|me\s+manda)/i.test(lead)
  const respostaTemUrl = /https?:\/\//i.test(resposta)
  if (pediuLink && !respostaTemUrl && /https?:\/\//i.test((ctx.links_uteis || ''))) {
    falhas.push('lead pediu link mas resposta não tem URL (e o contexto tem)')
  }

  // Lead pediu preço e a resposta não menciona valor (R$/número)?
  const pediuPreco = /(quanto\s+custa|qual\s+(o\s+)?valor|qual\s+(o\s+)?pre[çc]o|preço)/i.test(lead)
  const respostaTemPreco = /(r\$\s?\d|\d+\s*(reais|por\s+m[êe]s|por\s+ano|\/m[êe]s|\/ano))/i.test(resposta)
  if (pediuPreco && !respostaTemPreco && (ctx.precos_planos || '').trim()) {
    falhas.push('lead pediu preço mas resposta não cita valor (e o contexto tem)')
  }

  // Mencionou termos específicos da empresa?
  const termos = [
    ctx.nome_empresa, ctx.nicho, ctx.tipo_negocio,
    ...(ctx.servicos_produtos || '').split(/[,;.\n]/).slice(0, 5),
  ].map((s) => (s || '').trim().toLowerCase()).filter((s) => s.length >= 4)
  const matched = termos.length === 0 || termos.some((t) => r.includes(t))
  if (!matched) falhas.push('não menciona nome/nicho/serviços da empresa')

  if (falhas.length === 0) return null
  return { termos_esperados: termos, falhas }
}

function VersaoCard({ empresaId, versao, onAtivar }: { empresaId: string; versao: Versao; onAtivar: () => void }) {
  const [tab, setTab] = useState<'markdown' | 'json'>('markdown')
  const [secao, setSecao] = useState<string>('resumo_empresa')
  const [aberto, setAberto] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftMd, setDraftMd] = useState<string>(versao.conteudo_markdown || '')
  const [savingMd, setSavingMd] = useState(false)
  const fb = useFeedback()

  const badgeClass = versao.status === 'ativo'
    ? 'bg-green-100 text-green-700'
    : versao.status === 'rascunho'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-600'

  async function salvarMarkdown() {
    setSavingMd(true)
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/versoes/${versao.id}`, {
        method: 'PUT', body: JSON.stringify({ conteudo_markdown: draftMd }),
      }), { sucesso: 'Markdown salvo.' })
      versao.conteudo_markdown = draftMd
      setEditing(false)
    } catch { /* erro já exibido pelo feedback */ }
    finally { setSavingMd(false) }
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-gray-50 text-xs">
      <div className="px-3 py-2 flex items-center justify-between bg-white border-b">
        <button onClick={() => setAberto(!aberto)} className="flex items-center gap-2 text-left flex-1">
          <span className={`transition-transform ${aberto ? 'rotate-90' : ''} text-gray-400`}>▶</span>
          <span className="font-medium">v{versao.versao}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badgeClass}`}>{versao.status}</span>
          <span className="text-gray-500 ml-2">{new Date(versao.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </button>
        {versao.status !== 'ativo' && (
          <button onClick={onAtivar} className="text-brand hover:underline">Ativar</button>
        )}
      </div>
      {aberto && (
        <div className="p-3 space-y-2">
          <div className="flex gap-1">
            <button onClick={() => setTab('markdown')} className={`px-2 py-0.5 rounded ${tab === 'markdown' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>Markdown</button>
            <button onClick={() => setTab('json')} className={`px-2 py-0.5 rounded ${tab === 'json' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>JSON</button>
          </div>
          {tab === 'markdown' && (
            <div className="space-y-2">
              {editing ? (
                <>
                  <textarea value={draftMd} onChange={(e) => setDraftMd(e.target.value)} rows={10} className="w-full text-[11px] font-mono border rounded p-2" />
                  <div className="flex gap-2">
                    <button onClick={salvarMarkdown} disabled={savingMd} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-brand text-white disabled:opacity-50">{savingMd && <Spinner size={12} />}{savingMd ? 'Salvando…' : 'Salvar markdown'}</button>
                    <button onClick={() => { setEditing(false); setDraftMd(versao.conteudo_markdown || '') }} className="px-2 py-1 rounded border">Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded max-h-64 overflow-y-auto whitespace-pre-wrap break-words">{versao.conteudo_markdown || '(sem markdown)'}</pre>
                  <button onClick={() => { setDraftMd(versao.conteudo_markdown || ''); setEditing(true) }} className="px-2 py-1 rounded border">Editar markdown</button>
                </>
              )}
            </div>
          )}
          {tab === 'json' && (
            <div className="space-y-2">
              <div className="flex gap-1 flex-wrap">
                {PLAYBOOK_TABS.map((t) => (
                  <button key={t} onClick={() => setSecao(t)} className={`text-[10px] px-1.5 py-0.5 rounded ${secao === t ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700'}`}>
                    {t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
              <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
                {JSON.stringify((versao.conteudo_json as Record<string, unknown>)?.[secao] ?? {}, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Estágios POR contexto: "Gerar tudo" + edição manual + thumbnail ──────────
type EstagiosResp = {
  etapas: { chave: string; label: string }[]
  estagios: Record<string, string>
  vazio: boolean
  ativo: boolean
  thumbnail_url: string | null
  tem_conhecimento: boolean
}

type SimItem = {
  etapa: string
  mensagem_lead?: string
  resposta_agente?: string
  critica?: string
  mudou?: boolean
  erro?: string
}

function CardEstagios({ empresaId, contextoId, contextoNome: _contextoNome, reloadKey, onAtivacao }: {
  empresaId: string
  contextoId: string
  contextoNome: string
  reloadKey?: number
  onAtivacao: () => Promise<void> | void
}) {
  const [etapas, setEtapas] = useState<{ chave: string; label: string }[]>([])
  const [estagios, setEstagios] = useState<Record<string, string>>({})
  const [temConhecimento, setTemConhecimento] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const [thumbUrl, setThumbUrl] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [simul, setSimul] = useState<SimItem[] | null>(null)
  const fb = useFeedback()

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const r = await apiFetch<EstagiosResp>(`/api/empresas/${empresaId}/contextos/${contextoId}/estagios`)
      setEtapas(r.data.etapas || [])
      setEstagios(r.data.estagios || {})
      setTemConhecimento(!!r.data.tem_conhecimento)
      setThumb(r.data.thumbnail_url || null)
      setDirty(false)
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro ao carregar estágios.' })
    } finally {
      setCarregando(false)
    }
  }, [empresaId, contextoId])
  // reloadKey força recarregar os estágios após o pipeline (analisar/remover/gerar).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregar() }, [carregar, reloadKey])

  function setEtapa(chave: string, v: string) {
    setEstagios((p) => ({ ...p, [chave]: v }))
    setDirty(true)
  }

  // Fluxo ÚNICO: lê link/PDF (fontes já adicionadas acima) → preenche Contexto 1 →
  // gera Núcleo + 5 estágios (com técnicas de venda + auto-crítica) → cria o playbook.
  // O backend já SALVA os estágios e cria a versão do playbook.
  async function gerarTudo() {
    setBusy('gerar-tudo')
    try {
      const r = await fb.runTask(() => apiFetch<{
        estagios: Record<string, string>
        playbook: { versao?: number } | null
        passos: { etapa: string; erro?: string }[]
      }>(`/api/empresas/${empresaId}/contextos/${contextoId}/gerar-tudo`, {
        method: 'POST',
        timeoutMs: 600000, // pode levar 1-2 min (várias chamadas de IA encadeadas)
      }), { sucesso: null })
      if (r.data.estagios) setEstagios(r.data.estagios)
      setDirty(false) // o backend já salvou os estágios
      const erros = (r.data.passos || []).filter((p) => p.erro)
      if (erros.length) fb.toast(`Gerado com avisos em: ${erros.map((e) => e.etapa).join(', ')}. Revise os campos.`, 'info')
      else fb.sucessoModal('Tudo gerado', 'Contexto 1, estágios e playbook comercial. Revise, edite se quiser e ative.')
      await onAtivacao()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setBusy(null) }
  }

  // Loop "gera→simula→corrige" (opt-in): simula lead difícil, o modelo de atendimento
  // responde, e o modelo de geração critica e reescreve os estágios. Salva no backend.
  async function simularRefinar() {
    setBusy('simular')
    try {
      const r = await fb.runTask(() => apiFetch<{ estagios: Record<string, string>; simulacoes: SimItem[] }>(
        `/api/empresas/${empresaId}/contextos/${contextoId}/simular-refinar`,
        { method: 'POST', timeoutMs: 600000 }
      ), { sucesso: null })
      if (r.data.estagios) setEstagios(r.data.estagios)
      setSimul(r.data.simulacoes || [])
      setDirty(false)
      const mudaram = (r.data.simulacoes || []).filter((s) => s.mudou).length
      fb.sucessoModal('Simulação concluída', `${mudaram} estágio(s) melhorado(s). Veja o que mudou abaixo.`)
      await onAtivacao()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setBusy(null) }
  }

  async function salvar() {
    setBusy('salvar')
    try {
      await fb.runTask(() => apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/estagios`, { method: 'PUT', body: JSON.stringify({ estagios }) }),
        { sucesso: 'Estágios salvos no contexto.' })
      setDirty(false)
      await onAtivacao()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setBusy(null) }
  }

  async function enviarThumb(thumbnail_url: string | null) {
    setBusy('thumb')
    try {
      const r = await fb.runTask(() => apiFetch<{ thumbnail_url: string | null }>(`/api/empresas/${empresaId}/contextos/${contextoId}/thumbnail`, {
        method: 'PUT', body: JSON.stringify({ thumbnail_url }),
      }), { sucesso: 'Thumbnail salva.' })
      setThumb(r.data.thumbnail_url)
      setThumbUrl('')
      await onAtivacao()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setBusy(null) }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 480_000) { setMsg({ tone: 'err', text: 'Imagem muito grande (máx ~450KB).' }); return }
    const reader = new FileReader()
    reader.onload = () => { enviarThumb(String(reader.result || '')) }
    reader.readAsDataURL(f)
  }

  const lista = etapas.length ? etapas : Object.keys(estagios).map((chave) => ({ chave, label: chave }))

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm">Estágios do contexto</h3>
          <p className="text-xs text-gray-500 mt-0.5">Cada contexto tem seus próprios estágios. Ative o contexto pra o agente usá-los.</p>
        </div>
        <div className="flex items-center gap-2">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-9 w-9 rounded-lg object-cover border" />
          ) : null}
          <label className="text-xs px-2 py-1 rounded-lg border cursor-pointer hover:bg-gray-50">
            Thumbnail
            <input type="file" accept="image/*" onChange={onFile} className="hidden" />
          </label>
          {thumb && (
            <button onClick={() => enviarThumb(null)} disabled={busy === 'thumb'} className="text-xs text-gray-400 hover:text-red-600">remover</button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input value={thumbUrl} onChange={(e) => setThumbUrl(e.target.value)} placeholder="ou cole uma URL de imagem" className="flex-1 border rounded-lg px-2 py-1 text-xs" />
        <button onClick={() => enviarThumb(thumbUrl.trim() || null)} disabled={busy === 'thumb' || !thumbUrl.trim()} className="text-xs px-2 py-1 rounded-lg border disabled:opacity-50">Usar URL</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={gerarTudo}
          disabled={!!busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'gerar-tudo' ? 'Gerando tudo… (pode levar 1-2 min)' : '✨ Gerar tudo (Contexto 1 + estágios + playbook)'}
        </button>
        <button
          onClick={simularRefinar}
          disabled={!!busy}
          title="Simula um lead difícil, deixa o modelo de atendimento responder e o modelo de geração reescreve os estágios pra ficarem melhores."
          className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy === 'simular' ? 'Simulando…' : '🧪 Simular e melhorar'}
        </button>
        <button onClick={salvar} disabled={!!busy || !dirty} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
          {busy === 'salvar' ? 'Salvando…' : 'Salvar edições'}
        </button>
      </div>
      {!temConhecimento && (
        <p className="text-[11px] text-amber-600">
          Dica: adicione o link do site e/ou um PDF nas <strong>fontes</strong> acima antes de gerar — a IA usa isso pra preencher tudo.
        </p>
      )}

      {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-brand' : 'text-red-600'}`}>{msg.text}</p>}

      {simul && simul.length > 0 && (
        <div className="space-y-2 border rounded-lg p-3 bg-purple-50/50">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Simulação — lead difícil → resposta do agente → crítica</p>
            <button onClick={() => setSimul(null)} className="text-[10px] text-gray-400 hover:text-gray-600">fechar</button>
          </div>
          {simul.map((s, i) => (
            <div key={i} className="text-[11px] border-l-2 border-purple-300 pl-2 space-y-0.5">
              <p className="font-medium">
                {s.etapa} {s.mudou ? '— melhorado ✓' : s.erro ? '— erro' : '— sem mudança'}
              </p>
              {s.erro ? (
                <p className="text-red-600">{s.erro}</p>
              ) : (
                <>
                  <p><span className="text-gray-500">Lead:</span> {s.mensagem_lead}</p>
                  <p><span className="text-gray-500">Agente:</span> {s.resposta_agente}</p>
                  {s.critica && <p><span className="text-gray-500">Crítica:</span> {s.critica}</p>}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {carregando ? (
        <p className="text-xs text-gray-400">Carregando…</p>
      ) : (
        <div className="space-y-1.5">
          {lista.map((et) => {
            const open = aberto === et.chave
            const val = estagios[et.chave] || ''
            return (
              <div key={et.chave} className="border rounded-lg">
                <button onClick={() => setAberto(open ? null : et.chave)} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="flex items-center gap-2">
                    <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-xs font-medium">{et.label}</span>
                  </span>
                  <span className="text-[10px] text-gray-400">{val.trim() ? `${val.trim().length} chars` : 'vazio'}</span>
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-2">
                    <textarea
                      value={val}
                      onChange={(e) => setEtapa(et.chave, e.target.value)}
                      rows={12}
                      spellCheck={false}
                      className="w-full border rounded-lg px-3 py-2 text-[11px] font-mono"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
