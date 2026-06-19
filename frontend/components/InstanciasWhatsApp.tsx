'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

function slugifyInstance(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

type WhatsAppInstance = {
  id: string
  evolution_instance: string
  nome?: string
  ativo: boolean
  contexto_id?: string | null
  contexto_nome?: string | null
}
type QRState = {
  open: boolean
  instanceId: string | null
  instanceLabel: string
  loading: boolean
  base64: string | null
  pairingCode: string | null
  connected: boolean
  error: string | null
}

export default function InstanciasWhatsApp({ empresaId, contextos }: {
  empresaId: string
  contextos: { id: string; nome: string }[]
}) {
  const [instancias, setInstancias] = useState<WhatsAppInstance[]>([])
  const [nomeInstance, setNomeInstance] = useState('')
  const novaInstance = useMemo(() => slugifyInstance(nomeInstance), [nomeInstance])
  const [msg, setMsg] = useState('')
  const [erroForm, setErroForm] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [qr, setQr] = useState<QRState>({
    open: false, instanceId: null, instanceLabel: '', loading: false,
    base64: null, pairingCode: null, connected: false, error: null,
  })

  useEffect(() => {
    if (!empresaId) return
    apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`)
      .then((w) => setInstancias(w.data))
      .catch(() => {})
  }, [empresaId])

  async function vincularContexto(inst: WhatsAppInstance, contextoId: string | null) {
    if (!empresaId) return
    try {
      const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ contexto_id: contextoId }),
      })
      setInstancias((prev) => prev.map((x) =>
        x.id === inst.id ? { ...x, contexto_id: r.data.contexto_id, contexto_nome: contextos.find((c) => c.id === contextoId)?.nome || null } : x
      ))
      setMsg(contextoId ? 'Instância vinculada ao contexto.' : 'Vínculo removido (usará o contexto ativo da empresa).')
    } catch (err: unknown) {
      setErroForm(err instanceof Error ? err.message : 'Erro ao vincular.')
    }
  }

  async function adicionarInstancia(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setErroForm('')
    setMsg('')
    if (!novaInstance) {
      setErroForm('Digite um nome amigável válido (letras/números).')
      return
    }
    setAdicionando(true)
    try {
      const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp`, {
        method: 'POST',
        body: JSON.stringify({ evolution_instance: novaInstance, nome: nomeInstance }),
      })
      setInstancias((prev) => [r.data, ...prev])
      setNomeInstance('')
      setMsg('Instância criada e sincronizada no Evolution. Clique em "Gerar QR Code" para parear.')
    } catch (err: unknown) {
      setErroForm(err instanceof Error ? err.message : 'Falha ao criar instância.')
    } finally {
      setAdicionando(false)
    }
  }

  async function removerInstancia(inst: WhatsAppInstance) {
    if (!empresaId) return
    if (!confirm(`Remover "${inst.nome || inst.evolution_instance}"? Isso apaga também no Evolution e desconecta o WhatsApp.`)) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, { method: 'DELETE' })
      setInstancias((prev) => prev.filter((i) => i.id !== inst.id))
      setMsg('Instância removida.')
    } catch (err: unknown) {
      setErroForm(err instanceof Error ? err.message : 'Falha ao remover.')
    }
  }

  async function abrirQrCode(inst: WhatsAppInstance) {
    if (!empresaId) return
    setQr({
      open: true, instanceId: inst.id, instanceLabel: inst.nome || inst.evolution_instance,
      loading: true, base64: null, pairingCode: null, connected: false, error: null,
    })
    try {
      const r = await apiFetch<{
        connected: boolean
        instance: string
        base64?: string
        pairingCode?: string
      }>(`/api/empresas/${empresaId}/whatsapp/${inst.id}/qrcode`)
      setQr((q) => ({
        ...q, loading: false,
        connected: !!r.data.connected,
        base64: r.data.base64 || null,
        pairingCode: r.data.pairingCode || null,
      }))
    } catch (err: unknown) {
      setQr((q) => ({
        ...q, loading: false,
        error: err instanceof Error ? err.message : 'Falha ao gerar QR Code.',
      }))
    }
  }

  function fecharQr() {
    setQr({
      open: false, instanceId: null, instanceLabel: '', loading: false,
      base64: null, pairingCode: null, connected: false, error: null,
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Instâncias WhatsApp</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Ao adicionar, a instância é criada automaticamente no Evolution. Depois clique em "Gerar QR Code" para parear o WhatsApp.
        </p>
      </div>
      <form onSubmit={adicionarInstancia} className="space-y-2">
        <div className="flex gap-3">
          <input
            value={nomeInstance}
            onChange={(e) => setNomeInstance(e.target.value)}
            placeholder="Nome amigável (ex: Vendas BR)"
            required
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <button
            disabled={adicionando || !novaInstance}
            className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
          >
            {adicionando ? 'Criando…' : 'Adicionar'}
          </button>
        </div>
        {nomeInstance && (
          <p className="text-xs text-gray-500">
            ID técnico: <span className="font-mono text-gray-800">{novaInstance || '—'}</span>
            {!novaInstance && ' (use letras ou números)'}
          </p>
        )}
      </form>
      {msg && <p className="text-sm text-brand">{msg}</p>}
      {erroForm && <p className="text-sm text-red-600">{erroForm}</p>}
      <div className="space-y-2">
        {instancias.map((i) => (
          <div key={i.id} className="bg-white border rounded-xl px-4 py-3 flex justify-between items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm truncate">{i.nome || i.evolution_instance}</p>
              <p className="text-xs text-gray-500 font-mono truncate">{i.evolution_instance}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Contexto:</label>
              <select
                value={i.contexto_id || ''}
                onChange={(e) => vincularContexto(i, e.target.value || null)}
                className="text-xs border rounded-lg px-2 py-1.5 bg-white min-w-[180px]"
                title="Vincule um Contexto a esta instância — o agente usará o playbook ativo desse contexto"
              >
                <option value="">— sem vínculo (usa contexto ativo da empresa) —</option>
                {contextos.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => abrirQrCode(i)}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand text-brand hover:bg-brand hover:text-white transition-colors font-medium"
              >
                Gerar QR Code
              </button>
              <span className={`text-xs px-2 py-0.5 rounded-full ${i.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {i.ativo ? 'ativo' : 'inativo'}
              </span>
              <button
                type="button"
                onClick={() => removerInstancia(i)}
                className="text-xs text-red-600 hover:underline"
                aria-label="Remover instância"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>

      {qr.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={fecharQr}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">Conectar WhatsApp</h3>
                <p className="text-xs text-gray-500 mt-0.5">{qr.instanceLabel}</p>
              </div>
              <button
                onClick={fecharQr}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            {qr.loading && (
              <div className="py-12 text-center text-sm text-gray-500">Gerando QR Code…</div>
            )}

            {qr.error && (
              <div className="py-6 text-center text-sm text-red-600">{qr.error}</div>
            )}

            {!qr.loading && !qr.error && qr.connected && (
              <div className="py-6 text-center text-sm">
                <p className="text-green-700 font-medium">WhatsApp já conectado ✓</p>
                <p className="text-gray-500 mt-1">Esta instância já está pareada.</p>
              </div>
            )}

            {!qr.loading && !qr.error && !qr.connected && qr.base64 && (
              <>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qr.base64.startsWith('data:') ? qr.base64 : `data:image/png;base64,${qr.base64}`}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64"
                  />
                </div>
                <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                  <li>Abra o WhatsApp no celular</li>
                  <li>Toque em ⋮ → <strong>Aparelhos conectados</strong></li>
                  <li>Toque em <strong>Conectar um aparelho</strong></li>
                  <li>Aponte a câmera para este QR Code</li>
                </ol>
                {qr.pairingCode && (
                  <p className="text-xs text-center text-gray-500">
                    Código de pareamento: <span className="font-mono font-semibold">{qr.pairingCode}</span>
                  </p>
                )}
              </>
            )}

            <button
              onClick={() => qr.instanceId && abrirQrCode(instancias.find((i) => i.id === qr.instanceId)!)}
              disabled={qr.loading}
              className="w-full text-xs text-brand hover:underline disabled:opacity-50"
            >
              Atualizar QR Code
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
