'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Provider = 'openai' | 'anthropic'

type PresetModel = { value: string; label: string }
type Preset = { label: string; defaultModel: string; models: PresetModel[] }
type Presets = Record<Provider, Preset>

type LLMStatus = {
  provider: Provider
  model: string
  status: 'ativo' | 'erro' | 'pendente'
  last_error: string | null
  tested_at: string | null
  openai_key_masked: string | null
  anthropic_key_masked: string | null
  has_openai_key: boolean
  has_anthropic_key: boolean
}

// Payload completo do GET /api/llm (config + presets + modelo de geração).
type LLMConfig = Partial<LLMStatus> & {
  gen_provider?: Provider | null
  gen_model?: string | null
  presets?: Presets
}

type ModelInfo = { id: string; owned_by?: string; display_name?: string }

const PROVIDERS: { id: Provider; label: string; placeholder: string }[] = [
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-proj-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
]

export default function LLMPage() {
  const [status, setStatus] = useState<LLMStatus | null>(null)
  const [provider, setProvider] = useState<Provider>('openai')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelSelecionado, setModelSelecionado] = useState('')
  const [rodando, setRodando] = useState(false)
  const [conectando, setConectando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [agentePausado, setAgentePausado] = useState<boolean | null>(null)
  const [togglingAgente, setTogglingAgente] = useState(false)
  // "LLM de geração" (one-shot): provider/model usados só na geração; reusa a chave do atendimento.
  const [presets, setPresets] = useState<Presets | null>(null)
  const [genProvider, setGenProvider] = useState<Provider>('openai')
  const [genModel, setGenModel] = useState('')
  const [genAtual, setGenAtual] = useState<{ provider: Provider | null; model: string | null }>({ provider: null, model: null })
  const [savingGen, setSavingGen] = useState(false)
  const [genMsg, setGenMsg] = useState<string | null>(null)

  async function carregarStatus() {
    try {
      const r = await apiFetch<LLMConfig | null>('/api/llm')
      if (r.data) {
        if (r.data.presets) setPresets(r.data.presets)
        if (r.data.provider) {
          setStatus(r.data as LLMStatus)
          setProvider(r.data.provider)
        }
        const gp = (r.data.gen_provider || r.data.provider || 'openai') as Provider
        setGenProvider(gp)
        setGenModel(r.data.gen_model || '')
        setGenAtual({ provider: r.data.gen_provider || null, model: r.data.gen_model || null })
      }
    } catch {}
    const eid = getEmpresaId()
    if (eid) {
      try {
        const a = await apiFetch<{ pausado: boolean }>(`/api/empresas/${eid}/agente`)
        setAgentePausado(!!a.data.pausado)
      } catch {}
    }
  }

  async function setAgenteState(pausado: boolean) {
    const eid = getEmpresaId()
    if (!eid) return
    setTogglingAgente(true)
    try {
      const r = await apiFetch<{ pausado: boolean }>(`/api/empresas/${eid}/agente`, {
        method: 'PATCH',
        body: JSON.stringify({ pausado }),
      })
      setAgentePausado(!!r.data.pausado)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao atualizar agente.')
    } finally {
      setTogglingAgente(false)
    }
  }

  useEffect(() => {
    carregarStatus()
  }, [])

  async function rodar() {
    setErro(null)
    setOk(null)
    setModels([])
    setModelSelecionado('')
    if (!apiKey) {
      setErro('Cole a API key antes de rodar.')
      return
    }
    setRodando(true)
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/llm/test`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify({ provider, api_key: apiKey }),
        }
      )
      const json = await r.json()
      if (!json.ok) {
        setErro(json.error?.message || 'Erro desconhecido.')
        return
      }
      setModels(json.data.models || [])
      if (json.data.models?.length === 1) setModelSelecionado(json.data.models[0].id)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha na requisição.')
    } finally {
      setRodando(false)
    }
  }

  async function conectar() {
    setErro(null)
    setOk(null)
    if (!apiKey || !modelSelecionado) {
      setErro('Selecione um modelo antes de conectar.')
      return
    }
    setConectando(true)
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/llm/activate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          },
          body: JSON.stringify({ provider, api_key: apiKey, model: modelSelecionado }),
        }
      )
      const json = await r.json()
      if (!json.ok) {
        setErro(json.error?.message || 'Erro ao ativar.')
        return
      }
      setOk(`Conectado: ${json.data.provider}/${json.data.model}`)
      setApiKey('')
      await carregarStatus()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha na requisição.')
    } finally {
      setConectando(false)
    }
  }

  async function salvarGeracao(limpar = false) {
    setGenMsg(null)
    setErro(null)
    if (!limpar && !genModel) {
      setGenMsg('Escolha um modelo de geração.')
      return
    }
    setSavingGen(true)
    try {
      const body = limpar ? {} : { provider: genProvider, model: genModel }
      const r = await apiFetch<{ gen_provider: Provider | null; gen_model: string | null }>(
        '/api/llm/geracao',
        { method: 'PUT', body: JSON.stringify(body) }
      )
      setGenAtual({ provider: r.data.gen_provider, model: r.data.gen_model })
      setGenMsg(
        r.data.gen_model
          ? `Modelo de geração: ${r.data.gen_provider}/${r.data.gen_model}`
          : 'Geração voltou a usar o modelo de atendimento.'
      )
    } catch (e: unknown) {
      setGenMsg(e instanceof Error ? e.message : 'Erro ao salvar modelo de geração.')
    } finally {
      setSavingGen(false)
    }
  }

  const badge = status?.status === 'ativo'
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">ativo</span>
    : status?.status === 'erro'
      ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">erro</span>
      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">pendente</span>

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Modelo LLM</h1>
        {status && badge}
      </div>

      {agentePausado !== null && (
        <div className="bg-white border rounded-2xl p-6 shadow-sm flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold">Agente da empresa</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Quando pausado, o agente não responde mensagens recebidas no WhatsApp.
              Use pra atender manualmente sem o bot interromper.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAgenteState(false)}
              disabled={togglingAgente || !agentePausado}
              className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                !agentePausado
                  ? 'bg-green-600 text-white cursor-default'
                  : 'border border-green-600 text-green-600 hover:bg-green-50 disabled:opacity-50'
              }`}
            >
              Ativar
            </button>
            <button
              type="button"
              onClick={() => setAgenteState(true)}
              disabled={togglingAgente || agentePausado}
              className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                agentePausado
                  ? 'bg-red-600 text-white cursor-default'
                  : 'border border-red-600 text-red-600 hover:bg-red-50 disabled:opacity-50'
              }`}
            >
              Pausar
            </button>
            <span className={`text-xs px-3 py-1 rounded-full font-semibold ${
              agentePausado ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {agentePausado ? 'pausado' : 'ativo'}
            </span>
          </div>
        </div>
      )}

      {status && (
        <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
          <h2 className="font-semibold">Configuração ativa</h2>
          <div className="grid grid-cols-2 gap-y-1 text-sm">
            <span className="text-gray-500">Provider:</span>
            <span className="font-medium">{status.provider}</span>
            <span className="text-gray-500">Modelo:</span>
            <span className="font-mono text-xs">{status.model}</span>
            <span className="text-gray-500">OpenAI key:</span>
            <span className="font-mono text-xs">{status.openai_key_masked || '—'}</span>
            <span className="text-gray-500">Anthropic key:</span>
            <span className="font-mono text-xs">{status.anthropic_key_masked || '—'}</span>
            <span className="text-gray-500">Último teste:</span>
            <span className="text-xs">{status.tested_at ? new Date(status.tested_at).toLocaleString('pt-BR') : '—'}</span>
          </div>
          {status.status === 'erro' && status.last_error && (
            <pre className="mt-3 text-xs bg-red-50 text-red-800 p-3 rounded-lg whitespace-pre-wrap break-all">
              {status.last_error}
            </pre>
          )}
        </div>
      )}

      <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-semibold">Conectar novo provider</h2>

        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setProvider(p.id); setModels([]); setModelSelecionado(''); setErro(null) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                provider === p.id ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={PROVIDERS.find((p) => p.id === provider)?.placeholder}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            autoComplete="off"
          />
        </div>

        <button
          type="button"
          onClick={rodar}
          disabled={rodando || !apiKey}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {rodando ? 'Buscando modelos…' : 'Rodar'}
        </button>

        {models.length > 0 && (
          <div className="space-y-2 pt-2">
            <label className="text-sm font-medium">Modelo</label>
            <select
              value={modelSelecionado}
              onChange={(e) => setModelSelecionado(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— escolha um modelo —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}{m.owned_by ? ` (${m.owned_by})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={conectar}
              disabled={conectando || !modelSelecionado}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {conectando ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        )}

        {ok && <p className="text-sm text-green-700">{ok}</p>}
        {erro && (
          <pre className="text-xs bg-red-50 text-red-800 p-3 rounded-lg whitespace-pre-wrap break-all">
            {erro}
          </pre>
        )}
      </div>

      <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Modelo de geração</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Usado só na hora de <strong>gerar</strong> contexto, estágios e playbook (não fica atendendo).
            Reusa a chave do provider de atendimento — você só escolhe um modelo (ex.: um mais
            capaz pra geração). Sem nada definido, a geração usa o mesmo modelo do atendimento.
          </p>
        </div>

        <div className="text-sm">
          <span className="text-gray-500">Atual: </span>
          {genAtual.model ? (
            <span className="font-mono text-xs">{genAtual.provider}/{genAtual.model}</span>
          ) : (
            <span className="text-gray-600">usando o modelo de atendimento</span>
          )}
        </div>

        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setGenProvider(p.id); setGenModel(''); setGenMsg(null) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                genProvider === p.id ? 'bg-brand text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Modelo</label>
          <select
            value={genModel}
            onChange={(e) => setGenModel(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— escolha um modelo —</option>
            {(presets?.[genProvider]?.models || []).map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            {genModel && !(presets?.[genProvider]?.models || []).some((m) => m.value === genModel) && (
              <option value={genModel}>{genModel}</option>
            )}
          </select>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => salvarGeracao(false)}
            disabled={savingGen || !genModel}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {savingGen ? 'Salvando…' : 'Salvar modelo de geração'}
          </button>
          <button
            type="button"
            onClick={() => salvarGeracao(true)}
            disabled={savingGen || (!genAtual.model && !genAtual.provider)}
            className="text-sm px-4 py-2 rounded-lg font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Usar o mesmo do atendimento
          </button>
        </div>

        {genMsg && <p className="text-sm text-gray-700">{genMsg}</p>}
      </div>
    </div>
  )
}
