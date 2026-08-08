'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  rotuloMotivo,
  explicacaoMotivo,
  acaoTexto,
  podeReprocessar,
  tomPendencia,
  resumoTexto,
  type PendenciaInstancia as Pendencia,
  type ResumoPendencias,
} from '@/lib/pendencias-instancia'

// Pendências de instância — webhooks que chegaram SEM DONO COMPROVADO.
//
// Por que esta seção existe: o sistema deixou de atribuir à PJ Codeworks as mensagens de
// instância ausente, não mapeada ou com erro de resolução. Elas agora ficam em quarentena
// e NÃO viram conversa, lead, atribuição ou resposta automática. Sem esta tela, esse
// bloqueio seria invisível — um número pararia de ser atendido sem ninguém saber por quê.
//
// Fica DENTRO de Instâncias, e não como item de menu, porque a ação de resolução é
// cadastrar o número — que é o que se faz nesta mesma página, logo acima.
//
// A seção se ESCONDE quando não há nada aberto (e nada resolvido): tela de configuração
// não deve carregar um painel vazio permanente.
//
// A rota é GLOBAL (`/api/webhook-quarentena`), sem `empresaId`: a pendência é exatamente
// o caso em que não se sabe a empresa. A proteção real é do backend (admin-only).

type Estado = 'abertas' | 'todas'

export default function PendenciasInstancia() {
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [resumo, setResumo] = useState<ResumoPendencias>({ total: 0, por_motivo: {} })
  const [estado, setEstado] = useState<Estado>('abertas')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const [processando, setProcessando] = useState<number | null>(null)

  const carregar = useCallback(async (alvo: Estado) => {
    setCarregando(true)
    setErro('')
    try {
      const r = await apiFetch<{ pendencias: Pendencia[]; resumo: ResumoPendencias }>(
        `/api/webhook-quarentena?estado=${alvo}&limite=100`
      )
      setPendencias(r.data.pendencias || [])
      setResumo(r.data.resumo || { total: 0, por_motivo: {} })
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as pendências.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { void carregar(estado) }, [carregar, estado])

  async function reprocessar(p: Pendencia) {
    setProcessando(p.id)
    setErro('')
    setMsg('')
    try {
      const r = await apiFetch<{ empresa: string | null }>(`/api/webhook-quarentena/${p.id}/reprocessar`, {
        method: 'POST',
      })
      // Dito sem rodeios de propósito: o operador não pode achar que as mensagens antigas
      // voltaram. A quarentena não guarda payload — o que se recupera é o vínculo.
      setMsg(
        `Vínculo confirmado com ${r.data.empresa || 'a empresa cadastrada'}. As próximas mensagens deste número serão atendidas normalmente. As mensagens que ficaram em quarentena não são reenviadas.`
      )
      await carregar(estado)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível reprocessar.')
    } finally {
      setProcessando(null)
    }
  }

  // Nada aberto e nada no histórico: a seção some.
  if (!carregando && pendencias.length === 0 && resumo.total === 0 && estado === 'abertas') return null

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900">Pendências de instância</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{resumoTexto(resumo)}</p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border p-0.5">
          {(['abertas', 'todas'] as Estado[]).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => setEstado(op)}
              aria-pressed={estado === op}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                estado === op ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {op === 'abertas' ? 'Abertas' : 'Todas'}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {erro}
        </p>
      )}
      {msg && (
        <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {msg}
        </p>
      )}

      {carregando ? (
        <p className="mt-4 text-sm text-slate-500">Carregando…</p>
      ) : pendencias.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nenhuma pendência para exibir.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {pendencias.map((p) => {
            const tom = tomPendencia(p)
            return (
              <li key={p.id} className="rounded-lg border bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Nome da instância: configuração do operador, não dado de pessoa. */}
                      <code className="truncate rounded bg-white px-2 py-0.5 text-sm text-slate-800 ring-1 ring-slate-200">
                        {p.evolution_instance || '(sem nome de instância)'}
                      </code>
                      <Selo tom={tom}>{p.resolvida_em ? 'Resolvida' : rotuloMotivo(p.motivo)}</Selo>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{explicacaoMotivo(p.motivo)}</p>
                    {!p.resolvida_em && (
                      <p className="mt-1 text-sm font-medium text-slate-800">{acaoTexto(p.acao)}</p>
                    )}
                    {p.resolvida_em && p.resolvida_empresa && (
                      <p className="mt-1 text-sm text-emerald-700">Vinculada a {p.resolvida_empresa}.</p>
                    )}
                    <p className="mt-2 text-xs text-slate-500">
                      {p.ocorrencias} {p.ocorrencias === 1 ? 'mensagem recebida' : 'mensagens recebidas'} ·
                      {' '}primeira em {dataCurta(p.primeira_em)} · última em {dataCurta(p.ultima_em)}
                    </p>
                  </div>

                  {podeReprocessar(p) && (
                    <button
                      type="button"
                      onClick={() => reprocessar(p)}
                      disabled={processando === p.id}
                      className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {processando === p.id ? 'Verificando…' : 'Reprocessar'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Enquanto uma instância está nesta lista, nada dela é gravado: nem conversa, nem lead,
        nem atribuição de anúncio, nem resposta automática. É o que impede que a mensagem de
        um negócio apareça dentro de outro.
      </p>
    </section>
  )
}

function dataCurta(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Selo({ tom, children }: { tom: string; children: React.ReactNode }) {
  const cor =
    tom === 'ok' ? 'bg-emerald-50 text-emerald-700'
      : tom === 'atencao' ? 'bg-amber-50 text-amber-700'
        : tom === 'alerta' ? 'bg-rose-50 text-rose-700'
          : 'bg-slate-100 text-slate-600'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cor}`}>{children}</span>
}
