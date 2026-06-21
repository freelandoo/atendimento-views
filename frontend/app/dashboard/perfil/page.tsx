'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, getEmpresaId } from '@/lib/api'
import { useSession } from '@/lib/useSession'
import { useFeedback } from '@/components/feedback/FeedbackProvider'

type Resumo = { total: number; hoje: number; semana: number; enviados: number; falhou: number }
type PorDia = { dia: string; total: number }
type Disparo = { id: string; status: string; evolution_instance: string; criado_em: string; prospect_nome: string | null }
type MeusDisparos = { resumo: Resumo; por_dia: PorDia[]; recentes: Disparo[] }

const ROLE_LABEL: Record<string, string> = { user: 'Usuário', admin: 'Admin', superadmin: 'Super Admin' }
const STATUS_STYLE: Record<string, string> = {
  enviado: 'bg-emerald-100 text-emerald-700',
  enviando: 'bg-amber-100 text-amber-700',
  falhou: 'bg-red-100 text-red-700',
}

function fmtDataHora(s: string): string {
  try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return s }
}
function fmtDia(s: string): string {
  try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) } catch { return s }
}

export default function PerfilPage() {
  const router = useRouter()
  const fb = useFeedback()
  const { usuario, loading } = useSession()
  const empresaId = typeof window !== 'undefined' ? getEmpresaId() : ''
  const [dados, setDados] = useState<MeusDisparos | null>(null)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    if (!empresaId) return
    try {
      const r = await apiFetch<MeusDisparos>(`/api/empresas/${empresaId}/banco-leads/meus-disparos`)
      setDados(r.data)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao carregar histórico.') }
  }, [empresaId])

  useEffect(() => { carregar() }, [carregar])

  function logout() {
    if (!confirm('Sair da conta?')) return
    try {
      localStorage.removeItem('token')
      localStorage.removeItem('empresa_id')
    } catch { /* ignore */ }
    fb.toast('Você saiu da conta.')
    router.replace('/login')
  }

  const r = dados?.resumo
  const maxDia = Math.max(1, ...(dados?.por_dia || []).map((d) => d.total))

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Perfil</h1>
          <p className="text-sm text-slate-500 mt-1">Seus dados, o histórico de quanto você rodou e a saída da conta.</p>
        </div>
        <button onClick={logout}
          className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50">
          ⏻ Sair (logout)
        </button>
      </div>

      {/* Dados do usuário */}
      <div className="bg-white border rounded-2xl shadow-sm p-5">
        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : usuario ? (
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-brand text-xl font-bold">
              {(usuario.nome || usuario.email || '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{usuario.nome || '—'}</p>
              <p className="text-sm text-slate-500 truncate">{usuario.email}</p>
              <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {ROLE_LABEL[usuario.role] || usuario.role}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Sessão não encontrada.</p>
        )}
      </div>

      {erro && <p className="text-red-600 text-sm">{erro}</p>}

      {/* Histórico — quanto rodou */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quanto você rodou</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total" value={r?.total ?? 0} />
          <Stat label="Hoje" value={r?.hoje ?? 0} />
          <Stat label="Últimos 7 dias" value={r?.semana ?? 0} />
          <Stat label="Falharam" value={r?.falhou ?? 0} tone="red" />
        </div>
      </div>

      {/* Por dia (14 dias) */}
      {!!dados?.por_dia?.length && (
        <div className="bg-white border rounded-2xl shadow-sm p-5">
          <h3 className="font-semibold text-sm mb-3">Disparos por dia (14 dias)</h3>
          <div className="space-y-1.5">
            {dados.por_dia.map((d) => (
              <div key={d.dia} className="flex items-center gap-3 text-xs">
                <span className="w-12 text-slate-500 shrink-0">{fmtDia(d.dia)}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-brand h-3 rounded-full" style={{ width: `${(d.total / maxDia) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-medium text-slate-700">{d.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recentes */}
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h3 className="font-semibold text-sm">Últimos disparos</h3>
        </div>
        <div className="divide-y">
          {dados?.recentes?.length ? dados.recentes.map((d) => (
            <div key={d.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{d.prospect_nome || '(lead removido)'}</p>
                <p className="text-xs text-slate-400">{fmtDataHora(d.criado_em)} · {d.evolution_instance}</p>
              </div>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status] || 'bg-slate-100 text-slate-600'}`}>
                {d.status}
              </span>
            </div>
          )) : (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              Você ainda não rodou nenhum lead.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="bg-white border rounded-2xl shadow-sm p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === 'red' && value > 0 ? 'text-red-600' : 'text-slate-800'}`}>{value}</p>
    </div>
  )
}
