'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useFeedback, Spinner } from '@/components/feedback/FeedbackProvider'
import RotinaCampos, { type Rascunho, type Limites } from '@/components/RotinaCampos'
import { sugestaoParaRascunho, rascunhoParaAjustes, rotuloConfianca } from '@/lib/aquisicao-sugestao'
import type { Rotina } from '@/components/RotinasAquisicao'

// Assistente de Oportunidades: lê os resultados das rotinas e sugere o próximo passo.
// Ele NUNCA cria, altera, ativa, pausa ou coleta sozinho — cada sugestão só vira ação
// quando o administrador aprova aqui. A tela fala a língua do operador: nada de modelo,
// prompt, snapshot ou fornecedor de dados.

type Sugestao = {
  id: string
  tipo: 'criar_rotina' | 'ajustar_rotina' | 'pausar_rotina' | 'revisar_rotina'
  acao_label: string
  rotina_id: string | null
  nicho: string | null
  cidade: string | null
  uf: string | null
  parametros: Record<string, unknown>
  titulo: string
  motivo: string
  impacto: string | null
  evidencias: { rotulo: string; valor: string }[]
  confianca: number
  status: 'pendente' | 'aprovada' | 'dispensada'
  decidido_em: string | null
  criado_em: string
}
type OportunidadesResp = {
  sugestoes: Sugestao[]
  decididas: Sugestao[]
  ultima_analise_em: string | null
  proxima_analise_em: string | null
  estado?: string
  mensagem?: string | null
  novas?: number
}

const ACAO_STYLE: Record<string, string> = {
  criar_rotina: 'bg-emerald-100 text-emerald-700',
  ajustar_rotina: 'bg-indigo-100 text-indigo-700',
  pausar_rotina: 'bg-amber-100 text-amber-800',
  revisar_rotina: 'bg-amber-100 text-amber-800',
}
// Rótulo do botão que confirma cada tipo. Criar/ajustar abrem revisão antes de gravar;
// pausar e revisar são ações diretas (nenhuma delas inicia coleta).
const CONFIRMAR_LABEL: Record<string, string> = {
  criar_rotina: 'Aprovar',
  ajustar_rotina: 'Aprovar',
  pausar_rotina: 'Pausar rotina',
  revisar_rotina: 'Marcar como revisada',
}
const ABRE_REVISAO = new Set(['criar_rotina', 'ajustar_rotina'])

function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function contagem(ate: string | null, agora: number): string {
  if (!ate) return ''
  const restante = new Date(ate).getTime() - agora
  if (!Number.isFinite(restante) || restante <= 0) return ''
  const min = Math.floor(restante / 60000)
  const seg = Math.floor((restante % 60000) / 1000)
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`
}

export default function AssistenteOportunidades({
  empresaId,
  rotinas = [],
  limites,
  onRotinasAlteradas,
}: {
  empresaId: string
  rotinas?: Rotina[]
  limites?: Limites
  onRotinasAlteradas?: () => void
}) {
  const [dados, setDados] = useState<OportunidadesResp | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const [revisao, setRevisao] = useState<{ sugestao: Sugestao; rascunho: Rascunho } | null>(null)
  const [agindo, setAgindo] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  const [agora, setAgora] = useState(() => Date.now())
  const fb = useFeedback()

  const base = `/api/empresas/${empresaId}/prospeccao/oportunidades`

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<OportunidadesResp>(base)
      setDados(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as sugestões.')
    }
  }, [empresaId, base])

  useEffect(() => { carregar() }, [carregar])
  // Relógio do cronômetro de "nova análise disponível em…".
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const sugestoes = dados?.sugestoes || []
  const espera = contagem(dados?.proxima_analise_em || null, agora)

  async function analisar() {
    setErro('')
    setMensagem(null)
    setAnalisando(true)
    try {
      const r = await apiFetch<OportunidadesResp>(`${base}/analisar`, { method: 'POST' })
      setDados(r.data)
      setMensagem(r.data.mensagem || null)
      if (r.data.novas) fb.toast(`${r.data.novas} sugestão(ões) para você revisar.`, 'success')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao analisar as oportunidades.')
    } finally {
      setAnalisando(false)
    }
  }

  function abrir(s: Sugestao) {
    setErro('')
    const rotina = rotinas.find((r) => r.id === s.rotina_id) || null
    setRevisao({ sugestao: s, rascunho: sugestaoParaRascunho(s, rotina) as Rascunho })
  }

  async function aprovar(s: Sugestao, ajustes?: Record<string, unknown>) {
    setAgindo(s.id)
    setErro('')
    try {
      const r = await apiFetch<OportunidadesResp & { rotina_ativa?: boolean }>(`${base}/${s.id}/aprovar`, {
        method: 'POST',
        body: JSON.stringify(ajustes ? { ajustes } : {}),
      })
      setDados(r.data)
      setRevisao(null)
      onRotinasAlteradas?.()
      fb.toast(
        s.tipo === 'criar_rotina'
          ? 'Rotina criada e PAUSADA. Revise na lista de rotinas e ative quando quiser.'
          : s.tipo === 'pausar_rotina' ? 'Rotina pausada.' : 'Sugestão aplicada.',
        'success'
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aprovar a sugestão.')
    } finally { setAgindo(null) }
  }

  async function dispensar(s: Sugestao) {
    setAgindo(s.id)
    setErro('')
    try {
      const r = await apiFetch<OportunidadesResp>(`${base}/${s.id}/dispensar`, { method: 'POST' })
      setDados(r.data)
      if (revisao?.sugestao.id === s.id) setRevisao(null)
      fb.toast('Sugestão dispensada. Ela só volta se os números mudarem.', 'info')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao dispensar a sugestão.')
    } finally { setAgindo(null) }
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Assistente de Oportunidades</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Ele olha o resultado das suas rotinas e dos seus mercados e sugere o próximo passo —
            criar, ajustar ou pausar. Nada acontece sem você aprovar: nenhuma sugestão inicia uma
            busca por conta própria.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <button onClick={analisar} disabled={analisando || !!espera}
            title={espera ? 'Uma análise foi feita há pouco.' : undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {analisando && <Spinner />}{analisando ? 'Analisando…' : 'Analisar oportunidades'}
          </button>
          <p className="mt-1 text-[11px] text-slate-400">
            {espera ? `Nova análise em ${espera}` : dados?.ultima_analise_em ? `Última análise: ${quando(dados.ultima_analise_em)}` : 'Nenhuma análise ainda'}
          </p>
        </div>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      {analisando && (
        <div className="flex items-center gap-3 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
          <Spinner />
          <span>Analisando seus resultados. Isso não inicia nenhuma busca.</span>
        </div>
      )}

      {!analisando && mensagem && sugestoes.length === 0 && (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <p className="text-sm text-slate-500">{mensagem}</p>
        </div>
      )}

      {!analisando && !mensagem && sugestoes.length === 0 && (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <p className="text-sm text-slate-500">Nenhuma sugestão no momento.</p>
          <p className="mt-1 text-xs text-slate-400">
            Clique em <b>Analisar oportunidades</b> para o assistente olhar seus resultados.
          </p>
        </div>
      )}

      {sugestoes.length > 0 && (
        <div className="space-y-3">
          {sugestoes.map((s) => {
            const emRevisao = revisao?.sugestao.id === s.id
            return (
              <div key={s.id} className="rounded-xl border p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACAO_STYLE[s.tipo] || 'bg-slate-100 text-slate-600'}`}>
                        {s.acao_label}
                      </span>
                      <span className="font-semibold">{s.titulo}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700">{s.motivo}</p>
                    {s.impacto && <p className="mt-1 text-xs text-slate-500">{s.impacto}</p>}
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400" title={`Confiança ${s.confianca}/100`}>
                    {rotuloConfianca(s.confianca)}
                  </span>
                </div>

                {s.evidencias.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                    {s.evidencias.map((e) => (
                      <span key={e.rotulo} className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                        {e.rotulo}: <b className="text-slate-800">{e.valor}</b>
                      </span>
                    ))}
                  </div>
                )}

                {emRevisao ? (
                  <div className="mt-3 space-y-4 rounded-xl border border-brand/40 bg-brand/5 p-4">
                    <div>
                      <p className="text-sm font-semibold">Revisar antes de aprovar</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {s.tipo === 'criar_rotina'
                          ? 'Ajuste o que quiser. A rotina será criada PAUSADA — nenhuma busca começa agora.'
                          : 'Ajuste o que quiser antes de aplicar na rotina existente.'}
                      </p>
                    </div>
                    <RotinaCampos
                      rascunho={revisao.rascunho}
                      onChange={(r) => setRevisao({ sugestao: s, rascunho: r })}
                      limites={limites}
                      mostrarAtivo={false}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => aprovar(s, rascunhoParaAjustes(revisao.rascunho))} disabled={agindo === s.id}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                        {agindo === s.id && <Spinner />}
                        {s.tipo === 'criar_rotina' ? 'Criar rotina pausada' : 'Aplicar ajuste'}
                      </button>
                      <button onClick={() => setRevisao(null)} disabled={agindo === s.id}
                        className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
                    <button
                      onClick={() => (ABRE_REVISAO.has(s.tipo) ? abrir(s) : aprovar(s))}
                      disabled={agindo === s.id}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                      {agindo === s.id && <Spinner />}{CONFIRMAR_LABEL[s.tipo] || 'Aprovar'}
                    </button>
                    {ABRE_REVISAO.has(s.tipo) && (
                      <button onClick={() => abrir(s)} disabled={agindo === s.id}
                        className="text-brand hover:underline disabled:opacity-40">
                        Editar antes
                      </button>
                    )}
                    <button onClick={() => dispensar(s)} disabled={agindo === s.id}
                      className="text-slate-500 hover:underline disabled:opacity-40">
                      Dispensar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(dados?.decididas.length || 0) > 0 && (
        <div className="border-t pt-3">
          <button onClick={() => setVerHistorico((v) => !v)} className="text-xs text-slate-500 hover:underline">
            {verHistorico ? 'Ocultar' : 'Ver'} decisões anteriores ({dados!.decididas.length})
          </button>
          {verHistorico && (
            <ul className="mt-2 space-y-1.5">
              {dados!.decididas.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs first:border-0">
                  <span className="text-slate-600">{s.titulo}</span>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 ${s.status === 'aprovada' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.status === 'aprovada' ? 'Aprovada' : 'Dispensada'}
                    </span>
                    <span className="text-slate-400">{quando(s.decidido_em)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
