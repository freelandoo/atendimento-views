'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { IconCalendar } from '@/components/ui/icons'

type FreelandooInstance = {
  id: string
  evolution_instance: string
  nome?: string
  ativo: boolean
  contexto_id?: string | null
  contexto_nome?: string | null
  config_json?: { usa_agenda?: boolean } | null
  connection_name?: string | null
  username?: string | null
  scope_personal?: boolean | null
  webhook_url?: string | null
}

export default function InstanciasFreelandoo({ empresaId }: { empresaId: string }) {
  const [instancias, setInstancias] = useState<FreelandooInstance[]>([])
  const [token, setToken] = useState('')
  const [nome, setNome] = useState('')
  const [conectando, setConectando] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!empresaId) return
    apiFetch<FreelandooInstance[]>(`/api/empresas/${empresaId}/freelandoo`)
      .then((r) => setInstancias(r.data))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Erro ao carregar contas Freelandoo.'))
  }, [empresaId])

  async function conectar(e: React.FormEvent) {
    e.preventDefault()
    if (!empresaId) return
    setErro('')
    setMsg('')
    if (!token.trim()) {
      setErro('Cole o token da Freelandoo (flnd_atd_...).')
      return
    }
    setConectando(true)
    try {
      const r = await apiFetch<FreelandooInstance & { aviso?: string }>(`/api/empresas/${empresaId}/freelandoo`, {
        method: 'POST',
        body: JSON.stringify({ token: token.trim(), nome: nome.trim() }),
      })
      setInstancias((prev) => [r.data, ...prev])
      setToken('')
      setNome('')
      setMsg((r as { aviso?: string })?.aviso || 'Conta Freelandoo conectada. O contexto dela já pode ser gerado — o bot vai responder as conversas existentes.')
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao conectar a conta Freelandoo.')
    } finally {
      setConectando(false)
    }
  }

  // Ativo e "usa agenda?" são a MESMA regra por instância do WhatsApp — reusa o endpoint /whatsapp (mesma tabela).
  async function toggleAtivo(inst: FreelandooInstance) {
    if (!empresaId) return
    setErro('')
    const novo = !inst.ativo
    try {
      const r = await apiFetch<FreelandooInstance>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ ativo: novo }),
      })
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, ativo: r.data.ativo } : x)))
      setMsg(novo ? 'Conta habilitada — o bot volta a responder por ela.' : 'Conta desabilitada — o bot para de responder por ela.')
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Erro ao alterar o status.')
    }
  }

  async function toggleUsaAgenda(inst: FreelandooInstance) {
    if (!empresaId) return
    setErro('')
    const atual = inst.config_json?.usa_agenda !== false
    const novo = !atual
    setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: { ...(x.config_json || {}), usa_agenda: novo } } : x)))
    try {
      const r = await apiFetch<FreelandooInstance>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, {
        method: 'PATCH', body: JSON.stringify({ usa_agenda: novo }),
      })
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: r.data.config_json } : x)))
    } catch (err: unknown) {
      setInstancias((prev) => prev.map((x) => (x.id === inst.id ? { ...x, config_json: { ...(x.config_json || {}), usa_agenda: atual } } : x)))
      setErro(err instanceof Error ? err.message : 'Erro ao alterar a agenda.')
    }
  }

  async function reconectar(inst: FreelandooInstance) {
    if (!empresaId) return
    setErro('')
    try {
      await apiFetch(`/api/empresas/${empresaId}/freelandoo/${inst.id}/reconectar`, { method: 'POST' })
      setMsg('Webhook registrado de novo. O bot já recebe as mensagens novas.')
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao reconectar.')
    }
  }

  async function remover(inst: FreelandooInstance) {
    if (!empresaId) return
    if (!confirm(`Remover a conta "${inst.nome || inst.connection_name || inst.evolution_instance}"? Isso desconecta o atendimento Freelandoo.`)) return
    try {
      await apiFetch(`/api/empresas/${empresaId}/freelandoo/${inst.id}`, { method: 'DELETE' })
      setInstancias((prev) => prev.filter((i) => i.id !== inst.id))
      setMsg('Conta Freelandoo removida.')
    } catch (err: unknown) {
      setErro(err instanceof Error ? err.message : 'Falha ao remover.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Instância Freelandoo</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Em vez de ler um QR Code, cole o token da API de Atendimento da Freelandoo. O bot passa a LER e RESPONDER as
          conversas do vendedor — <strong>nunca inicia conversa</strong>, só responde as que já existem.
          Gere o token em freelandoo.com/mensagens → "Conectar atendimento".
        </p>
      </div>

      <form onSubmit={conectar} className="space-y-2">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome amigável (ex: Freelandoo — João)"
          className="border rounded-lg px-3 py-2 text-sm w-full"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cole o token (flnd_atd_...)"
            className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm font-mono"
          />
          <button
            disabled={conectando || !token.trim()}
            className="shrink-0 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50"
          >
            {conectando ? 'Validando…' : 'Conectar'}
          </button>
        </div>
      </form>
      {msg && <p className="text-sm text-brand">{msg}</p>}
      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instancias.map((i) => (
          <div key={i.id} className="overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-sm">
            <div className="bg-black px-4 py-5 text-center">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">Freelandoo</p>
              <h3 className="truncate font-display text-xl font-bold bg-gradient-to-r from-neon-magenta to-neon-cyan bg-clip-text text-transparent">
                {i.nome || i.connection_name || i.evolution_instance}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-white/40">
                {i.username ? `@${i.username}` : i.connection_name || '—'}
              </p>
            </div>

            <div className="space-y-3 p-4">
              <div className="flex justify-center">
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${i.ativo && i.webhook_url ? 'border-neon-lime/30 bg-neon-lime/15 text-neon-lime' : i.ativo ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-white/10 bg-white/5 text-mid'}`}>
                  {i.ativo && i.webhook_url ? '● habilitada · webhook configurado' : i.ativo ? '⚠ habilitada · webhook ausente' : '○ desabilitada'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/dashboard/instancias/${i.id}/contexto`}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-violet/40 px-3 py-2 text-xs font-medium text-neon-violet transition-colors hover:bg-neon-violet/15"
                  title="Abrir o contexto desta conta (fontes, Contexto 1, playbook, estágios)"
                >
                  Contexto
                </Link>
                <button
                  type="button"
                  onClick={() => reconectar(i)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-cyan/40 px-3 py-2 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/15"
                  title="Registrar o webhook de novo na Freelandoo"
                >
                  Reconectar
                </button>
                <button
                  type="button"
                  onClick={() => toggleAtivo(i)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${i.ativo ? 'border-neon-amber/40 text-neon-amber hover:bg-neon-amber/15' : 'border-neon-lime/40 text-neon-lime hover:bg-neon-lime/15'}`}
                >
                  {i.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  onClick={() => remover(i)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-red/40 px-3 py-2 text-xs font-medium text-neon-red transition-colors hover:bg-neon-red/15"
                >
                  Remover
                </button>
              </div>

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
                  className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition ${i.config_json?.usa_agenda !== false ? 'bg-neon-cyan' : 'bg-white/20'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${i.config_json?.usa_agenda !== false ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {instancias.length === 0 && (
          <p className="col-span-full text-sm text-gray-400">Nenhuma conta Freelandoo conectada. Cole um token acima.</p>
        )}
      </div>
    </div>
  )
}
