'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  leituraEstado, motivoFora, classesTom, textoEspera, textoRecorte, textoCandidatos,
  RESSALVA_CANDIDATOS,
} from '@/lib/banco-leads-auto-estado'
import type { EstadoAutomatico as Estado } from '@/lib/banco-leads-auto-estado'

/**
 * ESTADO REAL do modo Automático, vindo do backend (`GET .../banco-leads/auto/estado`).
 *
 * Antes desta tela, os estados do ciclo (aguardando intervalo, sem instância pronta, cooldown,
 * teto, sem lead) existiam SÓ no log do worker: para saber por que nada estava saindo, era
 * preciso abrir o log do servidor. O painel derivava um status próprio das instâncias
 * carregadas — e por isso podia discordar do ciclo real.
 *
 * Esta tela não decide nada: toda a tradução é de `lib/banco-leads-auto-estado.js`, e o veredito
 * (inclusive o motivo de cada número estar fora do rodízio) vem resolvido do servidor.
 */
export default function EstadoAutomatico({ empresaId }: { empresaId: string }) {
  const [dados, setDados] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    if (!empresaId) return
    setErro(null)
    try {
      const r = await apiFetch<Estado>(`/api/empresas/${empresaId}/banco-leads/auto/estado`)
      setDados(r.data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o estado do Automático.')
    } finally {
      setCarregando(false)
    }
  }, [empresaId])

  // Reconfere a cada 30 s e PAUSA com a aba oculta (mesmo cuidado do acompanhamento de
  // ligação): é leitura barata, mas ninguém precisa dela com a aba em segundo plano.
  useEffect(() => {
    carregar()
    const tick = () => { if (!document.hidden) carregar() }
    const timer = setInterval(tick, 30000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [carregar])

  if (carregando && !dados) {
    return <p className="text-xs text-ink-3">Lendo o estado do Automático…</p>
  }
  if (erro) {
    return (
      <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
        <p>{erro}</p>
        <button type="button" onClick={carregar} className="mt-1 font-semibold text-brand underline">
          Tentar de novo
        </button>
      </div>
    )
  }
  if (!dados) return null

  const leitura = leituraEstado(dados.estado)
  const espera = textoEspera(dados.segundos_para_proximo)

  return (
    <section className="space-y-2" aria-label="Estado do disparo automático">
      <div className={`rounded-md border px-3 py-2 ${classesTom(leitura.tom)}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong className="text-sm">{leitura.titulo}</strong>
          {espera && <span className="text-xs">Próximo ciclo {espera}</span>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{leitura.detalhe}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div>
          <dt className="text-ink-3">Recorte</dt>
          <dd className="font-medium text-ink" title={RESSALVA_CANDIDATOS}>{textoRecorte(dados.recorte)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Fila</dt>
          <dd className="font-medium text-ink">{textoCandidatos(dados.leads_candidatos)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Enviados hoje</dt>
          <dd className="font-medium text-ink">
            {dados.total_disparos_hoje}
            {dados.teto_diario > 0 ? ` de ${dados.teto_diario}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">No rodízio</dt>
          <dd className="font-medium text-ink">
            {dados.instancias_no_rodizio} de {dados.instancias.length} número{dados.instancias.length === 1 ? '' : 's'}
          </dd>
        </div>
      </dl>
      <p className="text-[11px] leading-relaxed text-ink-3">{RESSALVA_CANDIDATOS}</p>

      <ul className="divide-y divide-line rounded-md border border-line">
        {dados.instancias.map((i) => {
          const motivo = i.no_rodizio ? null : motivoFora(i.motivo_fora)
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                <span className="font-medium text-ink">{i.nome}</span>
                {i.principal && (
                  <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
                    principal
                  </span>
                )}
              </span>
              <span className="text-ink-3">
                {i.disparos_hoje} envio{i.disparos_hoje === 1 ? '' : 's'} hoje
                {i.teto_instancia ? ` · teto ${i.teto_instancia}` : ''}
              </span>
              {/* Estado SEMPRE em texto — e o motivo de estar fora é dito, não só a ausência. */}
              <span className={i.no_rodizio ? 'font-semibold text-estado-ok' : 'text-ink-2'}>
                {i.no_rodizio ? 'No rodízio' : motivo}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
