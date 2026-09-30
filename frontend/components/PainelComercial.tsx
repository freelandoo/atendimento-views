'use client'
// Painel comercial da Visão Geral (Fase 1). Lê TUDO de /painel-comercial; nenhuma regra aqui.
// Sem lib de gráfico: tiles + barras CSS. Ver docs/propostas/2026-09-29-*.md.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { rotuloCanal, fmt, fmtTaxa, fraseRazao, maxSerie, larguraPct } from '@/lib/painel-comercial'
import type { DiaSerie, LinhaCanal, Razoes } from '@/lib/painel-comercial'

type Payload = {
  serie: DiaSerie[]
  totais: { mensagens: number; ligacoes: number; ligacoes_atendidas: number; reunioes: number; reunioes_humano: number; reunioes_bot: number }
  razoes: Razoes
  por_canal: LinhaCanal[]
  bot_atribuivel: boolean
}
type Nicho = { id: string; nome: string }
type Membro = { usuario_id: string; nome: string; ativo?: boolean }

const CANAIS = ['google_places', 'instagram', 'meta_ads', 'linkedin']
const PERIODOS = [{ v: '7d', l: 'Últimos 7 dias' }, { v: '30d', l: 'Últimos 30 dias' }]

export default function PainelComercial() {
  const [periodo, setPeriodo] = useState('7d')
  const [nichoId, setNichoId] = useState('')
  const [canal, setCanal] = useState('')
  const [cidade, setCidade] = useState('')
  const [pessoa, setPessoa] = useState('')
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [dados, setDados] = useState<Payload | null>(null)
  const [rotuloPeriodo, setRotuloPeriodo] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  const empresaId = getEmpresaId()

  useEffect(() => {
    if (!empresaId) return
    apiFetch<Nicho[]>(`/api/empresas/${empresaId}/nichos`)
      .then((r) => setNichos((r.data || []).filter((n) => n && n.id)))
      .catch(() => setNichos([])) // filtro é opcional; sem lista, o painel roda sem nicho
    apiFetch<Membro[]>(`/api/empresas/${empresaId}/membros`)
      .then((r) => setMembros((r.data || []).filter((m) => m && m.usuario_id && m.ativo !== false)))
      .catch(() => setMembros([])) // idem: sem lista, some o seletor de pessoa
  }, [empresaId])

  useEffect(() => {
    if (!empresaId) { setErro('Nenhuma empresa selecionada.'); setCarregando(false); return }
    const qs = new URLSearchParams({ periodo })
    if (nichoId) qs.set('nicho_id', nichoId)
    if (canal) qs.set('canal', canal)
    if (cidade.trim()) qs.set('cidade', cidade.trim())
    if (pessoa) qs.set('pessoa', pessoa)
    let vivo = true
    setCarregando(true)
    const t = setTimeout(() => {
      apiFetch<Payload, { periodo?: { rotulo?: string } }>(`/api/empresas/${empresaId}/painel-comercial?${qs.toString()}`)
        .then((r) => {
          if (!vivo) return
          setDados(r.data)
          setRotuloPeriodo(r.meta?.periodo?.rotulo || '')
          setErro('')
        })
        .catch((e) => { if (vivo) setErro(e.message) })
        .finally(() => { if (vivo) setCarregando(false) })
    }, 300) // debounce: cidade é digitada
    return () => { vivo = false; clearTimeout(t) }
  }, [empresaId, periodo, nichoId, canal, cidade, pessoa])

  const maxContato = useMemo(() => maxSerie(dados?.serie, ['mensagens', 'ligacoes']), [dados])
  const maxReuniao = useMemo(() => maxSerie(dados?.serie, ['reunioes_humano', 'reunioes_bot']), [dados])

  const t = dados?.totais
  const filtroDimensao = Boolean(nichoId || canal || cidade.trim() || pessoa)

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Acompanhamento comercial</h2>
        <span className="text-xs text-slate-500">{rotuloPeriodo}</span>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
        <select value={nichoId} onChange={(e) => setNichoId(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Todos os nichos</option>
          {nichos.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
        </select>
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Todos os canais</option>
          {CANAIS.map((c) => <option key={c} value={c}>{rotuloCanal(c)}</option>)}
        </select>
        <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" className="border rounded-lg px-3 py-1.5 text-sm bg-white" />
        {membros.length > 0 && (
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Toda a equipe</option>
            {membros.map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nome}</option>)}
          </select>
        )}
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {!erro && !dados && <p className="text-slate-500 text-sm">Carregando…</p>}

      {dados && t && (
        <>
          {/* Razão de topo, sempre com denominador */}
          <div className="bg-white rounded-2xl shadow-sm border p-5">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Conversão de contatos em reuniões</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">
              {dados.razoes.por_100_contatos == null ? '—' : `${fmtTaxa(dados.razoes.por_100_contatos)} por 100`}
            </p>
            <p className="text-sm text-slate-600 mt-1">{fraseRazao(dados.razoes)}</p>
            <div className="flex gap-6 mt-3 text-xs text-slate-500">
              <span>Por ligação atendida: <b className="text-slate-700">{fmtTaxa(dados.razoes.por_ligacao)}</b>/100</span>
              <span>Por mensagem: <b className="text-slate-700">{fmtTaxa(dados.razoes.por_mensagem)}</b>/100</span>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile titulo="Mensagens enviadas" valor={fmt(t.mensagens)} />
            <Tile titulo="Ligações (atendidas)" valor={`${fmt(t.ligacoes)} (${fmt(t.ligacoes_atendidas)})`} />
            <Tile titulo="Reuniões" valor={fmt(t.reunioes)} />
            <Tile titulo="Reuniões: humano / bot" valor={`${fmt(t.reunioes_humano)} / ${fmt(t.reunioes_bot)}`} small />
          </div>

          {/* Série no tempo */}
          <div className="bg-white rounded-2xl shadow-sm border p-5">
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">Ao longo do período</h3>
            {dados.serie.length === 0 ? (
              <p className="text-slate-400 text-sm">Sem atividade no período.</p>
            ) : (
              <div className="space-y-3">
                {dados.serie.map((d) => (
                  <div key={d.dia} className="text-xs">
                    <div className="flex justify-between text-slate-500 mb-1">
                      <span>{d.dia.slice(5)}</span>
                      <span>{fmt(d.mensagens)} msg · {fmt(d.ligacoes)} lig · {fmt(d.reunioes_humano + d.reunioes_bot)} reun</span>
                    </div>
                    <Barra pct={larguraPct(d.mensagens, maxContato)} cor="bg-sky-400" />
                    <Barra pct={larguraPct(d.ligacoes, maxContato)} cor="bg-indigo-400" />
                    <Barra pct={larguraPct(d.reunioes_humano + d.reunioes_bot, maxReuniao)} cor="bg-emerald-500" />
                  </div>
                ))}
                <Legenda />
              </div>
            )}
          </div>

          {/* Por canal */}
          <div className="bg-white rounded-2xl shadow-sm border p-5">
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">Por canal de origem</h3>
            {dados.por_canal.length === 0 ? (
              <p className="text-slate-400 text-sm">Sem dados por canal.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase">
                    <th className="pb-2">Canal</th>
                    <th className="pb-2 text-right">Mensagens</th>
                    <th className="pb-2 text-right">Ligações</th>
                    <th className="pb-2 text-right">Reuniões</th>
                    <th className="pb-2 text-right">Conv./100</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.por_canal.map((c) => (
                    <tr key={c.canal} className="border-t">
                      <td className="py-1.5 text-slate-700">{rotuloCanal(c.canal)}</td>
                      <td className="py-1.5 text-right">{fmt(c.mensagens)}</td>
                      <td className="py-1.5 text-right">{fmt(c.ligacoes)}</td>
                      <td className="py-1.5 text-right">{fmt(c.reunioes)}</td>
                      <td className="py-1.5 text-right font-semibold">{fmtTaxa(c.por_100_contatos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Ressalvas honestas */}
          <div className="text-xs text-slate-400 space-y-1">
            <p>“Contato” conta mensagem <b>enviada</b> + ligação <b>atendida</b>. “Conversou” (lead respondeu) chega numa próxima fase.</p>
            {filtroDimensao && !dados.bot_atribuivel && (
              <p>Reunião pelo bot não é atribuível a nicho/cidade/canal/pessoa — fica fora quando há esse filtro.</p>
            )}
            <p>Conversão por <b>tipo de abordagem</b> (mockup, texto, imagem): aguardando captura.</p>
          </div>
        </>
      )}
      {carregando && dados && <p className="text-slate-400 text-xs">Atualizando…</p>}
    </section>
  )
}

function Tile({ titulo, valor, small }: { titulo: string; valor: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{titulo}</p>
      <p className={`${small ? 'text-xl' : 'text-3xl'} font-bold mt-1 text-slate-900`}>{valor}</p>
    </div>
  )
}

function Barra({ pct, cor }: { pct: number; cor: string }) {
  return (
    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-1">
      <div className={`h-full ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function Legenda() {
  return (
    <div className="flex gap-4 text-xs text-slate-500 pt-1">
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-sky-400 inline-block" /> Mensagens</span>
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-indigo-400 inline-block" /> Ligações</span>
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-emerald-500 inline-block" /> Reuniões</span>
    </div>
  )
}
