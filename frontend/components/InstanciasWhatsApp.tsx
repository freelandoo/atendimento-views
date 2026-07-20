'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { IconCalendar } from '@/components/ui/icons'

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
  config_json?: { usa_agenda?: boolean; saudacao?: string } | null
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

export default function InstanciasWhatsApp({ empresaId }: {
  empresaId: string
}) {
  const [instancias, setInstancias] = useState<WhatsAppInstance[]>([])
  // Estado REAL de conexão por instância (open/close na Evolution). true/false/null(desconhecido).
  const [statusConexao, setStatusConexao] = useState<Record<string, boolean | null>>({})
  const [nomeInstance, setNomeInstance] = useState('')
  const novaInstance = useMemo(() => slugifyInstance(nomeInstance), [nomeInstance])
  const [msg, setMsg] = useState('')
  const [erroForm, setErroForm] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [qr, setQr] = useState<QRState>({
    open: false, instanceId: null, instanceLabel: '', loading: false,
    base64: null, pairingCode: null, connected: false, error: null,
  })

  // Busca o estado de conexão real de cada instância (open/close na Evolution).
  async function carregarStatusConexao(lista: WhatsAppInstance[]) {
    const entradas = await Promise.all(lista.map(async (inst) => {
      try {
        const s = await apiFetch<{ connected: boolean | null }>(`/api/empresas/${empresaId}/whatsapp/${inst.id}/status`)
        return [inst.id, s.data.connected] as const
      } catch { return [inst.id, null] as const }
    }))
    setStatusConexao(Object.fromEntries(entradas))
  }

  useEffect(() => {
    if (!empresaId) return
    let vivo = true
    apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`)
      .then((w) => {
        if (!vivo) return
        setInstancias(w.data)
        carregarStatusConexao(w.data || [])
      })
      .catch((e: unknown) => setErroForm(e instanceof Error ? e.message : 'Erro ao carregar instâncias WhatsApp.'))
    // Revalida o status a cada 30s (detecta desconexão sem recarregar a página).
    const t = setInterval(() => {
      apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`)
        .then((w) => {
          if (!vivo) return
          setInstancias(w.data || [])
          carregarStatusConexao(w.data || [])
        })
        .catch(() => {})
    }, 30000)
    return () => { vivo = false; clearInterval(t) }
  }, [empresaId])

  // Auto-atualiza o QR enquanto o modal está aberto e não conectou (o QR expira a cada
  // ~20-40s no Baileys/Evolution). Também detecta quando parear e vira "Conectado".
  useEffect(() => {
    if (!qr.open || !qr.instanceId || qr.connected) return
    const instId = qr.instanceId
    const t = setInterval(async () => {
      try {
        const r = await apiFetch<{ connected: boolean; base64?: string; pairingCode?: string }>(
          `/api/empresas/${empresaId}/whatsapp/${instId}/qrcode`
        )
        setQr((q) => (q.open && q.instanceId === instId
          ? { ...q, connected: !!r.data.connected, base64: r.data.base64 || q.base64, pairingCode: r.data.pairingCode || q.pairingCode }
          : q))
        if (r.data.connected) setStatusConexao((prev) => ({ ...prev, [instId]: true }))
      } catch { /* silencioso */ }
    }, 20000)
    return () => clearInterval(t)
  }, [qr.open, qr.instanceId, qr.connected, empresaId])

  async function toggleAtivo(inst: WhatsAppInstance) {
    if (!empresaId) return
    setErroForm('')
    const novo = !inst.ativo
    try {
      const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo: novo }),
      })
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, ativo: r.data.ativo } : x)))
      setMsg(novo ? 'Número ativado — o agente volta a responder por ele.' : 'Número desativado — o agente para de responder por ele.')
    } catch (err: unknown) {
      setErroForm(err instanceof Error ? err.message : 'Erro ao alterar o status do número.')
    }
  }

  async function toggleUsaAgenda(inst: WhatsAppInstance) {
    if (!empresaId) return
    setErroForm('')
    const atual = inst.config_json?.usa_agenda !== false // default ligado
    const novo = !atual
    // otimista
    setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: { ...(x.config_json || {}), usa_agenda: novo } } : x)))
    try {
      const r = await apiFetch<WhatsAppInstance>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ usa_agenda: novo }),
      })
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: r.data.config_json } : x)))
      setMsg(novo
        ? 'Agenda ativada nesta instância. Gere o contexto dela de novo para a mudança valer no texto.'
        : 'Agenda desativada nesta instância. Gere o contexto dela de novo para a mudança valer no texto.')
    } catch (err: unknown) {
      // reverte
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: { ...(x.config_json || {}), usa_agenda: atual } } : x)))
      setErroForm(err instanceof Error ? err.message : 'Erro ao alterar a agenda da instância.')
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
      // Reflete o estado real no badge do card (verde quando parear).
      setStatusConexao((prev) => ({ ...prev, [inst.id]: !!r.data.connected }))
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
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={nomeInstance}
            onChange={(e) => setNomeInstance(e.target.value)}
            placeholder="Nome amigável (ex: Vendas BR)"
            required
            className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            disabled={adicionando || !novaInstance}
            className="shrink-0 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instancias.map((i) => (
          <div key={i.id} className="overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-sm">
            {/* Cabeçalho preto com o nome da instância na fonte e cores da marca */}
            <div className="bg-black px-4 py-5 text-center">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Instância</p>
              <h3 className="truncate font-display text-xl font-bold bg-gradient-to-r from-neon-magenta to-neon-cyan bg-clip-text text-transparent">
                {i.nome || i.evolution_instance}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-white/40">{i.evolution_instance}</p>
            </div>

            {/* Corpo do card: status + botões sobre o fundo do card */}
            <div className="space-y-3 p-4">
              {/* UM selo só, por prioridade: inativo → desconectado → conectado → (verificando). */}
              <div className="flex justify-center">
                {!i.ativo ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-mid">○ inativo</span>
                ) : statusConexao[i.id] === false ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-red/40 bg-neon-red/15 px-2.5 py-0.5 text-[11px] font-medium text-neon-red">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    Desconectado
                  </span>
                ) : statusConexao[i.id] === true ? (
                  <span className="rounded-full border border-neon-lime/30 bg-neon-lime/15 px-2.5 py-0.5 text-[11px] font-medium text-neon-lime">🟢 Conectado</span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-mid">● ativo · verificando…</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/dashboard/instancias/${i.id}/contexto`}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-violet/40 px-3 py-2 text-xs font-medium text-neon-violet transition-colors hover:bg-neon-violet/15"
                  title="Abrir o contexto desta instância (fontes, Contexto 1, playbook, estágios)"
                >
                  Contexto
                </Link>
                <button
                  type="button"
                  onClick={() => abrirQrCode(i)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-cyan/40 px-3 py-2 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/15"
                >
                  Gerar QR Code
                </button>
                <button
                  type="button"
                  onClick={() => toggleAtivo(i)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${i.ativo ? 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15' : 'border-neon-lime/40 text-neon-lime hover:bg-neon-lime/15'}`}
                  title={i.ativo ? 'Desativar este número (o agente para de responder por ele)' : 'Ativar este número (o agente volta a responder por ele)'}
                >
                  {i.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  onClick={() => removerInstancia(i)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-red/40 px-3 py-2 text-xs font-medium text-neon-red transition-colors hover:bg-neon-red/15"
                  aria-label="Remover instância"
                >
                  Remover
                </button>
              </div>

              {/* Usa agenda? é regra DESTA instância (default ligado). Impacta a geração
                  de contexto e o runtime: desligado, o agente nunca oferece reunião. */}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1 text-[11px] font-medium text-white/80"><IconCalendar className="h-3.5 w-3.5" /> Usa agenda?</p>
                  <p className="text-[10px] text-white/40 leading-tight">
                    {i.config_json?.usa_agenda !== false
                      ? 'Tenta agendar reunião quando fizer sentido.'
                      : 'Nunca oferece reunião — só qualifica e encaminha.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={i.config_json?.usa_agenda !== false}
                  onClick={() => toggleUsaAgenda(i)}
                  title="Liga/desliga a agenda nesta instância (gere o contexto de novo depois)"
                  className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition ${i.config_json?.usa_agenda !== false ? 'bg-neon-cyan' : 'bg-white/20'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${i.config_json?.usa_agenda !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {instancias.length === 0 && (
          <p className="col-span-full text-sm text-gray-400">Nenhuma instância ainda. Adicione uma acima.</p>
        )}
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
                <p className="text-[11px] text-center text-gray-400">O QR se atualiza sozinho a cada ~20s — escaneie assim que aparecer.</p>
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
