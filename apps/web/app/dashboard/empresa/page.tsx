'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Empresa = { id: string; nome: string; slug: string; plano: string; ativo: boolean }
type WhatsAppInstance = { id: string; evolution_instance: string; nome?: string; ativo: boolean }
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

export default function EmpresaPage() {
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [instancias, setInstancias] = useState<WhatsAppInstance[]>([])
  const [novaInstance, setNovaInstance] = useState('')
  const [nomeInstance, setNomeInstance] = useState('')
  const [msg, setMsg] = useState('')
  const [qr, setQr] = useState<QRState>({
    open: false, instanceId: null, instanceLabel: '', loading: false,
    base64: null, pairingCode: null, connected: false, error: null,
  })

  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  useEffect(() => {
    if (!empresaId) return
    Promise.all([
      apiFetch<Empresa>(`/api/empresas/${empresaId}`),
      apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`),
    ]).then(([e, w]) => {
      setEmpresa(e.data)
      setInstancias(w.data)
    }).catch(() => {})
  }, [empresaId])

  async function adicionarInstancia(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ evolution_instance: novaInstance, nome: nomeInstance }),
    })
    setInstancias((prev) => [...prev, r.data])
    setNovaInstance('')
    setNomeInstance('')
    setMsg('Instância adicionada com sucesso.')
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
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Configurações da Empresa</h1>

      {empresa && (
        <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
          <p className="text-sm text-gray-500">Nome</p>
          <p className="font-semibold text-lg">{empresa.nome}</p>
          <p className="text-sm text-gray-500 mt-2">Plano: <span className="text-gray-800">{empresa.plano}</span></p>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold">Instâncias WhatsApp</h2>
        <form onSubmit={adicionarInstancia} className="flex gap-3">
          <input
            value={nomeInstance}
            onChange={(e) => setNomeInstance(e.target.value)}
            placeholder="Nome amigável"
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <input
            value={novaInstance}
            onChange={(e) => setNovaInstance(e.target.value)}
            placeholder="evolution_instance (ex: MinhaEmpresa)"
            required
            className="border rounded-lg px-3 py-2 text-sm flex-1"
          />
          <button className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark">
            Adicionar
          </button>
        </form>
        {msg && <p className="text-sm text-brand">{msg}</p>}
        <div className="space-y-2">
          {instancias.map((i) => (
            <div key={i.id} className="bg-white border rounded-xl px-4 py-3 flex justify-between items-center">
              <div>
                <p className="font-medium text-sm">{i.nome || i.evolution_instance}</p>
                <p className="text-xs text-gray-500 font-mono">{i.evolution_instance}</p>
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
              </div>
            </div>
          ))}
        </div>
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
