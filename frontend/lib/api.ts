const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('token') || ''
}

export function getEmpresaId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('empresa_id') || ''
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
      throw new Error(`Tempo esgotado após ${Math.round(timeoutMs / 1000)}s. Tente de novo ou cheque os logs.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  let json
  try {
    json = await res.json()
  } catch {
    throw new Error(`Erro ${res.status}: resposta inválida do servidor.`)
  }
  if (!json.ok) {
    throw new Error(json.error?.message || `Erro ${res.status}`)
  }
  return json
}
