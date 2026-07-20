'use client'
// Central de Follow-ups (Fase 1) — 3 modos:
//   • Atendimento humano (Semi): proxima melhor acao — assumir, ligar, revisar,
//     mensagem manual ou copiar prompt de preview para uso EXTERNO.
//   • Automático: visão/controle do motor de follow-up (reprocessar falhas, pausar, cancelar).
//   • Manual: gerar follow-up por IA, revisar e enviar 1:1.
// Consome /api/empresas/:id/follow-ups. Nenhuma regra de negócio no front.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import ConversaHistoricoModal from '@/components/ConversaHistoricoModal'
import { IconSend, IconGear, IconPlay, IconAlert, IconClose } from '@/components/ui/icons'

type Config = { modo: 'manual' | 'semi' | 'automatico'; meta_ligacoes_dia: number; pausado: boolean }
type AcaoHumana = 'assumir_conversa' | 'ligar' | 'copiar_prompt_preview' | 'revisar_proposta' | 'mensagem_manual'
type AtendimentoLead = {
  numero: string; telefone_digitos: string; nome: string; negocio: string | null; cidade: string | null
  estagio: string; dias_silencio: number; score: number; temperatura: 'quente' | 'morno' | 'frio'
  motivo: string; motivos: string[]; followups_ignorados: number; escalado: boolean
  acao_recomendada: AcaoHumana; acao_label: string; janela_recomendada: string
  orientacao: string; prompt_preview: string | null
}
type Resultado = 'atendeu' | 'nao_atendeu' | 'agendou' | 'sem_interesse' | 'ligar_depois'
type LigacaoRegistrada = { followup_erro: string | null }
const RESULTADO_LABEL: Record<Resultado, string> = {
  atendeu: 'Atendeu', nao_atendeu: 'Não atendeu', agendou: 'Agendou reunião',
  sem_interesse: 'Sem interesse', ligar_depois: 'Ligar depois',
}
type Agendamento = {
  id: number; numero: string; sequencia: number; status: 'agendado' | 'executado' | 'cancelado' | 'falhou'
  agendado_para: string | null; executado_em: string | null; cancelado_em: string | null
  motivo_decisao: string | null; detectado_em: string | null; estagio: string | null; nome: string
}
type Resumo = { agendado: number; executado: number; cancelado: number; falhou: number }

type Aba = 'semi' | 'automatico' | 'manual'

const TEMP_STYLE: Record<string, string> = {
  quente: 'bg-red-100 text-red-700 border-red-200',
  morno: 'bg-amber-100 text-amber-700 border-amber-200',
  frio: 'bg-sky-100 text-sky-700 border-sky-200',
}
const TEMP_ICON: Record<string, string> = { quente: '🔥', morno: '🌡️', frio: '❄️' }
const STATUS_STYLE: Record<string, string> = {
  agendado: 'bg-sky-100 text-sky-700', executado: 'bg-emerald-100 text-emerald-700',
  falhou: 'bg-red-100 text-red-700', cancelado: 'bg-slate-100 text-slate-500',
}
const STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', executado: 'Enviado', falhou: 'Falhou', cancelado: 'Cancelado',
}
const ACAO_STYLE: Record<AcaoHumana, string> = {
  assumir_conversa: 'border-red-200 bg-red-100 text-red-700',
  ligar: 'border-orange-200 bg-orange-100 text-orange-700',
  copiar_prompt_preview: 'border-violet-200 bg-violet-100 text-violet-700',
  revisar_proposta: 'border-amber-200 bg-amber-100 text-amber-700',
  mensagem_manual: 'border-sky-200 bg-sky-100 text-sky-700',
}

function fmtData(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtTelefone(digitos: string): string {
  const d = (digitos || '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length >= 10) return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`
  return digitos
}

export default function FollowUpsPage() {
  const fb = useFeedback()
  const empresaId = getEmpresaId()
  const base = `/api/empresas/${empresaId}/follow-ups`

  const [aba, setAba] = useState<Aba>('automatico')
  const [config, setConfig] = useState<Config | null>(null)
  const [numeroHistorico, setNumeroHistorico] = useState<string | null>(null)

  const carregarConfig = useCallback(async () => {
    try {
      const r = await apiFetch<Config>(`${base}/config`)
      setConfig(r.data)
    } catch { /* silencioso — usa default do backend */ }
  }, [base])

  useEffect(() => { carregarConfig() }, [carregarConfig])
  useEffect(() => {
    if (config?.modo) setAba(config.modo)
  }, [config?.modo])

  const salvarConfig = useCallback(async (patch: Partial<Config>) => {
    const r = await apiFetch<Config>(`${base}/config`, { method: 'PUT', body: JSON.stringify(patch) })
    setConfig(r.data)
    return r.data
  }, [base])

  const selecionarAba = useCallback((id: Aba) => {
    setAba(id)
    if (config?.modo !== id) {
      void salvarConfig({ modo: id }).catch((e) => {
        fb.toast(e instanceof Error ? e.message : 'Nao foi possivel salvar a aba preferida.', 'error')
      })
    }
  }, [config?.modo, salvarConfig, fb])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups</h1>
          <p className="text-sm text-slate-500">Priorize a próxima intervenção humana, controle o automático e envie manualmente quando necessário.</p>
        </div>
        {config?.pausado && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
            <IconAlert className="h-4 w-4" /> Automático pausado
          </span>
        )}
      </div>

      <div className="flex gap-2 border-b">
        {([['semi', '👤 Atendimento humano'], ['automatico', '🔵 Automático'], ['manual', '🟢 Manual']] as [Aba, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => selecionarAba(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${aba === id ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {aba === 'semi' && <AbaSemi base={base} empresaId={empresaId} config={config} onSalvarConfig={salvarConfig} onAbrirHistorico={setNumeroHistorico} fb={fb} />}
      {aba === 'automatico' && <AbaAutomatico base={base} config={config} onSalvarConfig={salvarConfig} onAbrirHistorico={setNumeroHistorico} fb={fb} />}
      {aba === 'manual' && <AbaManual base={base} fb={fb} />}

      {numeroHistorico && (
        <ConversaHistoricoModal empresaId={empresaId} numero={numeroHistorico} onClose={() => setNumeroHistorico(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────── SEMI (quem ligar) ───────────────────────────────
function AbaSemi({ base, config, onSalvarConfig, onAbrirHistorico, fb }: {
  base: string; empresaId: string; config: Config | null
  onSalvarConfig: (p: Partial<Config>) => Promise<Config>
  onAbrirHistorico: (n: string) => void; fb: ReturnType<typeof useFeedback>
}) {
  const [lista, setLista] = useState<AtendimentoLead[]>([])
  const [loading, setLoading] = useState(true)
  const [roteiro, setRoteiro] = useState<{ numero: string; nome: string; texto: string } | null>(null)
  const [metaInput, setMetaInput] = useState<string>('')
  const [registro, setRegistro] = useState<AtendimentoLead | null>(null)

  const meta = config?.meta_ligacoes_dia ?? 12

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch<{ lista: AtendimentoLead[]; meta_ligacoes_dia: number }>(`${base}/call-list`)
      setLista(r.data.lista)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao carregar', 'error') }
    finally { setLoading(false) }
  }, [base, fb])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { setMetaInput(String(meta)) }, [meta])

  const registrarResultado = useCallback(async (lead: AtendimentoLead, resultado: Resultado, notas: string, enviarFollowup: boolean) => {
    const out = await fb.runTask(async () => {
      const r = await apiFetch<LigacaoRegistrada>(`${base}/ligacoes`, {
        method: 'POST',
        body: JSON.stringify({ numero: lead.numero, resultado, notas: notas || undefined, enviar_followup: enviarFollowup }),
      })
      setRegistro(null)
      await carregar()
      return r.data
    }, { pesada: enviarFollowup, sucesso: null })
    fb.toast(
      out.followup_erro || 'Ligacao registrada',
      out.followup_erro ? 'error' : 'success'
    )
  }, [base, carregar, fb])

  const gerarRoteiro = useCallback(async (lead: AtendimentoLead) => {
    await fb.runTask(async () => {
      const r = await apiFetch<{ roteiro: string }>(`${base}/roteiro`, {
        method: 'POST', body: JSON.stringify({ numero: lead.numero, motivo: lead.motivo }),
      })
      setRoteiro({ numero: lead.numero, nome: lead.nome, texto: r.data.roteiro })
    }, { pesada: true, sucesso: 'Roteiro pronto' })
  }, [base, fb])

  const copiarPromptPreview = useCallback(async (lead: AtendimentoLead) => {
    if (!lead.prompt_preview) {
      fb.toast('Este lead ainda não possui contexto suficiente para o prompt.', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(lead.prompt_preview)
      fb.toast('Prompt copiado. Gere e revise a imagem fora do projeto.', 'success')
    } catch {
      fb.toast('Não foi possível copiar o prompt neste navegador.', 'error')
    }
  }, [fb])

  const salvarMeta = useCallback(async () => {
    const n = parseInt(metaInput, 10)
    if (!Number.isFinite(n)) return
    await fb.runTask(() => onSalvarConfig({ meta_ligacoes_dia: n }), { sucesso: 'Meta atualizada' })
  }, [metaInput, onSalvarConfig, fb])

  const resumoAcoes = useMemo(() => {
    const out: Record<AcaoHumana, number> = {
      assumir_conversa: 0, ligar: 0, copiar_prompt_preview: 0, revisar_proposta: 0, mensagem_manual: 0,
    }
    for (const lead of lista) out[lead.acao_recomendada] += 1
    return out
  }, [lista])
  const ligacoesNaMeta = useMemo(() => lista.filter((lead) => lead.acao_recomendada === 'ligar').slice(0, meta), [lista, meta])
  const numerosLigacoesNaMeta = useMemo(() => new Set(ligacoesNaMeta.map((lead) => lead.numero)), [ligacoesNaMeta])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricaCard label="Assumir agora" valor={resumoAcoes.assumir_conversa} cor="text-red-600" />
        <MetricaCard label="Ligar" valor={resumoAcoes.ligar} cor="text-orange-600" />
        <MetricaCard label="Prompt de preview" valor={resumoAcoes.copiar_prompt_preview} cor="text-violet-600" />
        <MetricaCard label="Outras ações" valor={resumoAcoes.revisar_proposta + resumoAcoes.mensagem_manual} cor="text-brand" />
      </div>
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Capacidade de ligações/dia</span>
          <input
            type="number" min={1} max={100} value={metaInput}
            onChange={(e) => setMetaInput(e.target.value)} onBlur={salvarMeta}
            className="w-20 rounded-lg border px-2 py-1 text-sm"
          />
        </div>
        <div className="text-sm text-slate-500">
          <b className="text-brand">{ligacoesNaMeta.length}</b> ligações na meta · <b>{lista.length}</b> ações humanas na fila
        </div>
        <button onClick={carregar} className="ml-auto rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Atualizar</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">
          Nenhuma intervenção humana recomendada agora. O automático continua acompanhando os demais leads.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Próxima ação</th>
                <th className="px-4 py-3">Por que agora</th>
                <th className="px-4 py-3">Melhor horário</th>
                <th className="px-4 py-3">Prioridade</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.map((lead, i) => (
                <tr key={lead.numero} className={numerosLigacoesNaMeta.has(lead.numero) ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{lead.nome}</span>
                      {lead.escalado && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600" title={`Ignorou ${lead.followups_ignorados} follow-ups no WhatsApp`}>
                          escalado
                        </span>
                      )}
                    </div>
                    {(lead.negocio || lead.cidade) && (
                      <div className="text-xs text-slate-400">{[lead.negocio, lead.cidade].filter(Boolean).join(' · ')}</div>
                    )}
                    <button onClick={() => onAbrirHistorico(lead.numero)} className="text-brand hover:underline">
                      {fmtTelefone(lead.telefone_digitos)}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${ACAO_STYLE[lead.acao_recomendada]}`}>
                      {lead.acao_label}
                    </span>
                  </td>
                  <td className="max-w-sm px-4 py-3 text-slate-600">
                    <div>{lead.motivo}</div>
                    <div className="mt-1 text-xs text-slate-400">{lead.orientacao}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lead.janela_recomendada}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TEMP_STYLE[lead.temperatura]}`}>
                      {TEMP_ICON[lead.temperatura]} {lead.score}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {lead.acao_recomendada === 'ligar' && (
                        <>
                          <button onClick={() => gerarRoteiro(lead)} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">Roteiro</button>
                          <button onClick={() => setRegistro(lead)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Registrar</button>
                        </>
                      )}
                      {lead.acao_recomendada === 'copiar_prompt_preview' && (
                        <button onClick={() => copiarPromptPreview(lead)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white">
                          Copiar prompt
                        </button>
                      )}
                      {!['ligar', 'copiar_prompt_preview'].includes(lead.acao_recomendada) && (
                        <button onClick={() => onAbrirHistorico(lead.numero)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">
                          Abrir conversa
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {roteiro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRoteiro(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">📋 Roteiro — {roteiro.nome}</h3>
              <button onClick={() => setRoteiro(null)} className="text-slate-400 hover:text-slate-600"><IconClose className="h-5 w-5" /></button>
            </div>
            <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{roteiro.texto}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(roteiro.texto); fb.toast('Roteiro copiado') }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Copiar</button>
              <button onClick={() => setRoteiro(null)} className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {registro && (
        <ModalRegistrarLigacao
          lead={registro}
          onFechar={() => setRegistro(null)}
          onRegistrar={registrarResultado}
        />
      )}
    </div>
  )
}

function MetricaCard({ label, valor, cor }: { label: string; valor: number | string; cor: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className={`text-2xl font-bold ${cor}`}>{valor}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function ModalRegistrarLigacao({ lead, onFechar, onRegistrar }: {
  lead: AtendimentoLead
  onFechar: () => void
  onRegistrar: (lead: AtendimentoLead, resultado: Resultado, notas: string, enviarFollowup: boolean) => Promise<void>
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [notas, setNotas] = useState('')
  const [enviarFollowup, setEnviarFollowup] = useState(false)
  const resultados: Resultado[] = ['atendeu', 'agendou', 'ligar_depois', 'nao_atendeu', 'sem_interesse']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">📞 Resultado — {lead.nome}</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600"><IconClose className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {resultados.map((r) => (
            <button
              key={r}
              onClick={() => setResultado(r)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${resultado === r ? 'border-brand bg-brand text-white' : 'hover:bg-slate-50'}`}
            >
              {RESULTADO_LABEL[r]}
            </button>
          ))}
        </div>
        <textarea
          value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
          maxLength={2000}
          placeholder="Notas da ligação (opcional)"
          className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
        />
        {resultado === 'nao_atendeu' && (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={enviarFollowup} onChange={(e) => setEnviarFollowup(e.target.checked)} />
            Não atendeu? Disparar um follow-up no WhatsApp agora (IA).
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onFechar} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Cancelar</button>
          <button
            disabled={!resultado}
            onClick={() => resultado && onRegistrar(lead, resultado, notas, enviarFollowup)}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Registrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────── AUTOMÁTICO ───────────────────────────────
function AbaAutomatico({ base, config, onSalvarConfig, onAbrirHistorico, fb }: {
  base: string; config: Config | null
  onSalvarConfig: (p: Partial<Config>) => Promise<Config>
  onAbrirHistorico: (n: string) => void; fb: ReturnType<typeof useFeedback>
}) {
  const [itens, setItens] = useState<Agendamento[]>([])
  const [resumo, setResumo] = useState<Resumo>({ agendado: 0, executado: 0, cancelado: 0, falhou: 0 })
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<string>('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const q = filtro ? `?status=${filtro}` : ''
      const r = await apiFetch<{ itens: Agendamento[]; resumo: Resumo }>(`${base}/auto${q}`)
      setItens(r.data.itens); setResumo(r.data.resumo)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao carregar', 'error') }
    finally { setLoading(false) }
  }, [base, filtro, fb])

  useEffect(() => { carregar() }, [carregar])

  const reprocessar = useCallback(async () => {
    await fb.runTask(async () => {
      const r = await apiFetch<{ reprocessados: number }>(`${base}/auto/reprocessar`, { method: 'POST', body: '{}' })
      await carregar()
      return r
    }, { pesada: true, sucesso: 'Follow-ups que falharam foram reenfileirados' })
  }, [base, carregar, fb])

  const togglePausa = useCallback(async () => {
    const novo = !config?.pausado
    await fb.runTask(() => onSalvarConfig({ pausado: novo }), { sucesso: novo ? 'Automático pausado' : 'Automático retomado' })
  }, [config, onSalvarConfig, fb])

  const cancelarLead = useCallback(async (numero: string) => {
    await fb.runTask(async () => {
      await apiFetch(`${base}/auto/cancelar`, { method: 'POST', body: JSON.stringify({ numero }) })
      await carregar()
    }, { sucesso: 'Follow-up cancelado' })
  }, [base, carregar, fb])

  const cards: [string, number, string, Agendamento['status']][] = [
    ['Agendados', resumo.agendado, 'text-sky-600', 'agendado'],
    ['Enviados', resumo.executado, 'text-emerald-600', 'executado'],
    ['Falharam', resumo.falhou, 'text-red-600', 'falhou'],
    ['Cancelados', resumo.cancelado, 'text-slate-400', 'cancelado'],
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, n, cor, status]) => (
          <button
            key={label}
            onClick={() => setFiltro(filtro === status ? '' : status)}
            aria-pressed={filtro === status}
            className={`rounded-2xl border bg-white p-4 text-left shadow-sm hover:shadow ${filtro === status ? 'ring-2 ring-brand/30' : ''}`}
          >
            <div className={`text-2xl font-bold ${cor}`}>{n}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-4 shadow-sm">
        <button onClick={togglePausa} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${config?.pausado ? 'bg-emerald-600 text-white' : 'border hover:bg-slate-50'}`}>
          {config?.pausado ? <><IconPlay className="h-4 w-4" /> Retomar automático</> : <><IconGear className="h-4 w-4" /> Pausar automático</>}
        </button>
        {resumo.falhou > 0 && (
          <button onClick={reprocessar} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
            <IconAlert className="h-4 w-4" /> Reprocessar {resumo.falhou} falhas
          </button>
        )}
        <button onClick={carregar} className="ml-auto rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Atualizar</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : itens.length === 0 ? (
        <div className="rounded-2xl border bg-white p-10 text-center text-slate-500 shadow-sm">Sem follow-ups automáticos {filtro ? 'com esse status' : 'ainda'}.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Seq.</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-3">
                    <button onClick={() => onAbrirHistorico(it.numero)} className="font-medium text-brand hover:underline">{it.nome}</button>
                    {it.estagio && <div className="text-xs text-slate-400">{it.estagio}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{it.sequencia}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                    {it.status === 'falhou' && it.motivo_decisao && <div className="mt-0.5 max-w-xs truncate text-xs text-red-400" title={it.motivo_decisao}>{it.motivo_decisao}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtData(it.executado_em || it.agendado_para)}</td>
                  <td className="px-4 py-3 text-right">
                    {it.status === 'agendado' && (
                      <button onClick={() => cancelarLead(it.numero)} className="rounded-lg border px-2.5 py-1 text-xs hover:bg-slate-50">Cancelar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────── MANUAL ───────────────────────────────
function AbaManual({ base, fb }: { base: string; fb: ReturnType<typeof useFeedback> }) {
  const [numero, setNumero] = useState('')
  const [texto, setTexto] = useState('')
  const [gerando, setGerando] = useState(false)

  const numeroJid = useMemo(() => {
    const d = numero.replace(/\D/g, '')
    if (!d) return ''
    return d.includes('@') ? numero : `${d}@s.whatsapp.net`
  }, [numero])

  const gerar = useCallback(async () => {
    if (!numeroJid) { fb.toast('Informe o telefone do lead', 'error'); return }
    setGerando(true)
    try {
      const r = await apiFetch<{ texto: string }>(`${base}/manual/gerar`, { method: 'POST', body: JSON.stringify({ numero: numeroJid }) })
      setTexto(r.data.texto)
    } catch (e) { fb.toast(e instanceof Error ? e.message : 'Falha ao gerar', 'error') }
    finally { setGerando(false) }
  }, [base, numeroJid, fb])

  const enviar = useCallback(async () => {
    if (!numeroJid || !texto.trim()) { fb.toast('Gere e revise a mensagem antes de enviar', 'error'); return }
    await fb.runTask(async () => {
      await apiFetch(`${base}/manual/enviar`, { method: 'POST', body: JSON.stringify({ numero: numeroJid, texto: texto.trim() }) })
      setTexto('')
    }, { pesada: true, sucesso: 'Follow-up enviado' })
  }, [base, numeroJid, texto, fb])

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-slate-600">Telefone do lead</label>
        <div className="flex gap-2">
          <input
            value={numero} onChange={(e) => setNumero(e.target.value)}
            maxLength={30}
            placeholder="Ex: 11987654321"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <button onClick={gerar} disabled={gerando} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {gerando ? <Spinner /> : <IconGear className="h-4 w-4" />} Gerar por IA
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">A IA usa o histórico e o contexto da empresa. Você revisa antes de enviar.</p>
      </div>

      {texto && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <label className="mb-1 block text-sm font-medium text-slate-600">Mensagem (revise e edite se quiser)</label>
          <textarea
            value={texto} onChange={(e) => setTexto(e.target.value)} rows={5}
            maxLength={4096}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end">
            <button onClick={enviar} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
              <IconSend className="h-4 w-4" /> Enviar follow-up
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
