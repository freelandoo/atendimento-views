'use client'
// Aquisição no TRIAL: a "busca" roda sobre a NOSSA base já coletada (pool), custo zero. A pessoa
// escolhe um mercado (nicho+cidade que já temos), vê leads reais e puxa até o teto do dia. Deixa
// claro que, pagando, a busca é de verdade em qualquer nicho/lugar (Google, Instagram, Meta).
// Consome /api/empresas/:id/pool-trial. Tema claro, tokens.
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'
import Link from 'next/link'
import Botao from '@/components/ui/Botao'

type Mercado = { nicho: string; cidade: string; uf: string | null; leads: number }
type Lead = {
  id: string; nome: string; telefone: string | null; nicho: string; cidade: string; uf: string | null
  endereco: string | null; rating: number | null; avaliacoes: number | null; tem_site: boolean; site: string | null
}

export default function PoolTrialPainel() {
  const [mercados, setMercados] = useState<Mercado[]>([])
  const [sel, setSel] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [restantes, setRestantes] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [puxando, setPuxando] = useState('')
  const [puxados, setPuxados] = useState<Set<string>>(new Set())

  useEffect(() => {
    let vivo = true
    apiFetch<Mercado[]>(`/api/empresas/${getEmpresaId()}/pool-trial/mercados`)
      .then((r) => { if (vivo) setMercados(r.data || []) })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Falha ao carregar os mercados.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  const buscar = useCallback(async (valor: string) => {
    setSel(valor)
    setLeads([])
    if (!valor) return
    const m = mercados[Number(valor)]
    if (!m) return
    setErro('')
    try {
      const q = new URLSearchParams({ nicho: m.nicho, cidade: m.cidade, ...(m.uf ? { uf: m.uf } : {}) })
      const r = await apiFetch<Lead[]>(`/api/empresas/${getEmpresaId()}/pool-trial/leads?${q}`)
      setLeads(r.data || [])
      const rh = (r.meta as { restantes_hoje?: number } | undefined)?.restantes_hoje
      if (typeof rh === 'number') setRestantes(rh)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao buscar na base.')
    }
  }, [mercados])

  async function puxar(id: string) {
    setPuxando(id)
    setErro('')
    try {
      const r = await apiFetch<{ resultado: string }>(`/api/empresas/${getEmpresaId()}/pool-trial/puxar`, {
        method: 'POST', body: JSON.stringify({ prospect_id: id }),
      })
      setPuxados((s) => new Set(s).add(id))
      const rh = (r.meta as { restantes_hoje?: number } | undefined)?.restantes_hoje
      if (typeof rh === 'number') setRestantes(rh)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível puxar este lead.')
    } finally {
      setPuxando('')
    }
  }

  return (
    <div className="space-y-4">
      {/* Explicação do trial + upgrade */}
      <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
        <p className="text-sm font-semibold text-ink">Você está no teste — buscando na nossa base de leads</p>
        <p className="mt-1 text-sm text-ink-2">
          No teste, você escolhe um mercado que já temos e trabalha leads reais na hora.
          Ao assinar, a busca passa a ser de verdade em <strong>qualquer nicho e lugar</strong> —
          Google, Instagram e Anúncios da Meta.
        </p>
        <Link href="/dashboard/plano" className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">
          Ver planos →
        </Link>
      </div>

      {erro && <p className="rounded-lg border border-estado-danger/30 bg-estado-danger/5 px-3 py-2 text-sm text-estado-danger">{erro}</p>}

      <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
        <label className="text-xs font-medium text-ink-3">Mercado disponível</label>
        <select
          value={sel}
          onChange={(e) => void buscar(e.target.value)}
          disabled={carregando}
          className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand"
        >
          <option value="">{carregando ? 'Carregando…' : 'Escolha um nicho e cidade'}</option>
          {mercados.map((m, i) => (
            <option key={`${m.nicho}-${m.cidade}-${m.uf}`} value={String(i)}>
              {m.nicho} — {m.cidade}{m.uf ? `/${m.uf}` : ''} ({m.leads})
            </option>
          ))}
        </select>
        {restantes != null && (
          <p className="mt-2 text-xs text-ink-3">Você ainda pode puxar <strong>{restantes}</strong> leads hoje.</p>
        )}
      </div>

      {sel && (
        <div className="rounded-lg border border-line bg-surface shadow-card">
          {leads.length === 0 ? (
            <p className="p-5 text-sm text-ink-3">Nenhum lead disponível neste mercado agora.</p>
          ) : (
            <ul className="divide-y divide-line">
              {leads.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{l.nome}</p>
                    <p className="truncate text-xs text-ink-3">
                      {l.cidade}{l.uf ? `/${l.uf}` : ''}
                      {l.rating != null ? ` · ${l.rating}★` : ''}
                      {l.tem_site ? ' · tem site' : ' · sem site'}
                    </p>
                  </div>
                  <Botao
                    variante="secundaria" tamanho="sm"
                    carregando={puxando === l.id}
                    disabled={puxados.has(l.id) || (restantes != null && restantes <= 0)}
                    motivoDesabilitado={puxados.has(l.id) ? 'Já no seu banco' : (restantes != null && restantes <= 0 ? 'Limite do dia atingido' : '')}
                    onClick={() => void puxar(l.id)}
                  >
                    {puxados.has(l.id) ? 'No seu banco' : 'Puxar'}
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
