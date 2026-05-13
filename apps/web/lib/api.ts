const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('token') || ''
}

export function getEmpresaId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('empresa_id') || ''
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data: T; error?: { code: string; message: string } }> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error?.message || `Erro ${res.status}`)
  }
  return json
}
