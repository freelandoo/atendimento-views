'use client'
import { useMemo, useState } from 'react'
import { getEmpresaId } from '@/lib/api'
import { Spinner } from '@/components/feedback/FeedbackProvider'

// Tela "Gerar Playbook de Atendimento".
// Recebe um token da API de Dados da Freelandoo (flnd_data_...), o backend puxa
// todos os endpoints, agrega e gera um playbook em Markdown. O token é tratado
// como segredo: nunca é salvo em localStorage nem logado no cliente.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
const PREFIXO = 'flnd_data_'

type Estado = 'vazio' | 'carregando' | 'erro' | 'sucesso'

type PlaybookResp = {
  markdown: string
  username: string | null
  gerado_em: string
  provider?: string
  model?: string
  avisos?: string[]
}

type ErroTipo = 'invalido' | 'escopo' | 'limite' | 'rede' | 'generico'

function authToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('token') || ''
}

export default function PlaybookPage() {
  const [token, setToken] = useState('')
  const [mostrarToken, setMostrarToken] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [estado, setEstado] = useState<Estado>('vazio')
  const [erro, setErro] = useState<{ tipo: ErroTipo; msg: string } | null>(null)
  const [resultado, setResultado] = useState<PlaybookResp | null>(null)
  const [copiado, setCopiado] = useState(false)

  const tokenLimpo = token.trim()
  const formatoOk = tokenLimpo === '' || tokenLimpo.startsWith(PREFIXO)
  const podeGerar = tokenLimpo.startsWith(PREFIXO) && estado !== 'carregando'

  const empresaId = useMemo(() => (typeof window !== 'undefined' ? getEmpresaId() : ''), [])

  async function gerar() {
    setErro(null)
    if (!tokenLimpo.startsWith(PREFIXO)) {
      setErro({ tipo: 'invalido', msg: `O token precisa começar com "${PREFIXO}".` })
      return
    }
    if (!empresaId) {
      setErro({ tipo: 'generico', msg: 'Nenhuma empresa selecionada.' })
      return
    }

    setEstado('carregando')
    setResultado(null)
    try {
      const res = await fetch(`${BASE_URL}/api/empresas/${empresaId}/playbook/gerar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
        },
        body: JSON.stringify({ token: tokenLimpo, base_url: baseUrl.trim() || undefined }),
      })

      if (!res.ok) {
        let msg = ''
        try { msg = (await res.json())?.error?.message || '' } catch { /* sem corpo */ }
        if (res.status === 401) {
          setErro({ tipo: 'invalido', msg: msg || 'Token inválido ou revogado. Gere um novo na Freelandoo.' })
        } else if (res.status === 403) {
          setErro({ tipo: 'escopo', msg: msg || 'Recurso desligado ou token do tipo errado para esta conta.' })
        } else if (res.status === 429) {
          const ra = Number(res.headers.get('retry-after'))
          const seg = Number.isFinite(ra) && ra > 0 ? ` Tente novamente em ${ra}s.` : ' Tente novamente em instantes.'
          setErro({ tipo: 'limite', msg: (msg || 'Limite de requisições atingido.') + seg })
        } else {
          setErro({ tipo: 'generico', msg: msg || `Erro ${res.status} ao gerar o playbook.` })
        }
        setEstado('erro')
        return
      }

      const json = await res.json()
      setResultado(json.data as PlaybookResp)
      setEstado('sucesso')
    } catch {
      setErro({ tipo: 'rede', msg: 'Falha de rede ao falar com o servidor. Confira sua conexão e tente de novo.' })
      setEstado('erro')
    }
  }

  async function copiar() {
    if (!resultado) return
    try {
      await navigator.clipboard.writeText(resultado.markdown)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* clipboard indisponível */ }
  }

  function baixar() {
    if (!resultado) return
    const blob = new Blob([resultado.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const nome = resultado.username ? `playbook-${resultado.username}.md` : 'playbook-atendimento.md'
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Gerar Playbook de Atendimento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cole o token da API de Dados da Freelandoo. Puxamos os dados da conta do vendedor
          e geramos um playbook em Markdown para usar como base de conhecimento no atendimento.
        </p>
      </header>

      {/* Formulário */}
      <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
        <div>
          <label htmlFor="pb-token" className="mb-1 block text-sm font-medium text-slate-700">
            Token da API de Dados (Freelandoo)
          </label>
          <div className="flex gap-2">
            <input
              id="pb-token"
              type={mostrarToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="flnd_data_…"
              autoComplete="off"
              spellCheck={false}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
                formatoOk ? 'border-slate-300 focus:ring-brand/40' : 'border-red-400 focus:ring-red-300'
              }`}
            />
            <button
              type="button"
              onClick={() => setMostrarToken((v) => !v)}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {mostrarToken ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {!formatoOk && (
            <p className="mt-1 text-xs text-red-600">O token precisa começar com &quot;{PREFIXO}&quot;.</p>
          )}
        </div>

        <div>
          <label htmlFor="pb-base" className="mb-1 block text-sm font-medium text-slate-700">
            Base URL da API <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            id="pb-base"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://backend-da-freelandoo (padrão do sistema)"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/40"
          />
          <p className="mt-1 text-xs text-slate-400">Deixe em branco para usar a base padrão. O prefixo /ext/v1/data é adicionado automaticamente.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={gerar}
            disabled={!podeGerar}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {estado === 'carregando' && <Spinner />}
            {estado === 'carregando' ? 'Gerando…' : 'Gerar playbook'}
          </button>
          <span className="text-xs text-slate-400">O token não é salvo — é usado só para esta geração.</span>
        </div>
      </section>

      {/* Erro */}
      {estado === 'erro' && erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">
            {erro.tipo === 'invalido' && 'Token inválido'}
            {erro.tipo === 'escopo' && 'Sem acesso a este recurso'}
            {erro.tipo === 'limite' && 'Limite de requisições'}
            {erro.tipo === 'rede' && 'Falha de conexão'}
            {erro.tipo === 'generico' && 'Não foi possível gerar'}
          </p>
          <p className="mt-1">{erro.msg}</p>
        </div>
      )}

      {/* Carregando */}
      {estado === 'carregando' && (
        <div className="flex items-center gap-3 rounded-xl border bg-white p-5 text-sm text-slate-500 shadow-sm">
          <Spinner />
          Coletando dados da conta e montando o playbook… isso pode levar alguns segundos.
        </div>
      )}

      {/* Sucesso */}
      {estado === 'sucesso' && resultado && (
        <section className="rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Playbook gerado</h2>
              {resultado.username && <p className="text-xs text-slate-400">conta @{resultado.username}</p>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copiar}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {copiado ? 'Copiado!' : 'Copiar'}
              </button>
              <button
                type="button"
                onClick={baixar}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
              >
                Baixar .md
              </button>
            </div>
          </div>

          {resultado.avisos && resultado.avisos.length > 0 && (
            <div className="border-b bg-amber-50 p-3 text-xs text-amber-700">
              <p className="font-medium">Algumas seções ficaram incompletas:</p>
              <ul className="mt-1 list-disc pl-4">
                {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-5 text-sm leading-relaxed text-slate-800">
            {resultado.markdown}
          </pre>
        </section>
      )}

      {/* Vazio */}
      {estado === 'vazio' && (
        <p className="text-sm text-slate-400">
          Nenhum playbook gerado ainda. Cole um token válido e clique em “Gerar playbook”.
        </p>
      )}
    </div>
  )
}
