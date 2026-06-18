'use client'
import { useEffect, useState } from 'react'
import { apiFetch, getEmpresaId } from '@/lib/api'

type Lead = {
  numero: string
  canal: string
  negocio: string | null
  cidade: string | null
  score: number | null
  temperatura: string | null
  dor: string | null
  produto: string | null
  ofereceu_reuniao: boolean
  aguardando_resposta: boolean
  ultima_atividade: string | null
}

function fmtNumero(n: string): string {
  return String(n || '').replace('@s.whatsapp.net', '').replace(/^(\d{2})(\d{2})(\d)(\d{4})(\d{4})$/, '+$1 ($2) $3$4-$5')
}
function fmtData(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const CANAL_LABEL: Record<string, string> = { meta: 'Meta Ads', prospeccao: 'Prospecção', inbound: 'Inbound' }

export default function LeadsQuentesPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const id = getEmpresaId()
    if (!id) { setErro('Nenhuma empresa selecionada.'); setCarregando(false); return }
    apiFetch<Lead[]>(`/api/empresas/${id}/leads-quentes?limite=150`)
      .then((r) => setLeads(r.data || []))
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leads Quentes</h1>
        <p className="text-sm text-slate-500 mt-1">
          Carteira ranqueada para o operador colher de cima pra baixo: quem está mais perto da venda primeiro.
        </p>
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {carregando ? (
        <p className="text-slate-500 text-sm">Carregando…</p>
      ) : leads.length === 0 ? (
        <p className="text-slate-400 text-sm">Nenhum lead quente na carteira agora.</p>
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <div key={l.numero} className="bg-white rounded-2xl shadow-sm border p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{l.negocio || fmtNumero(l.numero)}</span>
                  {l.aguardando_resposta && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">⏳ Aguardando você</span>
                  )}
                  {l.ofereceu_reuniao && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">📅 Oferta de reunião</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-mono">{fmtNumero(l.numero)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {[CANAL_LABEL[l.canal] || l.canal, l.cidade, l.produto].filter(Boolean).join(' · ')}
                </p>
                {l.dor && <p className="text-sm text-slate-700 mt-1 truncate">💬 {l.dor}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Última atividade: {fmtData(l.ultima_atividade)}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-orange-600">{l.score ?? '—'}</div>
                <div className="text-[10px] uppercase text-slate-400 tracking-wide">score</div>
                {l.temperatura && (
                  <div className="mt-1 text-xs">{l.temperatura === 'quente' ? '🔥' : l.temperatura === 'morno' ? '🌤️' : '❄️'} {l.temperatura}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
