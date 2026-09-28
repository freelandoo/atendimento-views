'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import ReuniaoJitsi from '@/components/ReuniaoJitsi'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Sala = {
  id: string
  agenda_evento_id: string
  provider: string
  provider_domain: string
  room_name: string
  status_presenca: string
  lead_url: string
  aguardo_lead_minutos: number
}

const STATUS: Record<string, string> = {
  pendente: 'Aguardando entrada',
  host_entrou: 'Você entrou',
  lead_entrou: 'Lead entrou',
  ambos_entraram: 'Presença dos dois registrada',
  lead_nao_compareceu: 'Lead não compareceu',
  host_nao_entrou: 'Host não entrou',
  sem_presenca_registrada: 'Sem presença registrada',
}

export default function SalaReuniaoPage() {
  const params = useParams<{ id: string }>()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [sala, setSala] = useState<Sala | null>(null)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!empresaId || !params.id) return
    apiFetch<Sala>(`/api/empresas/${empresaId}/agenda/${params.id}/sala`, { method: 'POST' })
      .then((r) => setSala(r.data))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível abrir a reunião.'))
  }, [empresaId, params.id])

  const registrar = useCallback(async (evento: 'entrou' | 'saiu', participante?: { id?: string; displayName?: string }) => {
    if (!empresaId || !params.id) return
    try {
      const r = await apiFetch<Sala>(`/api/empresas/${empresaId}/agenda/${params.id}/sala/presenca`, {
        method: 'POST',
        body: JSON.stringify({
          evento,
          participante_id: participante?.id || null,
          display_name: participante?.displayName || null,
        }),
      })
      setSala(r.data)
    } catch {
      // A sala continua utilizável; a próxima leitura reconcilia o status.
    }
  }, [empresaId, params.id])
  const registrarEntrada = useCallback((e?: { id?: string; displayName?: string }) => registrar('entrou', e), [registrar])
  const registrarSaida = useCallback((e?: { id?: string; displayName?: string }) => registrar('saiu', e), [registrar])

  async function copiarLink() {
    if (!sala) return
    await navigator.clipboard.writeText(`${window.location.origin}${sala.lead_url}`)
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 1600)
  }

  return (
    <main className="min-h-dvh bg-surface px-4 py-5 text-ink md:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-semibold">Sala de reunião</h1>
            <p className="mt-1 text-sm text-ink-3">
              {sala ? STATUS[sala.status_presenca] || sala.status_presenca : 'Preparando sala'}
            </p>
          </div>
          {sala && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={copiarLink}
                className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-3">
                {copiado ? 'Link copiado' : 'Copiar link do lead'}
              </button>
              <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-3">
                Ausência em {sala.aguardo_lead_minutos} min
              </span>
            </div>
          )}
        </header>

        {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
        {sala && (
          <ReuniaoJitsi
            domain={sala.provider_domain}
            roomName={sala.room_name}
            displayName="Host"
            onEntrou={registrarEntrada}
            onSaiu={registrarSaida}
          />
        )}
      </div>
    </main>
  )
}
