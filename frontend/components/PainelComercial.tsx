'use client'
// Painel comercial da Visão Geral (Fase 1). Lê TUDO de /painel-comercial; nenhuma regra aqui.
// Sem lib de gráfico: tiles + barras CSS. Ver docs/propostas/2026-09-29-*.md.
import { useEffect, useMemo, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import Abas from '@/components/ui/Abas'
import { rotuloCanal, idadeEquipe, funilComQueda, janelaPreset, janelaAnterior, formatarDelta, fmt, fmtTaxa, fraseRazao, maxSerie, larguraPct } from '@/lib/painel-comercial'
import type { DiaSerie, LinhaCanal, Razoes, DeltaInfo } from '@/lib/painel-comercial'

const dataBr = (ymd: string) => ymd.split('-').reverse().join('/') // 2026-09-23 → 23/09/2026

type Totais = { mensagens: number; ligacoes: number; ligacoes_atendidas: number; conversou: number; reunioes: number; reunioes_humano: number; reunioes_bot: number }
type Payload = {
  serie: DiaSerie[]
  totais: Totais
  razoes: Razoes
  por_canal: LinhaCanal[]
  funil: { estagio: string; n: number }[]
  bot_atribuivel: boolean
}
type Nicho = { id: string; nome: string }
const PAISES = [{ v: 'BR', l: 'Brasil' }, { v: 'PT', l: 'Portugal' }, { v: 'US', l: 'EUA' }, { v: '', l: 'Todos os países' }]
type Membro = { usuario_id: string; nome: string; ativo?: boolean }
type Equipe = { id: string; nome: string; nicho_id: string; nicho_nome?: string; criado_em?: string; status?: string }

const CANAIS = ['google_places', 'instagram', 'meta_ads', 'linkedin']
const PERIODOS = [{ v: '7d', l: 'Últimos 7 dias' }, { v: '30d', l: 'Últimos 30 dias' }]
const ABAS = [
  { id: 'geral', titulo: 'Visão geral' },
  { id: 'equipe', titulo: 'Por equipe' },
  { id: 'pessoa', titulo: 'Por pessoa' },
]

export default function PainelComercial() {
  const [aba, setAba] = useState('geral')
  const [preset, setPreset] = useState('7d') // '7d' | '30d' | 'custom'
  const [deCustom, setDeCustom] = useState(() => janelaPreset('7d').de)
  const [ateCustom, setAteCustom] = useState(() => janelaPreset('7d').ate)
  const [comparar, setComparar] = useState(false)
  const [totaisAnt, setTotaisAnt] = useState<Totais | null>(null)
  const [nichoId, setNichoId] = useState('')
  const [equipeId, setEquipeId] = useState('')
  const [canal, setCanal] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [pais, setPais] = useState('BR') // padrão Brasil (decisão do operador)
  const [pessoa, setPessoa] = useState('')
  const [nichos, setNichos] = useState<Nicho[]>([])
  const [equipes, setEquipes] = useState<Equipe[]>([])
  const [membros, setMembros] = useState<Membro[]>([])
  const [cidades, setCidades] = useState<string[]>([])
  const [estados, setEstados] = useState<string[]>([])
  const [dados, setDados] = useState<Payload | null>(null)
  const [rotuloPeriodo, setRotuloPeriodo] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  const empresaId = getEmpresaId()

  // Aba persiste por sessão — trocar de aba é só apresentação (não dispara nada além do refetch).
  useEffect(() => { try { const s = sessionStorage.getItem('painelComercialAba'); if (s) setAba(s) } catch {} }, [])
  useEffect(() => { try { sessionStorage.setItem('painelComercialAba', aba) } catch {} }, [aba])

  useEffect(() => {
    if (!empresaId) return
    apiFetch<Nicho[]>(`/api/empresas/${empresaId}/nichos`)
      .then((r) => setNichos((r.data || []).filter((n) => n && n.id)))
      .catch(() => setNichos([])) // filtro é opcional; sem lista, o painel roda sem nicho
    apiFetch<Membro[]>(`/api/empresas/${empresaId}/membros`)
      .then((r) => setMembros((r.data || []).filter((m) => m && m.usuario_id && m.ativo !== false)))
      .catch(() => setMembros([])) // idem: sem lista, some o seletor de pessoa
    apiFetch<Equipe[]>(`/api/empresas/${empresaId}/equipes-comerciais`)
      .then((r) => setEquipes((r.data || []).filter((e) => e && e.id && e.nicho_id)))
      .catch(() => setEquipes([]))
    apiFetch<{ cidades: string[]; estados: string[] }>(`/api/empresas/${empresaId}/painel-comercial/locais`)
      .then((r) => { setCidades(r.data?.cidades || []); setEstados(r.data?.estados || []) })
      .catch(() => { setCidades([]); setEstados([]) }) // sem lista → seletores caem em "Todas/os"
  }, [empresaId])

  // Cada aba controla UMA dimensão; as demais não vazam para a consulta.
  const equipeSel = equipes.find((e) => e.id === equipeId)
  const nichoEfetivo = aba === 'geral' ? nichoId : aba === 'equipe' ? (equipeSel?.nicho_id || '') : ''
  const pessoaEfetiva = aba === 'pessoa' ? pessoa : ''
  // Janela sempre em datas (uniformiza preset e custom, e deixa a comparação exata).
  const janela = preset === 'custom' ? { de: deCustom, ate: ateCustom } : janelaPreset(preset)

  useEffect(() => {
    if (!empresaId) { setErro('Nenhuma empresa selecionada.'); setCarregando(false); return }
    const dims = new URLSearchParams()
    if (nichoEfetivo) dims.set('nicho_id', nichoEfetivo)
    if (canal) dims.set('canal', canal)
    if (cidade.trim()) dims.set('cidade', cidade.trim())
    if (estado) dims.set('estado', estado)
    if (pais) dims.set('pais', pais)
    if (pessoaEfetiva) dims.set('pessoa', pessoaEfetiva)
    const url = (de: string, ate: string) => {
      const qs = new URLSearchParams(dims)
      qs.set('de', de); qs.set('ate', ate)
      return `/api/empresas/${empresaId}/painel-comercial?${qs.toString()}`
    }
    let vivo = true
    setCarregando(true)
    const t = setTimeout(() => {
      const principal = apiFetch<Payload, { periodo?: { rotulo?: string } }>(url(janela.de, janela.ate))
      const ant = janelaAnterior(janela.de, janela.ate)
      const anterior = comparar ? apiFetch<Payload>(url(ant.de, ant.ate)) : Promise.resolve(null)
      Promise.all([principal, anterior])
        .then(([r, rAnt]) => {
          if (!vivo) return
          setDados(r.data)
          setRotuloPeriodo(r.meta?.periodo?.rotulo || '')
          setTotaisAnt(rAnt ? rAnt.data.totais : null)
          setErro('')
        })
        .catch((e) => { if (vivo) setErro(e.message) })
        .finally(() => { if (vivo) setCarregando(false) })
    }, 300) // debounce: cidade/datas digitadas
    return () => { vivo = false; clearTimeout(t) }
  }, [empresaId, preset, deCustom, ateCustom, comparar, canal, cidade, estado, pais, nichoEfetivo, pessoaEfetiva])

  const maxContato = useMemo(() => maxSerie(dados?.serie, ['mensagens', 'ligacoes']), [dados])
  const maxReuniao = useMemo(() => maxSerie(dados?.serie, ['reunioes_humano', 'reunioes_bot']), [dados])

  const t = dados?.totais
  const filtroDimensao = Boolean(nichoEfetivo || canal || cidade.trim() || estado || pais || pessoaEfetiva)
  const dInfo = (chave: keyof Totais): DeltaInfo | undefined =>
    comparar && totaisAnt && t ? formatarDelta(t[chave], totaisAnt[chave]) : undefined
  const janelaAnt = comparar ? janelaAnterior(janela.de, janela.ate) : null

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-900">Acompanhamento comercial</h2>
        <span className="text-xs text-slate-500">{rotuloPeriodo}</span>
      </div>

      <Abas abas={ABAS} ativa={aba} onMudar={setAba} idBase="painel-comercial" ariaLabel="Recorte do painel comercial" />

      <div role="tabpanel" id={`painel-comercial-painel-${aba}`} aria-labelledby={`painel-comercial-aba-${aba}`} className="space-y-5">
      {/* Filtros: período + dimensões comuns + o da aba ativa */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={preset} onChange={(e) => setPreset(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          <option value="custom">Período personalizado…</option>
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" value={deCustom} max={ateCustom} onChange={(e) => setDeCustom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm bg-white" />
            <span className="text-xs text-slate-400">até</span>
            <input type="date" value={ateCustom} min={deCustom} onChange={(e) => setAteCustom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm bg-white" />
          </>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
          Comparar com período anterior
        </label>
        <select value={pais} onChange={(e) => setPais(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          {PAISES.map((p) => <option key={p.v || 'todos'} value={p.v}>{p.l}</option>)}
        </select>
        {estados.length > 0 && (
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Todos os estados</option>
            {estados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        )}
        <select value={canal} onChange={(e) => setCanal(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Todos os canais</option>
          {CANAIS.map((c) => <option key={c} value={c}>{rotuloCanal(c)}</option>)}
        </select>
        <select value={cidade} onChange={(e) => setCidade(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Todas as cidades</option>
          {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {aba === 'geral' && (
          <select value={nichoId} onChange={(e) => setNichoId(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Todos os nichos</option>
            {nichos.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
          </select>
        )}
        {aba === 'equipe' && (
          <select value={equipeId} onChange={(e) => setEquipeId(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Selecione uma equipe</option>
            {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.status && e.status !== 'ativa' ? ' (encerrada)' : ''}</option>)}
          </select>
        )}
        {aba === 'pessoa' && (
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">Selecione uma pessoa</option>
            {membros.map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nome}</option>)}
          </select>
        )}
      </div>

      {/* Períodos comparados — deixa explícito quais duas janelas estão lado a lado */}
      {comparar && janelaAnt && (
        <p className="text-xs text-slate-500 bg-slate-50 border rounded-lg px-3 py-2">
          Comparando <b className="text-slate-700">{dataBr(janela.de)} – {dataBr(janela.ate)}</b>
          {' '}com <b className="text-slate-700">{dataBr(janelaAnt.de)} – {dataBr(janelaAnt.ate)}</b>.
          Os Δ abaixo são deste período <b>vs.</b> o anterior, em quantidade e %.
        </p>
      )}

      {/* Contexto da aba */}
      {aba === 'equipe' && equipeSel && (
        <p className="text-xs text-slate-500">
          Equipe <b className="text-slate-700">{equipeSel.nome}</b>
          {equipeSel.nicho_nome ? <> · nicho {equipeSel.nicho_nome}</> : null}
          {equipeSel.criado_em ? <> · existe {idadeEquipe(equipeSel.criado_em)} (desde {new Date(equipeSel.criado_em).toLocaleDateString('pt-BR')})</> : null}
          {' '}· mostra os resultados do nicho desta equipe.
        </p>
      )}
      {aba === 'equipe' && !equipeSel && <p className="text-xs text-slate-400">Selecione uma equipe para ver o desempenho dela.</p>}
      {aba === 'pessoa' && !pessoa && <p className="text-xs text-slate-400">Selecione uma pessoa para ver o desempenho dela ao longo do tempo.</p>}

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
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs text-slate-500">
              <span>Por ligação atendida: <b className="text-slate-700">{fmtTaxa(dados.razoes.por_ligacao)}</b>/100</span>
              <span>Por mensagem: <b className="text-slate-700">{fmtTaxa(dados.razoes.por_mensagem)}</b>/100</span>
              <span>Responderam: <b className="text-slate-700">{fmtTaxa(dados.razoes.taxa_resposta)}</b>% das mensagens</span>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Tile titulo="Mensagens enviadas" valor={fmt(t.mensagens)} delta={dInfo('mensagens')} />
            <Tile titulo="Responderam" valor={fmt(t.conversou)} delta={dInfo('conversou')} />
            <Tile titulo="Ligações (atendidas)" valor={`${fmt(t.ligacoes)} (${fmt(t.ligacoes_atendidas)})`} delta={dInfo('ligacoes')} />
            <Tile titulo="Reuniões" valor={fmt(t.reunioes)} delta={dInfo('reunioes')} />
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
                      <span>{fmt(d.mensagens)} msg · {fmt(d.conversou)} resp · {fmt(d.ligacoes)} lig · {fmt(d.reunioes_humano + d.reunioes_bot)} reun</span>
                    </div>
                    <Barra pct={larguraPct(d.mensagens, maxContato)} cor="bg-sky-400" />
                    <Barra pct={larguraPct(d.conversou, maxContato)} cor="bg-amber-400" />
                    <Barra pct={larguraPct(d.ligacoes, maxContato)} cor="bg-indigo-400" />
                    <Barra pct={larguraPct(d.reunioes_humano + d.reunioes_bot, maxReuniao)} cor="bg-emerald-500" />
                  </div>
                ))}
                <Legenda />
              </div>
            )}
          </div>

          {/* Funil: onde os leads estão parados + queda entre etapas */}
          <div className="bg-white rounded-2xl shadow-sm border p-5">
            <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Onde os leads estão parados</h3>
            <p className="text-xs text-slate-400 mb-3">
              Atendimentos ativos, por estágio (não depende do período). A barra mostra quantos <b>chegaram</b>
              {' '}a cada etapa (ou além); a queda é quem <b>não avançou</b> dali.
            </p>
            {(() => {
              const { etapas, outros } = funilComQueda(dados.funil)
              if ((etapas[0]?.acumulado || 0) === 0 && outros === 0) {
                return <p className="text-slate-400 text-sm">Nenhum atendimento ativo neste recorte.</p>
              }
              return (
                <div className="space-y-1">
                  {etapas.map((et) => (
                    <div key={et.estagio}>
                      {et.quedaPct !== null && et.quedaPct > 0 && (
                        <p className="text-[11px] text-rose-500 pl-1 mb-1">↓ {et.quedaPct}% não avançaram</p>
                      )}
                      <div className="text-xs">
                        <div className="flex justify-between text-slate-600 mb-1">
                          <span>{et.rotulo}</span>
                          <span><b className="text-slate-800">{fmt(et.acumulado)}</b> chegaram{et.n ? ` · ${fmt(et.n)} parados aqui` : ''}</span>
                        </div>
                        <Barra pct={et.larguraPct} cor="bg-violet-400" />
                      </div>
                    </div>
                  ))}
                  {outros > 0 && <p className="text-[11px] text-slate-400 pt-1">+ {fmt(outros)} em outros estágios (fora do funil padrão)</p>}
                </div>
              )
            })()}
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
                    <th className="pb-2 text-right">Resp.</th>
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
                      <td className="py-1.5 text-right">{fmt(c.conversou)}</td>
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
            <p>“Contato” conta mensagem <b>enviada</b> + ligação <b>atendida</b>. “Responderam” = leads que responderam no WhatsApp, contado <b>a partir de agora</b> (conversas anteriores não entram).</p>
            {filtroDimensao && !dados.bot_atribuivel && (
              <p>Reunião pelo bot não tem nicho/cidade/canal/país/pessoa — fica fora com esses filtros (inclusive o país padrão). Escolha “Todos os países” para incluí-la.</p>
            )}
            <p>Conversão por <b>tipo de abordagem</b> (mockup, texto, imagem): aguardando captura.</p>
          </div>
        </>
      )}
      {carregando && dados && <p className="text-slate-400 text-xs">Atualizando…</p>}
      </div>
    </section>
  )
}

function Tile({ titulo, valor, small, delta }: { titulo: string; valor: string; small?: boolean; delta?: DeltaInfo }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{titulo}</p>
      <p className={`${small ? 'text-xl' : 'text-3xl'} font-bold mt-1 text-slate-900`}>{valor}</p>
      {delta && (
        // Seta + número (quantidade E %) são o sinal; cor só reforça. Δ vs. período anterior.
        <p className={`text-xs mt-1 ${delta.abs > 0 ? 'text-emerald-600' : delta.abs < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
          {delta.seta} {fmt(Math.abs(delta.abs))}
          {delta.novo ? ' (novo)' : delta.pct !== null ? ` (${delta.pct > 0 ? '+' : ''}${delta.pct}%)` : ''}
          {' '}vs. anterior
        </p>
      )}
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
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-amber-400 inline-block" /> Respostas</span>
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-indigo-400 inline-block" /> Ligações</span>
      <span className="flex items-center gap-1"><i className="w-3 h-1.5 rounded-full bg-emerald-500 inline-block" /> Reuniões</span>
    </div>
  )
}
