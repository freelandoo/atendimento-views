'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { EmailEditavel } from '@/components/EmailEditavel'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import NeonProgress from '@/components/ui/NeonProgress'
import ModalAgenda from '@/components/ui/ModalAgenda'
import JsonLeadModal, { ThOrdenavel, type JsonApresentacao } from '@/components/ui/JsonLeadModal'

type JsonApresProspect = JsonApresentacao & {
  empresa?: { horario_funcionamento?: boolean; fotos?: number }
}

type Prospect = {
  id: string
  nome: string
  telefone: string | null
  email: string | null
  nicho: string
  cidade: string
  endereco: string | null
  rating: number | null
  avaliacoes: number | null
  tem_site: boolean
  site: string | null
  maps_url: string | null
  status: string
  score: number | null
  score_cadastro: number | null
  score_cadastro_max: number | null
  json_apresentacao: JsonApresProspect | null
  created_at: string | null
}
type Metricas = {
  total: string; aguardando: string; aprovados: string; rejeitados: string
  enviados: string; responderam: string; taxa_resposta: number
}
type Config = {
  ativo: boolean; modo: string
  categoria_padrao: string | null; cidade_padrao: string | null
  estado_padrao: string | null; regiao_padrao: string | null
  limite_diario: number; intervalo_envio_minutos: number
  horario_inicio: string; horario_fim: string
  gerar_mensagem_ia: boolean; envio_real_habilitado: boolean
  // "Agenda": re-busca automática do Google Places a cada X horas.
  agendamento_busca_ativo: boolean; busca_intervalo_horas: number
  ultima_busca_em: string | null
}
type Agenda = {
  total_slots: number; primeiro_slot: string | null; ultimo_slot: string | null
  envio_real_habilitado?: boolean; observacao?: string
}
type ConfigResp = { config: Config; agenda: Agenda; escopo: string }
type Mercado = { nicho: string; cidade: string; total: string; enviados: string; responderam: string }
type Recente = { nome: string; telefone: string | null; nicho: string; cidade: string; score: number | null; updated_at: string }
type ResultadosResp = { por_mercado: Mercado[]; recentes: Recente[] }
type Rank = { chave: string; mensagens_enviadas: number; respostas: number; taxa_resposta: number; reunioes: number }
type Analytics = {
  metricas: {
    mensagens_enviadas: number; respostas: number; taxa_resposta: number
    diagnostico: number; proposta: number; reunioes: number; fechados: number
  }
  melhores: { categoria: Rank | null; cidade: Rank | null; horario: Rank | null }
}

const STATUS_STYLE: Record<string, string> = {
  aguardando: 'bg-slate-100 text-slate-600',
  aprovado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-red-100 text-red-600',
  enviado: 'bg-blue-100 text-blue-700',
  respondeu: 'bg-orange-100 text-orange-700',
}

const FILTROS: { valor: string; label: string }[] = [
  { valor: '', label: 'Todos' },
  { valor: 'aguardando', label: 'Aguardando' },
  { valor: 'aprovado', label: 'Aprovados' },
  { valor: 'rejeitado', label: 'Rejeitados' },
  { valor: 'enviado', label: 'Enviados' },
  { valor: 'respondeu', label: 'Responderam' },
]

// Temperatura do lead pela pontuação (score): quente = mais dor digital / maior chance.
function temperatura(score: number | null): { emoji: string; label: string } {
  const s = score ?? 0
  if (s >= 70) return { emoji: '🔥', label: 'Quente' }
  if (s >= 40) return { emoji: '🌡️', label: 'Morno' }
  return { emoji: '❄️', label: 'Frio' }
}

// Data/hora "Entrou em" (1ª coluna): registro de quando o lead caiu na carteira.
function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Valor de cada coluna pra ordenação (clique no cabeçalho alterna asc/desc).
function valorColuna(p: Prospect, chave: string): number | string {
  switch (chave) {
    case 'entrou': return p.created_at || ''
    case 'nome': return (p.nome || '').toLowerCase()
    case 'telefone': return p.telefone || ''
    case 'email': return p.email || ''
    case 'endereco': return (p.endereco || '').toLowerCase()
    case 'nicho': return `${p.nicho || ''} ${p.cidade || ''}`.toLowerCase()
    case 'aval': return p.avaliacoes ?? -1
    case 'nota': return p.rating ?? -1
    case 'horario': return p.json_apresentacao?.empresa?.horario_funcionamento ? 1 : 0
    case 'site': return p.tem_site ? 1 : 0
    case 'pontos': return p.score_cadastro ?? 0
    case 'status': return p.status || ''
    default: return 0
  }
}

function compararProspects(a: Prospect, b: Prospect, ordem: { chave: string; dir: 'asc' | 'desc' }): number {
  const va = valorColuna(a, ordem.chave)
  const vb = valorColuna(b, ordem.chave)
  const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
  return ordem.dir === 'asc' ? cmp : -cmp
}

export default function ProspeccaoPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [metricas, setMetricas] = useState<Metricas | null>(null)
  const [rotina, setRotina] = useState<ConfigResp | null>(null)
  const [resultados, setResultados] = useState<ResultadosResp | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [progresso, setProgresso] = useState<number | null>(null)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const [agindo, setAgindo] = useState<string | null>(null)
  const [agendaAberta, setAgendaAberta] = useState(false)
  const [form, setForm] = useState<Partial<Config>>({})
  // Ordenação da tabela: default = MENOS pontos de cadastro no topo (mais
  // oportunidade de venda). Clicar no cabeçalho alterna asc/desc por coluna.
  const [ordem, setOrdem] = useState<{ chave: string; dir: 'asc' | 'desc' }>({ chave: 'pontos', dir: 'asc' })
  const [jsonAberto, setJsonAberto] = useState<{ titulo: string; json: JsonApresProspect } | null>(null)
  const fb = useFeedback()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''

  function ordenarPor(chave: string) {
    setOrdem((o) => (o.chave === chave ? { chave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { chave, dir: 'desc' }))
  }

  function carregar() {
    if (!empresaId) return
    const qs = filtro ? `&status=${encodeURIComponent(filtro)}` : ''
    apiFetch<Prospect[]>(`/api/empresas/${empresaId}/prospeccao/prospects?limit=100${qs}`)
      .then((r) => setProspects(r.data || [])).catch((e) => setErro(e.message))
    apiFetch<Metricas>(`/api/empresas/${empresaId}/prospeccao/metricas`)
      .then((r) => setMetricas(r.data)).catch(() => {})
    apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`)
      .then((r) => setRotina(r.data)).catch(() => {})
    apiFetch<ResultadosResp>(`/api/empresas/${empresaId}/prospeccao/resultados`)
      .then((r) => setResultados(r.data)).catch(() => {})
    apiFetch<Analytics>(`/api/empresas/${empresaId}/prospeccao/analytics`)
      .then((r) => setAnalytics(r.data)).catch(() => {})
  }
  useEffect(() => { carregar() }, [empresaId, filtro])

  async function acao(id: string, acaoTipo: 'aprovar' | 'rejeitar') {
    if (!empresaId) return
    setAgindo(id)
    try {
      await fb.runTask(
        () => apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/${acaoTipo}`, { method: 'POST' }),
        { sucesso: acaoTipo === 'aprovar' ? 'Lead aprovado.' : 'Lead rejeitado.' }
      )
      carregar()
    } catch { /* erro já exibido pelo feedback */ }
    finally { setAgindo(null) }
  }

  async function salvarEmail(id: string, email: string) {
    await apiFetch(`/api/empresas/${empresaId}/prospeccao/prospects/${id}/email`, { method: 'PATCH', body: JSON.stringify({ email }) })
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, email: email || null } : p)))
    fb.toast(email ? 'E-mail salvo.' : 'E-mail removido.')
  }

  function abrirAgenda() {
    setErro('')
    setForm(rotina ? { ...rotina.config } : {
      ativo: true, modo: 'manual', limite_diario: 20, intervalo_envio_minutos: 15,
      horario_inicio: '08:00', horario_fim: '18:00',
      agendamento_busca_ativo: false, busca_intervalo_horas: 24,
    })
    setAgendaAberta(true)
  }
  function setF<K extends keyof Config>(k: K, v: Config[K]) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  const ordenados = [...prospects].sort((a, b) => compararProspects(a, b, ordem))

  // "Rodar" da Agenda: roda a busca AGORA (com barra) E salva a agenda recorrente.
  async function rodar() {
    if (!empresaId) return
    const nicho = (form.categoria_padrao || '').trim()
    const cidade = (form.cidade_padrao || '').trim()
    if (!nicho || !cidade) { setErro('Informe nicho e cidade na Agenda.'); return }

    // Regra de negócio: disparo real só liga junto com a geração de mensagem por IA.
    if (form.envio_real_habilitado) {
      if (!form.gerar_mensagem_ia) {
        setErro('Para ligar o disparo real é preciso também ligar a geração de mensagem por IA.')
        return
      }
      if (!rotina?.config.envio_real_habilitado) {
        const ok = window.confirm(
          '⚠️ Ligar o DISPARO REAL fará a rotina enviar mensagens de WhatsApp automaticamente aos leads aprovados, dentro da janela configurada.\n\nConfirma a ativação do envio real para esta empresa?'
        )
        if (!ok) return
      }
    }

    setErro('')
    setAgendaAberta(false)
    setBuscando(true)
    setProgresso(8)
    const timer = setInterval(() => {
      setProgresso((p) => (p == null || p >= 90 ? p : p + Math.max(1, Math.round((90 - p) * 0.12))))
    }, 400)
    try {
      // 1) Salva a agenda (rotina + busca recorrente a cada X horas).
      const r = await apiFetch<ConfigResp>(`/api/empresas/${empresaId}/prospeccao/configuracao`, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      setRotina(r.data)
      // 2) Roda a busca agora.
      await fb.runTask(
        () => apiFetch(`/api/empresas/${empresaId}/prospeccao/buscar`, {
          method: 'POST',
          body: JSON.stringify({ nicho, cidade, quantidade: 20 }),
        }),
        { pesada: true, sucesso: 'Busca concluída', detalhe: 'Os prospects aparecem na lista abaixo.' }
      )
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao rodar a agenda.')
    } finally {
      clearInterval(timer)
      setProgresso(100)
      setBuscando(false)
      setTimeout(() => setProgresso(null), 700)
    }
  }

  const cfg = rotina?.config
  const resumoAgenda = cfg
    ? [
        cfg.categoria_padrao || 'sem nicho',
        cfg.cidade_padrao || 'sem cidade',
        cfg.agendamento_busca_ativo ? `busca a cada ${cfg.busca_intervalo_horas}h` : 'busca manual',
      ].join(' · ')
    : 'configure nicho, cidade e frequência'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Prospecção</h1>
          <p className="text-sm text-slate-500 mt-1">Busque leads no Google e gerencie a carteira desta empresa. Tudo começa na <strong>Agenda</strong>.</p>
        </div>
        <button onClick={abrirAgenda}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          📅 Agenda
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm">
        <p className="truncate text-sm text-slate-600">
          <span className="font-medium text-slate-800">{cfg?.agendamento_busca_ativo ? 'Agenda ativa' : 'Agenda manual'}</span>
          <span className="text-slate-400"> · {resumoAgenda}</span>
        </p>
        <button onClick={abrirAgenda} className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
          Abrir Agenda
        </button>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.valor || 'todos'}
            onClick={() => setFiltro(f.valor)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${filtro === f.valor ? 'bg-brand text-white border-brand' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {metricas && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Mini title="Total" value={metricas.total} />
          <Mini title="Aguardando" value={metricas.aguardando} />
          <Mini title="Aprovados" value={metricas.aprovados} />
          <Mini title="Enviados" value={metricas.enviados} />
          <Mini title="Responderam" value={metricas.responderam} />
          <Mini title="Taxa resp." value={`${metricas.taxa_resposta}%`} />
        </div>
      )}

      {progresso != null && (
        <div className="space-y-1">
          <NeonProgress value={progresso} tone="cyan" />
          <p className="text-xs text-slate-500">
            {progresso >= 100 ? 'Busca concluída.' : 'Buscando no Google…'}
          </p>
        </div>
      )}

      <div className="overflow-x-auto border rounded-xl bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <ThOrdenavel label="Entrou em" chave="entrou" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Nome" chave="nome" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Telefone" chave="telefone" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="E-mail" chave="email" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Endereço" chave="endereco" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Nicho / Cidade" chave="nicho" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Aval." chave="aval" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Nota" chave="nota" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Horário" chave="horario" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Site" chave="site" ordem={ordem} onOrdenar={ordenarPor} />
            <ThOrdenavel label="Pontos" chave="pontos" ordem={ordem} onOrdenar={ordenarPor} align="right" />
            <ThOrdenavel label="Status" chave="status" ordem={ordem} onOrdenar={ordenarPor} />
            <th className="text-left px-3 py-2">JSON</th>
            <th className="text-right px-3 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((p) => {
            const t = temperatura(p.score)
            const horario = !!p.json_apresentacao?.empresa?.horario_funcionamento
            return (
            <tr key={p.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{quando(p.created_at)}</td>
              <td className="px-3 py-2 font-medium">
                <span title={t.label} className="mr-1">{t.emoji}</span>
                {p.maps_url ? (
                  <a href={p.maps_url} target="_blank" rel="noreferrer"
                    className="text-brand hover:underline inline-flex items-center gap-1"
                    title="Ver ficha no Google Maps">
                    {p.nome} <span className="text-xs text-slate-400">↗</span>
                  </a>
                ) : p.nome}
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.telefone || '—'}</td>
              <td className="px-3 py-2 text-xs"><EmailEditavel value={p.email} onSave={(email) => salvarEmail(p.id, email)} /></td>
              <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate" title={p.endereco || ''}>{p.endereco || '—'}</td>
              <td className="px-3 py-2 text-slate-600 text-xs">{p.nicho} · {p.cidade}</td>
              <td className="px-3 py-2 text-right text-xs">{p.avaliacoes ?? '—'}</td>
              <td className="px-3 py-2 text-right text-xs">{p.rating != null ? Number(p.rating).toFixed(1) : '—'}</td>
              <td className="px-3 py-2 text-center">{horario ? '✅' : '❌'}</td>
              <td className="px-3 py-2">
                {p.site ? (
                  <a href={p.site} target="_blank" rel="noreferrer" className="hover:underline" title={p.site}>✅ <span className="text-xs text-brand">site</span></a>
                ) : p.tem_site ? '✅' : '❌'}
              </td>
              <td className="px-3 py-2 text-right">
                <span className={`font-semibold ${((p.score_cadastro ?? 0) <= 40) ? 'text-red-600' : (p.score_cadastro ?? 0) <= 70 ? 'text-amber-600' : 'text-emerald-600'}`}
                  title="Pontuação do cadastro (0-100): site 20 · fotos, endereço, telefone, e-mail, horário, links extras, avaliações e nota>4 valem 10 cada">
                  {p.score_cadastro ?? 0}
                </span>
                <span className="text-[10px] text-slate-400">/100</span>
              </td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
              </td>
              <td className="px-3 py-2">
                {p.json_apresentacao && (
                  <button onClick={() => setJsonAberto({ titulo: p.nome, json: p.json_apresentacao! })}
                    className="text-xs px-2 py-1 rounded-lg border text-brand hover:bg-blue-50"
                    title="Dados unificados + prompt único pro bot gerar a saudação de análise">
                    {'{ }'}
                  </button>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {(p.status === 'aguardando' || p.status === 'rejeitado') && (
                  <button disabled={agindo === p.id} onClick={() => acao(p.id, 'aprovar')} className="text-emerald-600 hover:underline disabled:opacity-40 mr-3">Aprovar</button>
                )}
                {(p.status === 'aguardando' || p.status === 'aprovado') && (
                  <button disabled={agindo === p.id} onClick={() => acao(p.id, 'rejeitar')} className="text-red-600 hover:underline disabled:opacity-40">Rejeitar</button>
                )}
              </td>
            </tr>
            )
          })}
          {ordenados.length === 0 && (
            <tr><td colSpan={14} className="px-4 py-6 text-center text-gray-400">Nenhum prospect ainda. Abra a Agenda e clique em Rodar.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {jsonAberto && (
        <JsonLeadModal titulo={`JSON de apresentação — ${jsonAberto.titulo}`} json={jsonAberto.json} onFechar={() => setJsonAberto(null)} />
      )}

      {analytics && analytics.metricas.mensagens_enviadas > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border p-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analytics da prospecção · esta empresa</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Mini title="Enviados" value={analytics.metricas.mensagens_enviadas} />
            <Mini title="Respostas" value={analytics.metricas.respostas} />
            <Mini title="Taxa resp." value={`${analytics.metricas.taxa_resposta}%`} />
            <Mini title="Diagnóstico" value={analytics.metricas.diagnostico} />
            <Mini title="Reuniões" value={analytics.metricas.reunioes} />
            <Mini title="Fechados" value={analytics.metricas.fechados} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Destaque title="Melhor nicho" rank={analytics.melhores.categoria} />
            <Destaque title="Melhor cidade" rank={analytics.melhores.cidade} />
            <Destaque title="Melhor horário" rank={analytics.melhores.horario} />
          </div>
        </div>
      )}

      {resultados && (resultados.por_mercado.length > 0 || resultados.recentes.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Desempenho por mercado</p>
            {resultados.por_mercado.length === 0 ? (
              <p className="text-sm text-gray-400">Sem dados ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500">
                  <th className="py-1">Nicho / Cidade</th><th className="py-1 text-right">Total</th><th className="py-1 text-right">Enviados</th><th className="py-1 text-right">Resp.</th>
                </tr></thead>
                <tbody>
                  {resultados.por_mercado.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{m.nicho} · {m.cidade}</td>
                      <td className="py-1.5 text-right">{m.total}</td>
                      <td className="py-1.5 text-right">{m.enviados}</td>
                      <td className="py-1.5 text-right font-semibold text-orange-600">{m.responderam}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Responderam recentemente</p>
            {resultados.recentes.length === 0 ? (
              <p className="text-sm text-gray-400">Ninguém respondeu ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {resultados.recentes.map((r, i) => (
                  <li key={i} className="flex items-center justify-between text-sm border-t pt-1.5 first:border-0 first:pt-0">
                    <span><span className="font-medium">{r.nome}</span> <span className="text-slate-500">· {r.nicho} / {r.cidade}</span></span>
                    <span className="font-mono text-xs text-slate-500">{r.telefone || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ModalAgenda
        aberto={agendaAberta}
        titulo="Agenda · Google Places"
        subtitulo="Defina nicho, cidade e a frequência. Rodar busca agora e mantém a agenda repetindo."
        onFechar={() => setAgendaAberta(false)}
        rodape={
          <>
            <button onClick={() => setAgendaAberta(false)} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>
            <button onClick={rodar} disabled={buscando}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {buscando && <Spinner />}{buscando ? 'Rodando…' : '▶ Rodar'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Campo label="Nicho"><input value={form.categoria_padrao || ''} onChange={(e) => setF('categoria_padrao', e.target.value)} placeholder="ex: dentista" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
            <Campo label="Cidade"><input value={form.cidade_padrao || ''} onChange={(e) => setF('cidade_padrao', e.target.value)} placeholder="ex: Santana" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
            <Campo label="Estado (UF)"><input value={form.estado_padrao || ''} maxLength={2} onChange={(e) => setF('estado_padrao', e.target.value.toUpperCase())} placeholder="SP" className="w-full border rounded-lg px-2 py-1.5 text-sm uppercase" /></Campo>
          </div>

          <div className="rounded-xl border bg-slate-50/60 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={!!form.agendamento_busca_ativo} onChange={(e) => setF('agendamento_busca_ativo', e.target.checked)} />
              ⏱ Buscar automaticamente (a cada X horas)
            </label>
            {form.agendamento_busca_ativo && (
              <>
                <div className="grid grid-cols-3 gap-3 pl-6">
                  <Campo label="A cada (horas)"><input type="number" min={1} max={168} value={form.busca_intervalo_horas ?? 24} onChange={(e) => setF('busca_intervalo_horas', Number(e.target.value) || 1)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
                  <Campo label="Início"><input type="time" value={form.horario_inicio || '08:00'} onChange={(e) => setF('horario_inicio', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
                  <Campo label="Fim"><input type="time" value={form.horario_fim || '18:00'} onChange={(e) => setF('horario_fim', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
                </div>
                <p className="pl-6 text-[11px] text-slate-400">Quantidade por busca segue a “Capacidade/dia” do disparo automático abaixo.</p>
              </>
            )}
            {rotina?.config.ultima_busca_em && (
              <p className="pl-6 text-[11px] text-slate-400">Última busca automática: {quando(rotina.config.ultima_busca_em)}</p>
            )}
          </div>

          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Disparo automático (envio de WhatsApp)</summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <Campo label="Capacidade/dia"><input type="number" min={1} max={200} value={form.limite_diario ?? 80} onChange={(e) => setF('limite_diario', Number(e.target.value))} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Intervalo envio (min)"><input type="number" min={5} max={1440} value={form.intervalo_envio_minutos ?? 15} onChange={(e) => setF('intervalo_envio_minutos', Number(e.target.value))} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></Campo>
              <Campo label="Modo">
                <select value={form.modo || 'manual'} onChange={(e) => setF('modo', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="manual">Manual</option>
                  <option value="semi_automatico">Semiautomático</option>
                  <option value="automatico">Automático</option>
                </select>
              </Campo>
              <Campo label="Rotina ativa">
                <label className="flex items-center gap-2 text-sm py-1.5">
                  <input type="checkbox" checked={!!form.ativo} onChange={(e) => setF('ativo', e.target.checked)} /> Ativa
                </label>
              </Campo>
              <Campo label="Gerar mensagem por IA">
                <label className="flex items-center gap-2 text-sm py-1.5">
                  <input type="checkbox" checked={!!form.gerar_mensagem_ia}
                    onChange={(e) => {
                      const v = e.target.checked
                      setForm((p) => ({ ...p, gerar_mensagem_ia: v, ...(v ? {} : { envio_real_habilitado: false }) }))
                    }} /> Gerar com IA
                </label>
              </Campo>
              <Campo label="Disparo real (envia WhatsApp)">
                <label className={`flex items-center gap-2 text-sm py-1.5 ${form.gerar_mensagem_ia ? '' : 'opacity-50'}`} title={form.gerar_mensagem_ia ? '' : 'Ligue a geração por IA primeiro'}>
                  <input type="checkbox" disabled={!form.gerar_mensagem_ia} checked={!!form.envio_real_habilitado}
                    onChange={(e) => setF('envio_real_habilitado', e.target.checked)} /> 🚀 Enviar de verdade
                </label>
              </Campo>
            </div>
          </details>
        </div>
      </ModalAgenda>
    </div>
  )
}

function Mini({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  )
}

function Destaque({ title, rank }: { title: string; rank: Rank | null }) {
  return (
    <div className="rounded-xl border bg-slate-50/60 p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</p>
      {rank ? (
        <>
          <p className="text-sm font-semibold mt-0.5 truncate" title={rank.chave}>{rank.chave}</p>
          <p className="text-xs text-slate-500 mt-0.5">{rank.respostas} resp. · {rank.taxa_resposta}% · {rank.reunioes} reun.</p>
        </>
      ) : (
        <p className="text-sm text-slate-400 mt-0.5">Sem dados</p>
      )}
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase text-slate-500 mb-0.5">{label}</label>
      {children}
    </div>
  )
}
