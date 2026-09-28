'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import ReuniaoJitsi from '@/components/ReuniaoJitsi'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

type SalaPublica = {
  provider: string
  provider_domain: string
  room_name: string
  status_presenca: string
  data_inicio: string | null
  data_fim: string | null
  titulo: string
  lead_nome: string | null
  aguardo_lead_minutos: number
}

const STATUS: Record<string, string> = {
  pendente: 'Aguardando entrada',
  host_entrou: 'Host na sala',
  lead_entrou: 'Sua presença foi registrada',
  ambos_entraram: 'Presença registrada',
  lead_nao_compareceu: 'Não compareceu',
  host_nao_entrou: 'Host não entrou',
  sem_presenca_registrada: 'Sem presença registrada',
}

async function fetchPublico<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message || `Erro ${res.status}`)
  return json.data
}

function dataHora(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ReuniaoPublicaPage() {
  const params = useParams<{ token: string }>()
  const [sala, setSala] = useState<SalaPublica | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!params.token) return
    fetchPublico<SalaPublica>(`/api/reunioes/${params.token}`)
      .then(setSala)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível abrir a reunião.'))
  }, [params.token])

  const registrar = useCallback(async (evento: 'entrou' | 'saiu', participante?: { id?: string; displayName?: string }) => {
    if (!params.token) return
    try {
      const data = await fetchPublico<SalaPublica>(`/api/reunioes/${params.token}/presenca`, {
        method: 'POST',
        body: JSON.stringify({
          evento,
          participante_id: participante?.id || null,
          display_name: participante?.displayName || null,
        }),
      })
      setSala(data)
    } catch {
      // A sala continua utilizável; o backend reconcilia a presença na próxima leitura.
    }
  }, [params.token])
  const registrarEntrada = useCallback((e?: { id?: string; displayName?: string }) => registrar('entrou', e), [registrar])
  const registrarSaida = useCallback((e?: { id?: string; displayName?: string }) => registrar('saiu', e), [registrar])

  return (
    <main className="min-h-dvh bg-surface px-4 py-5 text-ink md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="border-b border-line pb-4">
          <h1 className="text-xl font-semibold">{sala?.titulo || 'Reunião'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
            {sala?.data_inicio && <span>{dataHora(sala.data_inicio)}</span>}
            {sala && <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs">{STATUS[sala.status_presenca] || sala.status_presenca}</span>}
          </div>
        </header>
        {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
        {sala && (
          <ReuniaoJitsi
            domain={sala.provider_domain}
            roomName={sala.room_name}
            displayName={sala.lead_nome || 'Lead'}
            onEntrou={registrarEntrada}
            onSaiu={registrarSaida}
          />
        )}
      </div>
    </main>
  )
}
