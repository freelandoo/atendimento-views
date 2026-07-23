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
  aviso?: string | null
}
type StatusConexaoInstancia = {
  id: string | null
  evolution_instance: string
  connected: boolean | null
  state: string
  motivo?: string | null
  last_checked_at?: string | null
  can_send?: boolean
}
type ResumoConexao = {
  total: number
  desconectadas: number
  desconhecidas?: number
  alguma_desconectada: boolean
  alguma_indisponivel?: boolean
  instancias: StatusConexaoInstancia[]
}
type RemocaoImpacto = {
  instance: { id: string; nome?: string | null; evolution_instance: string }
  banco_leads: { configuracao_usando: boolean; automatico_ativo: boolean; modo?: string | null }
  rascunhos_cancelaveis: number
  envios_em_andamento: number
  conversas_vinculadas: number
  contexto: { id?: string | null; sera_removido: boolean; compartilhado: boolean }
  bloqueia_remocao: boolean
  avisos: string[]
}
type SubstituicaoImpacto = {
  origem: { id: string; nome?: string | null; evolution_instance: string }
  destino: { id: string; nome?: string | null; evolution_instance: string; ativo: boolean }
  banco_leads: { configuracao_usando: boolean; automatico_ativo: boolean; modo?: string | null }
  rascunhos_transferiveis: number
  envios_em_andamento: number
  conversas_transferiveis: number
  destino_conversas_atuais: number
  contexto: {
    origem_id?: string | null
    destino_id?: string | null
    sera_transferido: boolean
    destino_contexto_substituido: boolean
  }
  bloqueia_substituicao: boolean
  avisos: string[]
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
  const [statusConexao, setStatusConexao] = useState<Record<string, StatusConexaoInstancia>>({})
  const [nomeInstance, setNomeInstance] = useState('')
  const novaInstance = useMemo(() => slugifyInstance(nomeInstance), [nomeInstance])
  const [msg, setMsg] = useState('')
  const [erroForm, setErroForm] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [remocao, setRemocao] = useState<{
    open: boolean
    loading: boolean
    removing: boolean
    inst: WhatsAppInstance | null
    impacto: RemocaoImpacto | null
    error: string | null
  }>({ open: false, loading: false, removing: false, inst: null, impacto: null, error: null })
  const [substituicao, setSubstituicao] = useState<{
    open: boolean
    loading: boolean
    transferindo: boolean
    origem: WhatsAppInstance | null
    destinoId: string
    impacto: SubstituicaoImpacto | null
    error: string | null
  }>({ open: false, loading: false, transferindo: false, origem: null, destinoId: '', impacto: null, error: null })
  const [qr, setQr] = useState<QRState>({
    open: false, instanceId: null, instanceLabel: '', loading: false,
    base64: null, pairingCode: null, connected: false, error: null,
  })

  // Busca o estado de conexão real de cada instância (open/close na Evolution).
  async function carregarInstancias({ silencioso = false }: { silencioso?: boolean } = {}) {
    if (!empresaId) return
    try {
      const [w, resumo] = await Promise.all([
        apiFetch<WhatsAppInstance[]>(`/api/empresas/${empresaId}/whatsapp`),
        apiFetch<ResumoConexao>(`/api/empresas/${empresaId}/whatsapp/conexao-resumo`).catch(() => null),
      ])
      setInstancias(w.data || [])
      const mapa: Record<string, StatusConexaoInstancia> = {}
      for (const status of resumo?.data?.instancias || []) {
        if (status.id) mapa[status.id] = status
      }
      setStatusConexao(mapa)
    } catch (e: unknown) {
      if (!silencioso) setErroForm(e instanceof Error ? e.message : 'Erro ao carregar instancias WhatsApp.')
    }
  }

  useEffect(() => {
    if (!empresaId) return
    carregarInstancias()
    // Revalida o status a cada 30s (detecta desconexão sem recarregar a página).
    const t = setInterval(() => {
      carregarInstancias({ silencioso: true })
    }, 30000)
    return () => { clearInterval(t) }
  }, [empresaId])

  // Auto-atualiza o QR enquanto o modal está aberto e não conectou (o QR expira a cada
  // ~20-40s no Baileys/Evolution). Também detecta quando parear e vira "Conectado".
  useEffect(() => {
    if (!qr.open || !qr.instanceId || qr.connected) return
    const instId = qr.instanceId
    const t = setInterval(async () => {
      try {
        const r = await apiFetch<{ connected: boolean; instance?: string; base64?: string; pairingCode?: string }>(
          `/api/empresas/${empresaId}/whatsapp/${instId}/qrcode`
        )
        setQr((q) => (q.open && q.instanceId === instId
          ? { ...q, connected: !!r.data.connected, base64: r.data.base64 || q.base64, pairingCode: r.data.pairingCode || q.pairingCode }
          : q))
        if (r.data.connected) {
          setStatusConexao((prev) => ({
            ...prev,
            [instId]: {
              id: instId,
              evolution_instance: r.data.instance || '',
              connected: true,
              state: 'open',
              last_checked_at: new Date().toISOString(),
              can_send: true,
            },
          }))
          carregarInstancias({ silencioso: true })
        }
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
      carregarInstancias({ silencioso: true })
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
      setMsg('Instância criada e sincronizada. Clique em "Gerar QR Code" para parear.')
      carregarInstancias({ silencioso: true })
    } catch (err: unknown) {
      setErroForm(err instanceof Error ? err.message : 'Falha ao criar instância.')
    } finally {
      setAdicionando(false)
    }
  }

  async function abrirRemocaoInstancia(inst: WhatsAppInstance) {
    if (!empresaId) return
    setMsg('')
    setErroForm('')
    setRemocao({ open: true, loading: true, removing: false, inst, impacto: null, error: null })
    try {
      const r = await apiFetch<RemocaoImpacto>(`/api/empresas/${empresaId}/whatsapp/${inst.id}/remocao-impacto`)
      setRemocao({ open: true, loading: false, removing: false, inst, impacto: r.data, error: null })
    } catch (err: unknown) {
      setRemocao({
        open: true,
        loading: false,
        removing: false,
        inst,
        impacto: null,
        error: err instanceof Error ? err.message : 'Falha ao calcular impacto da remocao.',
      })
    }
  }

  function fecharRemocao() {
    if (remocao.removing) return
    setRemocao({ open: false, loading: false, removing: false, inst: null, impacto: null, error: null })
  }

  async function confirmarRemocaoInstancia() {
    const inst = remocao.inst
    if (!empresaId || !inst || remocao.impacto?.bloqueia_remocao) return
    setRemocao((prev) => ({ ...prev, removing: true, error: null }))
    try {
      const r = await apiFetch<{
        limpeza?: {
          rascunhos_cancelados?: number
          conversas_desvinculadas?: number
          contexto_removido?: boolean
        }
      }>(`/api/empresas/${empresaId}/whatsapp/${inst.id}`, { method: 'DELETE' })
      setInstancias((prev) => prev.filter((i) => i.id !== inst.id))
      const limpeza = r.data.limpeza
      const detalhes = limpeza
        ? ` Rascunhos cancelados: ${limpeza.rascunhos_cancelados || 0}. Conversas desvinculadas: ${limpeza.conversas_desvinculadas || 0}.`
        : ''
      setMsg(`Instancia removida. Historico, leads e agenda foram preservados.${detalhes}`)
      setRemocao({ open: false, loading: false, removing: false, inst: null, impacto: null, error: null })
      carregarInstancias({ silencioso: true })
    } catch (err: unknown) {
      setRemocao((prev) => ({
        ...prev,
        removing: false,
        error: err instanceof Error ? err.message : 'Falha ao remover.',
      }))
    }
  }

  async function carregarImpactoSubstituicao(origem: WhatsAppInstance, destinoId: string) {
    setSubstituicao((prev) => ({ ...prev, loading: true, impacto: null, error: null, destinoId }))
    try {
      const r = await apiFetch<SubstituicaoImpacto>(
        `/api/empresas/${empresaId}/whatsapp/${origem.id}/substituicao-impacto?destino_id=${encodeURIComponent(destinoId)}`
      )
      setSubstituicao((prev) => ({
        ...prev,
        loading: false,
        destinoId,
        impacto: r.data,
        error: null,
      }))
    } catch (err: unknown) {
      setSubstituicao((prev) => ({
        ...prev,
        loading: false,
        destinoId,
        impacto: null,
        error: err instanceof Error ? err.message : 'Falha ao calcular impacto da substituicao.',
      }))
    }
  }

  async function abrirSubstituicaoInstancia(origem: WhatsAppInstance) {
    if (!empresaId) return
    setMsg('')
    setErroForm('')
    const destinos = instancias.filter((inst) => inst.id !== origem.id)
    const destinoInicial = destinos.find((inst) => inst.ativo)?.id || destinos[0]?.id || ''
    setSubstituicao({
      open: true,
      loading: !!destinoInicial,
      transferindo: false,
      origem,
      destinoId: destinoInicial,
      impacto: null,
      error: destinoInicial ? null : 'Crie a nova instancia primeiro, gere o QR Code e depois volte para substituir.',
    })
    if (destinoInicial) await carregarImpactoSubstituicao(origem, destinoInicial)
  }

  function fecharSubstituicao() {
    if (substituicao.transferindo) return
    setSubstituicao({ open: false, loading: false, transferindo: false, origem: null, destinoId: '', impacto: null, error: null })
  }

  async function selecionarDestinoSubstituicao(destinoId: string) {
    const origem = substituicao.origem
    if (!origem || !destinoId) return
    await carregarImpactoSubstituicao(origem, destinoId)
  }

  async function confirmarSubstituicaoInstancia() {
    const origem = substituicao.origem
    if (!empresaId || !origem || !substituicao.destinoId || substituicao.impacto?.bloqueia_substituicao) return
    setSubstituicao((prev) => ({ ...prev, transferindo: true, error: null }))
    try {
      const r = await apiFetch<{
        transferencia?: {
          banco_leads_config?: number
          rascunhos_transferidos?: number
          conversas_transferidas?: number
          contexto_transferido?: boolean
        }
      }>(`/api/empresas/${empresaId}/whatsapp/${origem.id}/substituir`, {
        method: 'POST',
        body: JSON.stringify({ destino_instance_id: substituicao.destinoId }),
      })
      const transferencia = r.data.transferencia
      const detalhes = transferencia
        ? ` Conversas: ${transferencia.conversas_transferidas || 0}. Rascunhos: ${transferencia.rascunhos_transferidos || 0}.`
        : ''
      setMsg(`Instancia substituida. A antiga foi desativada e os vinculos passaram para a nova.${detalhes}`)
      setSubstituicao({ open: false, loading: false, transferindo: false, origem: null, destinoId: '', impacto: null, error: null })
      carregarInstancias({ silencioso: true })
    } catch (err: unknown) {
      setSubstituicao((prev) => ({
        ...prev,
        transferindo: false,
        error: err instanceof Error ? err.message : 'Falha ao substituir instancia.',
      }))
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
      setStatusConexao((prev) => ({
        ...prev,
        [inst.id]: {
          id: inst.id,
          evolution_instance: r.data.instance || inst.evolution_instance,
          connected: !!r.data.connected,
          state: r.data.connected ? 'open' : (prev[inst.id]?.state || 'qrcode'),
          last_checked_at: new Date().toISOString(),
          can_send: !!r.data.connected && inst.ativo,
        },
      }))
      if (r.data.connected) carregarInstancias({ silencioso: true })
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

  const impactoRemocao = remocao.impacto
  const podeConfirmarRemocao = !!impactoRemocao && !impactoRemocao.bloqueia_remocao && !remocao.loading && !remocao.removing
  const impactoSubstituicao = substituicao.impacto
  const destinosSubstituicao = substituicao.origem
    ? instancias.filter((inst) => inst.id !== substituicao.origem?.id)
    : []
  const podeConfirmarSubstituicao = !!impactoSubstituicao &&
    !impactoSubstituicao.bloqueia_substituicao &&
    !substituicao.loading &&
    !substituicao.transferindo

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
                ) : statusConexao[i.id]?.connected === false ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-red/40 bg-neon-red/15 px-2.5 py-0.5 text-[11px] font-medium text-neon-red">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    Desconectado
                  </span>
                ) : statusConexao[i.id]?.connected === true ? (
                  <span className="rounded-full border border-neon-lime/30 bg-neon-lime/15 px-2.5 py-0.5 text-[11px] font-medium text-neon-lime">🟢 Conectado</span>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-mid">● ativo · verificando…</span>
                )}
              </div>
              {i.ativo && statusConexao[i.id]?.connected === false && (
                <p className="text-center text-[11px] text-neon-amber">Leia o QR Code novamente para reconectar.</p>
              )}
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
                  onClick={() => abrirSubstituicaoInstancia(i)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-neon-amber/40 px-3 py-2 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/15"
                  aria-label="Substituir instancia"
                >
                  Substituir
                </button>
                <button
                  type="button"
                  onClick={() => abrirRemocaoInstancia(i)}
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

      {substituicao.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={fecharSubstituicao}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neon-amber/80">Substituir instancia</p>
                <h3 className="mt-1 font-display text-xl font-bold text-white">
                  {substituicao.origem?.nome || substituicao.origem?.evolution_instance || 'Instancia'}
                </h3>
                <p className="mt-1 font-mono text-[11px] text-white/45">{substituicao.origem?.evolution_instance}</p>
              </div>
              <button
                type="button"
                onClick={fecharSubstituicao}
                disabled={substituicao.transferindo}
                className="text-xl leading-none text-white/40 hover:text-white disabled:opacity-40"
                aria-label="Fechar"
              >
                x
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-xs font-medium text-white/60">
                Instancia nova
                <select
                  value={substituicao.destinoId}
                  onChange={(e) => selecionarDestinoSubstituicao(e.target.value)}
                  disabled={substituicao.loading || substituicao.transferindo || destinosSubstituicao.length === 0}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan disabled:opacity-50"
                >
                  {destinosSubstituicao.length === 0 ? (
                    <option value="">Nenhuma instancia disponivel</option>
                  ) : destinosSubstituicao.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.nome || inst.evolution_instance}
                    </option>
                  ))}
                </select>
              </label>

              {substituicao.loading && (
                <div className="py-8 text-center text-sm text-white/55">Calculando transferencia...</div>
              )}

              {substituicao.error && (
                <div className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
                  {substituicao.error}
                </div>
              )}

              {impactoSubstituicao && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-white/35">Conversas</p>
                      <p className="mt-1 text-lg font-semibold text-white">{impactoSubstituicao.conversas_transferiveis}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-white/35">Rascunhos</p>
                      <p className="mt-1 text-lg font-semibold text-white">{impactoSubstituicao.rascunhos_transferiveis}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-white/35">Envios</p>
                      <p className={`mt-1 text-lg font-semibold ${impactoSubstituicao.envios_em_andamento > 0 ? 'text-neon-red' : 'text-white'}`}>
                        {impactoSubstituicao.envios_em_andamento}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-white/35">Auto</p>
                      <p className={`mt-1 text-sm font-semibold ${impactoSubstituicao.banco_leads.configuracao_usando ? 'text-neon-amber' : 'text-white/70'}`}>
                        {impactoSubstituicao.banco_leads.configuracao_usando ? 'Transfere' : 'Nao usa'}
                      </p>
                    </div>
                  </div>

                  {impactoSubstituicao.avisos.length > 0 && (
                    <div className="space-y-2 text-sm text-white/70">
                      {impactoSubstituicao.avisos.map((aviso, idx) => (
                        <p key={idx} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">{aviso}</p>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/50">
                    Use isto quando o mesmo numero foi recriado em outra instancia. A antiga fica inativa e a nova assume os vinculos operacionais.
                  </div>

                  {impactoSubstituicao.bloqueia_substituicao && (
                    <div className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
                      Substituicao bloqueada enquanto houver envio em andamento. Aguarde a confirmacao do envio e tente novamente.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={fecharSubstituicao}
                disabled={substituicao.transferindo}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarSubstituicaoInstancia}
                disabled={!podeConfirmarSubstituicao}
                className="rounded-lg border border-neon-amber/40 px-4 py-2 text-sm font-medium text-neon-amber hover:bg-neon-amber/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {substituicao.transferindo ? 'Transferindo...' : 'Transferir vinculos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {remocao.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={fecharRemocao}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-neon-red/80">Remover instancia</p>
                <h3 className="mt-1 font-display text-xl font-bold text-white">
                  {remocao.inst?.nome || remocao.inst?.evolution_instance || 'Instancia'}
                </h3>
                <p className="mt-1 font-mono text-[11px] text-white/45">{remocao.inst?.evolution_instance}</p>
              </div>
              <button
                type="button"
                onClick={fecharRemocao}
                disabled={remocao.removing}
                className="text-xl leading-none text-white/40 hover:text-white disabled:opacity-40"
                aria-label="Fechar"
              >
                x
              </button>
            </div>

            {remocao.loading && (
              <div className="py-10 text-center text-sm text-white/55">Calculando impacto...</div>
            )}

            {remocao.error && (
              <div className="mt-4 rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
                {remocao.error}
              </div>
            )}

            {impactoRemocao && (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/35">Conversas</p>
                    <p className="mt-1 text-lg font-semibold text-white">{impactoRemocao.conversas_vinculadas}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/35">Rascunhos</p>
                    <p className="mt-1 text-lg font-semibold text-white">{impactoRemocao.rascunhos_cancelaveis}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/35">Envios</p>
                    <p className={`mt-1 text-lg font-semibold ${impactoRemocao.envios_em_andamento > 0 ? 'text-neon-red' : 'text-white'}`}>
                      {impactoRemocao.envios_em_andamento}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/35">Auto</p>
                    <p className={`mt-1 text-sm font-semibold ${impactoRemocao.banco_leads.configuracao_usando ? 'text-neon-amber' : 'text-white/70'}`}>
                      {impactoRemocao.banco_leads.configuracao_usando ? 'Usa' : 'Nao usa'}
                    </p>
                  </div>
                </div>

                {impactoRemocao.avisos.length > 0 && (
                  <div className="space-y-2 text-sm text-white/70">
                    {impactoRemocao.avisos.map((aviso, idx) => (
                      <p key={idx} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">{aviso}</p>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/50">
                  Historico, leads e agenda permanecem salvos. O contexto sera removido somente se for exclusivo desta instancia.
                </div>

                {impactoRemocao.bloqueia_remocao && (
                  <div className="rounded-lg border border-neon-red/30 bg-neon-red/10 px-3 py-2 text-sm text-neon-red">
                    Remocao bloqueada enquanto houver envio em andamento. Aguarde a confirmacao do envio e tente novamente.
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={fecharRemocao}
                disabled={remocao.removing}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarRemocaoInstancia}
                disabled={!podeConfirmarRemocao}
                className="rounded-lg border border-neon-red/40 px-4 py-2 text-sm font-medium text-neon-red hover:bg-neon-red/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {remocao.removing ? 'Removendo...' : 'Remover agora'}
              </button>
            </div>
          </div>
        </div>
      )}

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
