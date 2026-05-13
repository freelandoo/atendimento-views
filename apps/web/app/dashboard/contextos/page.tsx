'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Contexto = {
  id: string
  nome: string
  conteudo: string
  contexto_form_json: Record<string, string>
  criado_em: string
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

const CONTEXTO1_FIELDS: { name: string; label: string; type?: 'text' | 'textarea' }[] = [
  { name: 'nome_empresa', label: 'Nome da empresa' },
  { name: 'tipo_negocio', label: 'Tipo de negócio' },
  { name: 'nicho', label: 'Nicho' },
  { name: 'cidade_regiao', label: 'Cidade / Região' },
  { name: 'servicos_produtos', label: 'Serviços / Produtos', type: 'textarea' },
  { name: 'precos_planos', label: 'Preços / Planos', type: 'textarea' },
  { name: 'publico_alvo', label: 'Público-alvo' },
  { name: 'cliente_ideal', label: 'Cliente ideal' },
  { name: 'diferenciais', label: 'Diferenciais', type: 'textarea' },
  { name: 'problemas_que_resolve', label: 'Problemas que resolve', type: 'textarea' },
  { name: 'tom_de_voz', label: 'Tom de voz' },
  { name: 'horario_atendimento', label: 'Horário de atendimento' },
  { name: 'formas_pagamento', label: 'Formas de pagamento' },
  { name: 'objeções_comuns', label: 'Objeções comuns', type: 'textarea' },
  { name: 'perguntas_frequentes', label: 'Perguntas frequentes', type: 'textarea' },
  { name: 'quando_chamar_humano', label: 'Quando chamar humano', type: 'textarea' },
  { name: 'links_uteis', label: 'Links úteis' },
  { name: 'informacoes_extras', label: 'Informações extras', type: 'textarea' },
]

const PLAYBOOK_TABS = [
  'resumo_empresa', 'tom_de_voz', 'servicos', 'dados_para_coletar',
  'fluxo_atendimento', 'respostas_base', 'regras_orcamento', 'regras_reuniao',
  'objecoes', 'lead_scoring', 'runtime_policy', 'aprendizado_continuo',
  'limites_da_ia', 'handoff',
]

export default function ContextosPage() {
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  const [lista, setLista] = useState<Contexto[]>([])
  const [novoForm, setNovoForm] = useState<Record<string, string>>({})
  const [nomeNovo, setNomeNovo] = useState('')
  const [criando, setCriando] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [versoes, setVersoes] = useState<Record<string, Versao[]>>({})
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const [gerando, setGerando] = useState<string | null>(null)
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])

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

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setCriando(true)
    setMsg(null)
    try {
      const r = await apiFetch<Contexto>(`/api/empresas/${empresaId}/contextos`, {
        method: 'POST',
        body: JSON.stringify({
          nome: nomeNovo || (novoForm.nome_empresa || 'Contexto'),
          contexto_form_json: novoForm,
        }),
      })
      setLista((prev) => [r.data, ...prev])
      setNovoForm({})
      setNomeNovo('')
      setMsg({ tone: 'ok', text: 'Contexto 1 criado.' })
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
      setMsg({ tone: 'ok', text: 'Playbook gerado como rascunho. Expanda para revisar e ativar.' })
      setAberto((p) => ({ ...p, [ctxId]: true }))
      await carregarVersoes(ctxId)
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao gerar.' })
    } finally {
      setGerando(null)
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
      // recarrega contextos+versões
      await carregar()
      for (const k of Object.keys(aberto)) if (aberto[k]) await carregarVersoes(k)
    } catch (err: unknown) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao aplicar sugestão.' })
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-2xl font-bold">Contextos</h1>

      <form onSubmit={criar} className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Novo Contexto 1 — formulário comercial</h2>
          <input
            value={nomeNovo}
            onChange={(e) => setNomeNovo(e.target.value)}
            placeholder="Nome do contexto (rótulo)"
            className="border rounded-lg px-3 py-1.5 text-sm w-64"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CONTEXTO1_FIELDS.map((f) => (
            <div key={f.name} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
              <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={novoForm[f.name] || ''}
                  onChange={(e) => setNovoForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              ) : (
                <input
                  value={novoForm[f.name] || ''}
                  onChange={(e) => setNovoForm((p) => ({ ...p, [f.name]: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              )}
            </div>
          ))}
        </div>
        <button disabled={criando} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
          {criando ? 'Salvando…' : 'Criar Contexto 1'}
        </button>
      </form>

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
                  <span className="flex-1">
                    <span className="block font-medium">{c.nome}</span>
                    <span className="block text-xs text-gray-500 mt-1 line-clamp-2">{c.conteudo}</span>
                  </span>
                </button>
                <button
                  onClick={() => gerarPlaybook(c.id)}
                  disabled={gerando === c.id}
                  className="shrink-0 bg-gray-100 hover:bg-brand hover:text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {gerando === c.id ? 'Gerando playbook…' : 'Gerar Playbook com IA'}
                </button>
              </div>

              {isOpen && (
                <div className="border-t bg-gray-50 px-5 py-4 space-y-3">
                  {vs.length === 0 ? (
                    <p className="text-xs text-gray-500">Nenhuma versão ainda. Clique em "Gerar Playbook com IA".</p>
                  ) : (
                    vs.map((v) => (
                      <VersaoCard key={v.id} empresaId={empresaId} versao={v} onAtivar={() => ativar(c.id, v.id)} />
                    ))
                  )}
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
            <p className="text-xs text-gray-500 mt-0.5">A IA detectou padrões. Nada vai ser aplicado sem você aprovar.</p>
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
                  <button onClick={() => aplicarSugestao(s.id)} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark" title="Gera um novo rascunho com a sugestão aplicada">Aplicar como rascunho</button>
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

function VersaoCard({ empresaId, versao, onAtivar }: { empresaId: string; versao: Versao; onAtivar: () => void }) {
  const [tab, setTab] = useState<'markdown' | 'json' | 'testar'>('markdown')
  const [secao, setSecao] = useState<string>('resumo_empresa')
  const [aberto, setAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [testResult, setTestResult] = useState<unknown>(null)
  const [testando, setTestando] = useState(false)
  const [testErr, setTestErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftMd, setDraftMd] = useState<string>(versao.conteudo_markdown || '')
  const [savingMd, setSavingMd] = useState(false)
  const [mdMsg, setMdMsg] = useState<string | null>(null)

  async function salvarMarkdown() {
    if (!empresaId) return
    setSavingMd(true)
    setMdMsg(null)
    try {
      await apiFetch(`/api/empresas/${empresaId}/contextos/versoes/${versao.id}`, {
        method: 'PUT',
        body: JSON.stringify({ conteudo_markdown: draftMd }),
      })
      setMdMsg('Markdown salvo.')
      setEditing(false)
    } catch (e: unknown) {
      setMdMsg(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSavingMd(false)
    }
  }

  const badgeClass = versao.status === 'ativo'
    ? 'bg-green-100 text-green-700'
    : versao.status === 'rascunho'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-600'

  async function testar() {
    if (!mensagem || !empresaId) return
    setTestando(true)
    setTestErr(null)
    setTestResult(null)
    try {
      const r = await apiFetch<unknown>(`/api/empresas/${empresaId}/contextos/versoes/${versao.id}/testar`, {
        method: 'POST',
        body: JSON.stringify({ mensagem, historico: [] }),
      })
      setTestResult(r.data)
    } catch (e: unknown) {
      setTestErr(e instanceof Error ? e.message : 'Erro')
    } finally {
      setTestando(false)
    }
  }

  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">
            Versão {versao.versao}
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>{versao.status}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Gerado em {new Date(versao.criado_em).toLocaleString('pt-BR')} · por {versao.gerado_por}
            {versao.playbook_schema_version && <> · {versao.playbook_schema_version}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAberto((p) => !p)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100">
            {aberto ? 'Ocultar' : 'Ver conteúdo'}
          </button>
          {versao.status !== 'ativo' && (
            <button onClick={onAtivar} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-dark">Ativar</button>
          )}
        </div>
      </div>

      {aberto && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2 border-b pb-2">
            <Tab name="markdown" current={tab} set={setTab}>Markdown</Tab>
            <Tab name="json" current={tab} set={setTab}>JSON</Tab>
            <Tab name="testar" current={tab} set={setTab}>Testar</Tab>
          </div>

          {tab === 'markdown' && (
            <div className="space-y-2">
              {editing ? (
                <>
                  <textarea
                    value={draftMd}
                    onChange={(e) => setDraftMd(e.target.value)}
                    rows={20}
                    className="w-full text-xs font-mono border rounded-lg p-3"
                  />
                  <div className="flex gap-2">
                    <button onClick={salvarMarkdown} disabled={savingMd} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white disabled:opacity-50">
                      {savingMd ? 'Salvando…' : 'Salvar markdown'}
                    </button>
                    <button onClick={() => { setEditing(false); setDraftMd(versao.conteudo_markdown || '') }} className="text-xs px-3 py-1.5 rounded-lg border">
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
                    {versao.conteudo_markdown || '(sem markdown)'}
                  </pre>
                  <button onClick={() => { setDraftMd(versao.conteudo_markdown || ''); setEditing(true) }} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100">
                    Editar markdown
                  </button>
                </>
              )}
              {mdMsg && <p className="text-xs text-brand">{mdMsg}</p>}
            </div>
          )}

          {tab === 'json' && (
            <div className="space-y-2">
              <div className="flex gap-1 flex-wrap">
                {PLAYBOOK_TABS.map((t) => (
                  <button key={t} onClick={() => setSecao(t)} className={`text-xs px-2 py-1 rounded ${secao === t ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                    {t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
              <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
                {JSON.stringify((versao.conteudo_json as Record<string, unknown>)?.[secao] ?? {}, null, 2)}
              </pre>
            </div>
          )}

          {tab === 'testar' && (
            <div className="space-y-3">
              <textarea
                rows={3}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Mensagem simulada do lead (ex: 'Tenho uma barbearia no Rudge, quanto custa um site?')"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={testar} disabled={testando || !mensagem} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
                {testando ? 'Testando…' : 'Simular atendimento'}
              </button>
              {testErr && <pre className="text-xs bg-red-50 text-red-800 p-3 rounded-lg whitespace-pre-wrap">{testErr}</pre>}
              {testResult != null && (
                <pre className="text-xs bg-gray-50 border p-3 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Tab({ name, current, set, children }: { name: 'markdown' | 'json' | 'testar'; current: string; set: (v: 'markdown' | 'json' | 'testar') => void; children: React.ReactNode }) {
  const active = current === name
  return (
    <button onClick={() => set(name)} className={`text-sm px-3 py-1 rounded ${active ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
      {children}
    </button>
  )
}
