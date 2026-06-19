'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Contexto = {
  id: string
  nome: string
  conteudo: string
  contexto_form_json: Record<string, string>
  criado_em: string
  ativo?: boolean
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
type Sugestao = {
  id: string
  tipo: string
  evidencia: string
  sugestao_markdown: string | null
  confianca: string
  status: string
  created_at: string
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

// Empresa-semente single-tenant. Só ela tem a aba "PJ Codeworks" (prompts .md).
const PJ_EMPRESA_ID = '00000000-0000-0000-0000-000000000001'

type PromptItemPJ = {
  chave: string
  label: string
  grupo: 'contexto' | 'estagio'
  origem: string
  version: number | null
  criado_em: string | null
}
type PromptAtualPJ = {
  chave: string
  conteudo: string
  origem: string
  version: number | null
  autor: string | null
  criado_em: string | null
}
type PromptHistPJ = {
  id: number
  version: number
  autor: string | null
  criado_em: string
  ativo: boolean
  snippet: string
}

export default function ContextosPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const [lista, setLista] = useState<Contexto[]>([])
  const [nomeNovo, setNomeNovo] = useState('')
  const [criando, setCriando] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [versoes, setVersoes] = useState<Record<string, Versao[]>>({})
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const [gerando, setGerando] = useState<string | null>(null)
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [aba, setAba] = useState<'contextos' | 'pj'>('contextos')

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Contexto[]>(`/api/empresas/${empresaId}/contextos`)
      setLista(r.data)
      const s = await apiFetch<Sugestao[]>(`/api/empresas/${empresaId}/contextos/sugestoes`)
      setSugestoes(s.data || [])
    } catch {}
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  async function carregarVersoes(contextoId: string) {
    if (!empresaId) return
    try {
      const r = await apiFetch<Versao[]>(`/api/empresas/${empresaId}/contextos/${contextoId}/versoes`)
      setVersoes((p) => ({ ...p, [contextoId]: r.data }))
    } catch {}
  }

  async function toggleCtx(id: string) {
    const novo = !aberto[id]
    setAberto((p) => ({ ...p, [id]: novo }))
    if (novo && !versoes[id]) await carregarVersoes(id)
  }

  async function criarVazio() {
    if (!empresaId) return
    setCriando(true)
    setMsg(null)
    try {
      const r = await apiFetch<Contexto>(`/api/empresas/${empresaId}/contextos`, {
        method: 'POST',
        body: JSON.stringify({ nome: nomeNovo || 'Contexto', contexto_form_json: {} }),
      })
      setLista((prev) => [r.data, ...prev])
      setNomeNovo('')
      setAberto((p) => ({ ...p, [r.data.id]: true }))
      setMsg({ tone: 'ok', text: 'Contexto criado. Adicione fontes ou edite o Contexto 1 abaixo.' })
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro.' })
    } finally {
      setCriando(false)
    }
  }

  async function gerarPlaybook(ctxId: string) {
    if (!empresaId) return
    setGerando(ctxId)
    setMsg(null)
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${ctxId}/gerar-playbook`, { method: 'POST' })
      await carregarVersoes(ctxId)
      setMsg({ tone: 'ok', text: 'Playbook gerado como rascunho. Revise no card "Playbook" e ative.' })
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao gerar.' })
    } finally {
      setGerando(null)
    }
  }

  async function removerContexto(c: Contexto) {
    if (!empresaId) return
    const versoesCount = (versoes[c.id] || []).length
    const aviso = versoesCount > 0
      ? `Remover "${c.nome}"?\n\nIsso também apaga ${versoesCount} versão(ões) e todas as fontes deste contexto. Ação irreversível.`
      : `Remover "${c.nome}"? Ação irreversível.`
    if (!confirm(aviso)) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${c.id}`, { method: 'DELETE' })
      setLista((prev) => prev.filter((x) => x.id !== c.id))
      setVersoes((p) => { const n = { ...p }; delete n[c.id]; return n })
      setAberto((p) => { const n = { ...p }; delete n[c.id]; return n })
      setMsg({ tone: 'ok', text: 'Contexto removido.' })
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao remover.' })
    }
  }

  async function ativar(ctxId: string, versaoId: string) {
    if (!empresaId) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/versoes/${versaoId}/ativar`, { method: 'POST' })
      await carregarVersoes(ctxId)
      setMsg({ tone: 'ok', text: 'Versão ativada — o agente vai usar esse playbook a partir de agora.' })
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao ativar.' })
    }
  }

  async function ativarContexto(c: Contexto, ativar: boolean) {
    if (!empresaId) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${c.id}/${ativar ? 'ativar' : 'desativar'}`, { method: 'POST' })
      await carregar()
      setMsg({ tone: 'ok', text: ativar ? `"${c.nome}" ativado — o agente passa a usar este contexto.` : `"${c.nome}" desativado.` })
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao ativar/desativar.' })
    }
  }

  async function reviewSugestao(id: string, acao: 'aprovar' | 'rejeitar') {
    if (!empresaId) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/sugestoes/${id}/${acao}`, { method: 'POST' })
      setSugestoes((prev) => prev.filter((s) => s.id !== id))
    } catch {}
  }

  async function aplicarSugestao(id: string) {
    if (!empresaId) return
    setMsg(null)
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/sugestoes/${id}/aplicar`, { method: 'POST' })
      setSugestoes((prev) => prev.filter((s) => s.id !== id))
      setMsg({ tone: 'ok', text: 'Novo rascunho gerado a partir da sugestão. Revise e ative quando quiser.' })
      await carregar()
      for (const k of Object.keys(aberto)) if (aberto[k]) await carregarVersoes(k)
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao aplicar sugestão.' })
    }
  }

  const ehPJ = empresaId === PJ_EMPRESA_ID
  const abas = ehPJ ? (
    <div className="flex gap-1 border-b border-gray-200">
      {(['contextos', 'pj'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setAba(t)}
          className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${aba === t ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          {t === 'contextos' ? 'Contextos' : 'PJ Codeworks'}
        </button>
      ))}
    </div>
  ) : null

  if (ehPJ && aba === 'pj') {
    return (
      <div className="space-y-6 max-w-6xl">
        <h1 className="text-2xl font-bold">Contextos</h1>
        {abas}
        <AgentePJTab empresaId={empresaId} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold">Contextos</h1>
      {abas}

      <div className="bg-white border rounded-2xl p-5 shadow-sm flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Nome do novo contexto (rótulo)</label>
          <input
            value={nomeNovo}
            onChange={(e) => setNomeNovo(e.target.value)}
            placeholder="Ex: Contexto Principal"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={criarVazio}
          disabled={criando}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {criando ? 'Criando…' : 'Criar Contexto 1'}
        </button>
      </div>

      {msg && (
        <p className={`text-sm ${msg.tone === 'ok' ? 'text-brand' : 'text-red-600'}`}>{msg.text}</p>
      )}

      <div className="space-y-3">
        {lista.map((c) => {
          const isOpen = !!aberto[c.id]
          const vs = versoes[c.id] || []
          return (
            <div key={c.id} className="bg-white border rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 flex justify-between items-start gap-4">
                <button type="button" onClick={() => toggleCtx(c.id)} className="flex items-start gap-3 text-left flex-1 hover:opacity-80">
                  <span className={`mt-1 inline-block transition-transform text-gray-400 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail_url} alt="" className="h-10 w-10 rounded-lg object-cover border shrink-0" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">
                      {(c.nome || '?').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{c.nome}</span>
                      {c.ativo && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ativo</span>}
                    </span>
                    <span className="block text-xs text-gray-500 mt-1 line-clamp-2">{c.conteudo || '(sem dados — adicione fontes ou edite o Contexto 1)'}</span>
                  </span>
                </button>
                <div className="shrink-0 flex items-center gap-2">
                  {c.ativo ? (
                    <button onClick={() => ativarContexto(c, false)} className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50">
                      Desativar
                    </button>
                  ) : (
                    <button onClick={() => ativarContexto(c, true)} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
                      Ativar
                    </button>
                  )}
                  <button
                    onClick={() => removerContexto(c)}
                    className="text-xs text-red-600 hover:underline"
                    title="Remover contexto e todas as suas versões e fontes"
                  >
                    Remover
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="border-t bg-gray-50 px-5 py-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <CardFontes empresaId={empresaId} contextoId={c.id} contextoAtual={c.contexto_form_json || {}} onAplicarSugestao={async (novoForm) => {
                      // salva contexto1 e recarrega lista
                      await apiFetch(`/api/empresas/${empresaId}/contextos/${c.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ contexto_form_json: novoForm }),
                      })
                      await carregar()
                      setMsg({ tone: 'ok', text: 'Contexto 1 atualizado pela sugestão das fontes.' })
                    }} />
                    <CardContexto1 empresaId={empresaId} contexto={c} onSalvo={async () => { await carregar() }} />
                    <CardPlaybook
                      contextoId={c.id}
                      versoes={vs}
                      gerando={gerando === c.id}
                      onGerar={() => gerarPlaybook(c.id)}
                      onAtivar={(vid) => ativar(c.id, vid)}
                      empresaId={empresaId}
                    />
                    <CardTeste empresaId={empresaId} contextoForm={c.contexto_form_json || {}} versaoAtiva={vs.find((v) => v.status === 'ativo') || null} />
                  </div>
                  <div className="mt-4">
                    <CardEstagios empresaId={empresaId} contextoId={c.id} contextoNome={c.nome} onAtivacao={carregar} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {sugestoes.length > 0 && (
        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h2 className="font-semibold text-sm">Sugestões de aprendizado pendentes</h2>
            <p className="text-xs text-gray-500 mt-0.5">A IA detectou padrões em conversas reais. Nada vai ser aplicado sem você aprovar.</p>
          </div>
          <div className="divide-y">
            {sugestoes.map((s) => (
              <div key={s.id} className="px-5 py-4 flex justify-between items-start gap-4">
                <div className="flex-1">
                  <p className="text-xs uppercase text-gray-500">{s.tipo} · confiança {s.confianca}</p>
                  <p className="text-sm mt-1">{s.evidencia}</p>
                  {s.sugestao_markdown && <pre className="mt-2 text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">{s.sugestao_markdown}</pre>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => aplicarSugestao(s.id)} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">Aplicar como rascunho</button>
                  <button onClick={() => reviewSugestao(s.id, 'aprovar')} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white">Aprovar</button>
                  <button onClick={() => reviewSugestao(s.id, 'rejeitar')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300">Rejeitar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card 1 — Fontes ─────────────────────────────────────────────────────────
function CardFontes({ empresaId, contextoId, contextoAtual, onAplicarSugestao }: {
  empresaId: string
  contextoId: string
  contextoAtual: Record<string, unknown>
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

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<Fonte[]>(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes`)
      setFontes(r.data || [])
    } catch {}
  }, [empresaId, contextoId])

  useEffect(() => { carregar() }, [carregar])

  async function adicionar() {
    setErro('')
    setCarregando(true)
    try {
      if (tipo === 'link') {
        if (!/^https?:\/\//i.test(url)) throw new Error('URL precisa começar com http:// ou https://')
        await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/link`, {
          method: 'POST', body: JSON.stringify({ url }),
        })
        setUrl('')
      } else if (tipo === 'texto') {
        if (texto.trim().length < 10) throw new Error('Cole pelo menos 10 caracteres.')
        await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/texto`, {
          method: 'POST', body: JSON.stringify({ texto }),
        })
        setTexto('')
      } else if (tipo === 'pdf') {
        if (!arquivo) throw new Error('Selecione um arquivo PDF.')
        const fd = new FormData()
        fd.append('arquivo', arquivo)
        await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/documento`, {
          method: 'POST', body: fd,
        })
        setArquivo(null)
      }
      await carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao adicionar fonte.')
    } finally {
      setCarregando(false)
    }
  }

  async function analisar(fonteId: string) {
    setAnalisando(fonteId)
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/${fonteId}/analisar`, { method: 'POST' })
      await carregar()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar.')
      await carregar()
    } finally {
      setAnalisando(null)
    }
  }

  async function remover(fonteId: string) {
    if (!confirm('Remover esta fonte?')) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/fontes/${fonteId}`, { method: 'DELETE' })
      await carregar()
    } catch {}
  }

  async function sugerir() {
    setSugerindo(true)
    setErro('')
    try {
      const r = await apiFetch<SugestaoCtx1>(`/api/empresas/${empresaId}/contextos/${contextoId}/sugerir-contexto1`, { method: 'POST' })
      setSugestao(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar sugestão.')
    } finally {
      setSugerindo(false)
    }
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
                <button onClick={() => analisar(f.id)} disabled={analisando === f.id} className="text-brand hover:underline disabled:opacity-50">
                  {analisando === f.id ? 'Analisando…' : 'Analisar'}
                </button>
              )}
              {f.status === 'erro' && (
                <button onClick={() => analisar(f.id)} className="text-amber-600 hover:underline" title={f.erro || ''}>
                  Tentar de novo
                </button>
              )}
              <button onClick={() => remover(f.id)} className="text-gray-400 hover:text-red-600" title="Remover">×</button>
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
  const [msg, setMsg] = useState('')

  useEffect(() => { setForm(normalizarFormContexto(contexto.contexto_form_json)) }, [contexto.id, contexto.contexto_form_json])

  async function salvar() {
    setSalvando(true)
    setMsg('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contexto.id}`, {
        method: 'PUT',
        body: JSON.stringify({ contexto_form_json: form }),
      })
      await onSalvo()
      setMsg('Salvo.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setSalvando(false)
    }
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
        <button onClick={salvar} disabled={salvando} className="text-xs bg-brand text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Salvar Contexto 1'}
        </button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
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
  const [erro, setErro] = useState('')

  async function testar() {
    if (!versaoAtiva) {
      setErro('Ative uma versão do Playbook primeiro.')
      return
    }
    if (!mensagem.trim()) return
    setTestando(true)
    setErro('')
    setResultado(null)
    try {
      const r = await apiFetch<TestResp>(`/api/empresas/${empresaId}/contextos/versoes/${versaoAtiva.id}/testar`, {
        method: 'POST', body: JSON.stringify({ mensagem, historico: [] }),
      })
      setResultado(r.data)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro.')
    } finally {
      setTestando(false)
    }
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
      <button onClick={testar} disabled={testando || !versaoAtiva || !mensagem.trim()} className="w-full text-xs bg-brand text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
        {testando ? 'Testando…' : 'Simular atendimento'}
      </button>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
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
  const [mdMsg, setMdMsg] = useState('')

  const badgeClass = versao.status === 'ativo'
    ? 'bg-green-100 text-green-700'
    : versao.status === 'rascunho'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-600'

  async function salvarMarkdown() {
    setSavingMd(true)
    setMdMsg('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/versoes/${versao.id}`, {
        method: 'PUT', body: JSON.stringify({ conteudo_markdown: draftMd }),
      })
      versao.conteudo_markdown = draftMd
      setEditing(false)
      setMdMsg('Salvo.')
    } catch (e: unknown) {
      setMdMsg(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSavingMd(false)
    }
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
                    <button onClick={salvarMarkdown} disabled={savingMd} className="px-2 py-1 rounded bg-brand text-white disabled:opacity-50">{savingMd ? '…' : 'Salvar markdown'}</button>
                    <button onClick={() => { setEditing(false); setDraftMd(versao.conteudo_markdown || '') }} className="px-2 py-1 rounded border">Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded max-h-64 overflow-y-auto whitespace-pre-wrap break-words">{versao.conteudo_markdown || '(sem markdown)'}</pre>
                  <button onClick={() => { setDraftMd(versao.conteudo_markdown || ''); setEditing(true) }} className="px-2 py-1 rounded border">Editar markdown</button>
                </>
              )}
              {mdMsg && <p className="text-[10px] text-brand">{mdMsg}</p>}
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

// ─── Aba PJ Codeworks — agente single-tenant (prompts .md) ───────────────────
function AgentePJTab({ empresaId }: { empresaId: string }) {
  const [nome, setNome] = useState('')
  const [nomeSalvo, setNomeSalvo] = useState('')
  const [pausado, setPausado] = useState(false)
  const [prompts, setPrompts] = useState<PromptItemPJ[]>([])
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [togglando, setTogglando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const emp = await apiFetch<{ nome: string }>(`/api/empresas/${empresaId}`)
      setNome(emp.data.nome || '')
      setNomeSalvo(emp.data.nome || '')
      const ag = await apiFetch<{ pausado: boolean }>(`/api/empresas/${empresaId}/agente`)
      setPausado(!!ag.data.pausado)
      const pr = await apiFetch<PromptItemPJ[]>(`/api/empresas/${empresaId}/agente-pj/prompts`)
      setPrompts(pr.data || [])
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro ao carregar.' })
    } finally {
      setCarregando(false)
    }
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  async function salvarNome() {
    setSalvandoNome(true)
    setMsg(null)
    try {
      await apiFetch(`/api/empresas/${empresaId}`, { method: 'PUT', body: JSON.stringify({ nome }) })
      setNomeSalvo(nome)
      setMsg({ tone: 'ok', text: 'Nome salvo.' })
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro.' })
    } finally {
      setSalvandoNome(false)
    }
  }

  async function toggle() {
    setTogglando(true)
    setMsg(null)
    const novo = !pausado
    try {
      await apiFetch(`/api/empresas/${empresaId}/agente`, { method: 'PATCH', body: JSON.stringify({ pausado: novo }) })
      setPausado(novo)
      setMsg({ tone: 'ok', text: novo ? 'Agente desativado (pausado).' : 'Agente ativado.' })
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro.' })
    } finally {
      setTogglando(false)
    }
  }

  const contexto = prompts.filter((p) => p.grupo === 'contexto')
  const estagios = prompts.filter((p) => p.grupo === 'estagio')

  return (
    <div className="space-y-5">
      {msg && <p className={`text-sm ${msg.tone === 'ok' ? 'text-brand' : 'text-red-600'}`}>{msg.text}</p>}

      <div className="bg-white border rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Agente PJ Codeworks</h2>
            <p className="text-xs text-gray-500 mt-0.5">Este agente usa os prompts abaixo (não o Contexto 2). Edições afetam o atendimento real.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs px-2 py-1 rounded-full ${pausado ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{pausado ? 'Desativado' : 'Ativo'}</span>
            <button
              onClick={toggle}
              disabled={togglando}
              className={`text-sm px-3 py-1.5 rounded-lg text-white disabled:opacity-50 ${pausado ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}
            >
              {togglando ? '…' : pausado ? 'Ativar agente' : 'Desativar agente'}
            </button>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Nome do agente / empresa</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <button
            onClick={salvarNome}
            disabled={salvandoNome || nome.trim().length < 2 || nome === nomeSalvo}
            className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
          >
            {salvandoNome ? 'Salvando…' : 'Salvar nome'}
          </button>
        </div>
      </div>

      {carregando ? (
        <p className="text-sm text-gray-400">Carregando…</p>
      ) : (
        <>
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b"><h3 className="font-semibold text-sm">Contexto</h3></div>
            <div className="divide-y">
              {contexto.map((p) => <PromptEditorPJ key={p.chave} empresaId={empresaId} item={p} />)}
            </div>
          </div>
          <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b">
              <h3 className="font-semibold text-sm">Estágios de resposta</h3>
              <p className="text-xs text-gray-500 mt-0.5">Regras do agente por etapa do funil.</p>
            </div>
            <div className="divide-y">
              {estagios.map((p) => <PromptEditorPJ key={p.chave} empresaId={empresaId} item={p} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function PromptEditorPJ({ empresaId, item }: { empresaId: string; item: PromptItemPJ }) {
  const [aberto, setAberto] = useState(false)
  const [conteudo, setConteudo] = useState('')
  const [draft, setDraft] = useState('')
  const [hist, setHist] = useState<PromptHistPJ[]>([])
  const [loaded, setLoaded] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [origem, setOrigem] = useState(item.origem)
  const [version, setVersion] = useState<number | null>(item.version)

  async function carregar() {
    setCarregando(true)
    setMsg('')
    try {
      const r = await apiFetch<{ atual: PromptAtualPJ; historico: PromptHistPJ[] }>(`/api/empresas/${empresaId}/agente-pj/prompts/${item.chave}`)
      setConteudo(r.data.atual.conteudo || '')
      setDraft(r.data.atual.conteudo || '')
      setHist(r.data.historico || [])
      setOrigem(r.data.atual.origem)
      setVersion(r.data.atual.version)
      setLoaded(true)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao carregar.')
    } finally {
      setCarregando(false)
    }
  }

  async function abrir() {
    const novo = !aberto
    setAberto(novo)
    if (novo && !loaded) await carregar()
  }

  async function salvar() {
    setSalvando(true)
    setMsg('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/agente-pj/prompts/${item.chave}`, { method: 'PUT', body: JSON.stringify({ conteudo: draft }) })
      setConteudo(draft)
      setMsg('Nova versão salva.')
      await carregar()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function reverter(versionId: number) {
    if (!confirm('Reverter para esta versão?')) return
    setMsg('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/agente-pj/prompts/${item.chave}/reverter`, { method: 'POST', body: JSON.stringify({ versionId }) })
      await carregar()
      setMsg('Revertido.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Erro ao reverter.')
    }
  }

  const alterado = draft !== conteudo

  return (
    <div className="px-5 py-3">
      <button onClick={abrir} className="w-full flex items-center justify-between text-left">
        <span className="flex items-center gap-2">
          <span className={`text-gray-400 transition-transform ${aberto ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-sm font-medium">{item.label}</span>
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {origem === 'banco' ? `editado v${version ?? ''}` : 'padrão (arquivo)'}
        </span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-2">
          {carregando ? (
            <p className="text-xs text-gray-400">Carregando…</p>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full border rounded-lg px-3 py-2 text-[11px] font-mono"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={salvar} disabled={salvando || !alterado || !draft.trim()} className="text-xs bg-brand text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {salvando ? 'Salvando…' : 'Salvar nova versão'}
                </button>
                {alterado && <button onClick={() => setDraft(conteudo)} className="text-xs px-3 py-1.5 rounded-lg border">Descartar</button>}
                {msg && <span className="text-xs text-gray-500">{msg}</span>}
              </div>
              {hist.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 py-1">Histórico ({hist.length})</summary>
                  <div className="space-y-1 mt-1">
                    {hist.map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-2 border rounded px-2 py-1">
                        <span className="truncate">
                          v{h.version} · {new Date(h.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          {h.ativo && <b className="text-green-600"> (ativa)</b>} · {h.autor || '—'}
                        </span>
                        {!h.ativo && <button onClick={() => reverter(h.id)} className="text-brand hover:underline shrink-0">Reverter</button>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Estágios POR contexto (Gerar / Importar PJ / Adaptar / Salvar + thumbnail) ──
type EstagiosResp = {
  etapas: { chave: string; label: string }[]
  estagios: Record<string, string>
  vazio: boolean
  ativo: boolean
  thumbnail_url: string | null
  tem_conhecimento: boolean
}

function CardEstagios({ empresaId, contextoId, contextoNome, onAtivacao }: {
  empresaId: string
  contextoId: string
  contextoNome: string
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
  useEffect(() => { carregar() }, [carregar])

  function setEtapa(chave: string, v: string) {
    setEstagios((p) => ({ ...p, [chave]: v }))
    setDirty(true)
  }

  async function acao(nome: 'gerar' | 'adaptar' | 'importar') {
    setBusy(nome)
    setMsg(null)
    try {
      const path = nome === 'gerar' ? 'estagios/gerar' : nome === 'adaptar' ? 'estagios/adaptar' : 'estagios/importar-pj'
      const opts: RequestInit = { method: 'POST' }
      if (nome === 'adaptar') opts.body = JSON.stringify({ estagios })
      const r = await apiFetch<{ estagios: Record<string, string> }>(`/api/empresas/${empresaId}/contextos/${contextoId}/${path}`, opts)
      setEstagios(r.data.estagios || {})
      setDirty(true)
      setMsg({
        tone: 'ok',
        text: nome === 'gerar'
          ? 'Estágios genéricos gerados — revise e salve.'
          : nome === 'adaptar'
            ? 'Estágios adaptados ao contexto — revise e salve.'
            : 'Estágios da PJ importados — revise e salve.',
      })
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Falha na operação.' })
    } finally {
      setBusy(null)
    }
  }

  async function salvar() {
    setBusy('salvar')
    setMsg(null)
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/${contextoId}/estagios`, { method: 'PUT', body: JSON.stringify({ estagios }) })
      setDirty(false)
      setMsg({ tone: 'ok', text: 'Estágios salvos no contexto.' })
      await onAtivacao()
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro ao salvar.' })
    } finally {
      setBusy(null)
    }
  }

  async function enviarThumb(thumbnail_url: string | null) {
    setBusy('thumb')
    setMsg(null)
    try {
      const r = await apiFetch<{ thumbnail_url: string | null }>(`/api/empresas/${empresaId}/contextos/${contextoId}/thumbnail`, {
        method: 'PUT', body: JSON.stringify({ thumbnail_url }),
      })
      setThumb(r.data.thumbnail_url)
      setThumbUrl('')
      setMsg({ tone: 'ok', text: 'Thumbnail salva.' })
      await onAtivacao()
    } catch (e: unknown) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : 'Erro ao salvar thumbnail.' })
    } finally {
      setBusy(null)
    }
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

      <div className="flex flex-wrap gap-2">
        <button onClick={() => acao('gerar')} disabled={!!busy} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
          {busy === 'gerar' ? 'Gerando…' : 'Gerar estágios (genéricos)'}
        </button>
        <button onClick={() => acao('importar')} disabled={!!busy} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
          {busy === 'importar' ? 'Importando…' : 'Importar da PJ'}
        </button>
        <button onClick={() => acao('adaptar')} disabled={!!busy || !temConhecimento} title={temConhecimento ? '' : 'Preencha o Contexto 1 / fontes antes'} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy === 'adaptar' ? 'Adaptando…' : 'Adaptar estágios ao contexto'}
        </button>
        <button onClick={salvar} disabled={!!busy || !dirty} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
          {busy === 'salvar' ? 'Salvando…' : 'Salvar estágios no contexto'}
        </button>
      </div>

      {msg && <p className={`text-xs ${msg.tone === 'ok' ? 'text-brand' : 'text-red-600'}`}>{msg.text}</p>}

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
                  <div className="px-3 pb-3">
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
