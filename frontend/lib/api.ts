import { cabecalhosOrigem } from '@/lib/sessao-origem'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('token') || ''
}

export function getEmpresaId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('empresa_id') || ''
}

// Erro enriquecido lançado por apiFetch: status HTTP (quando houve resposta) e isNetwork
// (falha de conexão). Permite ao chamador distinguir sessão/permissão/conflito/rede.
export interface ApiError extends Error {
  status?: number
  code?: string
  isNetwork?: boolean
}

type ApiFetchInit = RequestInit & { timeoutMs?: number }

const DEFAULT_TIMEOUT_MS = 180000

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchInit = {}
): Promise<{ ok: boolean; data: T; error?: { code: string; message: string } }> {
  const token = getToken()
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // Origem da SESSAO (aparelho/navegador). Vai daqui, e não só nas chamadas da Central de
    // Ligações, porque "de qual aparelho isto partiu" é um fato do CLIENTE, não de um módulo:
    // espalhá-lo por chamador faria a auditoria depender de alguém lembrar de anexá-lo.
    // Nada aqui identifica a pessoa — ver `lib/sessao-origem.js`. Hoje só as rotas de ligação
    // leem esses cabeçalhos; as demais simplesmente os ignoram.
    ...cabecalhosOrigem(),
    ...(options.headers as Record<string, string> | undefined),
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    })
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') {
      const e = new Error(`Tempo esgotado após ${Math.round(timeoutMs / 1000)}s. Tente de novo ou cheque os logs.`) as ApiError
      e.isNetwork = true
      throw e
    }
    // Falha de conexão (backend fora do ar, DNS, etc.) — marca como erro de REDE (≠ auth).
    const e = new Error('Falha de conexão com o servidor.') as ApiError
    e.isNetwork = true
    e.cause = err
    throw e
  } finally {
    clearTimeout(timer)
  }

  let json
  try {
    json = await res.json()
  } catch {
    const e = new Error(`Erro ${res.status}: resposta inválida do servidor.`) as ApiError
    e.status = res.status
    throw e
  }
  if (!json.ok) {
    // Anexa status/código HTTP para o chamador mapear (401=sessão, 403=permissão, 409=conflito…).
    const e = new Error(json.error?.message || `Erro ${res.status}`) as ApiError
    e.status = res.status
    e.code = json.error?.code
    throw e
  }
  return json
}

// Baixa um arquivo autenticado (ex.: export CSV) e dispara o download no browser.
// Diferente de apiFetch, não tenta parsear JSON — lê o corpo como blob.
export async function apiDownload(path: string, nomePadrao = 'export.csv'): Promise<void> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Erro ${res.status} ao gerar o arquivo.`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomePadrao
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
