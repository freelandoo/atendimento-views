'use client'

import { useEffect, useRef, useState } from 'react'

type EventoParticipante = { id?: string; displayName?: string }

type Props = {
  domain: string
  roomName: string
  displayName?: string
  onEntrou?: (e?: EventoParticipante) => void | Promise<void>
  onSaiu?: (e?: EventoParticipante) => void | Promise<void>
}

type JitsiApi = {
  addListener: (evento: string, cb: (payload?: EventoParticipante) => void) => void
  dispose: () => void
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => JitsiApi
  }
}

function carregarScript(domain: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.JitsiMeetExternalAPI) return Promise.resolve()
  const id = `jitsi-api-${domain.replace(/[^a-z0-9]/gi, '-')}`
  const existente = document.getElementById(id) as HTMLScriptElement | null
  if (existente) {
    return new Promise((resolve, reject) => {
      existente.addEventListener('load', () => resolve(), { once: true })
      existente.addEventListener('error', () => reject(new Error('Não foi possível carregar a sala.')), { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.async = true
    script.src = `https://${domain}/external_api.js`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Não foi possível carregar a sala.'))
    document.head.appendChild(script)
  })
}

export default function ReuniaoJitsi({ domain, roomName, displayName, onEntrou, onSaiu }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<JitsiApi | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    setErro('')
    setCarregando(true)

    carregarScript(domain)
      .then(() => {
        if (cancelado || !ref.current || !window.JitsiMeetExternalAPI) return
        const api = new window.JitsiMeetExternalAPI(domain, {
          roomName,
          parentNode: ref.current,
          width: '100%',
          height: '100%',
          userInfo: displayName ? { displayName } : undefined,
          configOverwrite: {
            startWithAudioMuted: true,
            startWithVideoMuted: false,
            prejoinPageEnabled: true,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
          },
        })
        apiRef.current = api
        api.addListener('videoConferenceJoined', (e) => { void onEntrou?.(e) })
        api.addListener('videoConferenceLeft', (e) => { void onSaiu?.(e) })
        api.addListener('readyToClose', (e) => { void onSaiu?.(e) })
        setCarregando(false)
      })
      .catch((e) => {
        if (!cancelado) {
          setErro(e instanceof Error ? e.message : 'Não foi possível carregar a sala.')
          setCarregando(false)
        }
      })

    return () => {
      cancelado = true
      apiRef.current?.dispose()
      apiRef.current = null
    }
  }, [domain, roomName, displayName, onEntrou, onSaiu])

  return (
    <div className="relative min-h-[520px] overflow-hidden rounded-lg border border-line bg-ink">
      {carregando && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">Carregando sala…</div>}
      {erro && <div className="absolute inset-0 grid place-items-center bg-surface p-6 text-center text-sm text-red-600">{erro}</div>}
      <div ref={ref} className="h-[min(72vh,720px)] min-h-[520px] w-full" />
    </div>
  )
}
