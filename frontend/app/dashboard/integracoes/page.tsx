'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession, podePapel } from '@/lib/useSession'
import LeadSearchApiKeys from '@/components/LeadSearchApiKeys'
import Card from '@/components/ui/Card'

// Configurações › Integrações — PONTO DE ENTRADA.
//
// Esta página existe para que integrações novas não virem item solto no menu principal:
// elas entram como card aqui dentro. Ela continua sem chamar o backend e sem tocar em
// credencial — quem configura a Meta é a página filha `integracoes/meta`, que é onde o
// token trafega.
//
// A proteção real é do backend; o guard abaixo só evita mostrar a tela a quem não opera.

type Estado = 'em_breve' | 'disponivel'

type Integracao = {
  id: string
  nome: string
  descricao: string
  estado: Estado
  icone: 'meta' | 'crm' | 'agenda' | 'pagamentos' | 'anuncios'
  href?: string
}

const INTEGRACOES: Integracao[] = [
  {
    id: 'meta-conversions',
    nome: 'Meta Conversions',
    descricao: 'Envia o resultado das suas reuniões para o Meta Ads, com as credenciais da sua empresa, para o anúncio aprender com quem realmente fechou.',
    estado: 'disponivel',
    icone: 'meta',
    href: '/dashboard/integracoes/meta',
  },
]

const PROXIMAS: { nome: string; descricao: string; icone: Integracao['icone'] }[] = [
  { nome: 'CRM', descricao: 'Espelhar leads e negociações', icone: 'crm' },
  { nome: 'Agenda', descricao: 'Sincronizar reuniões com calendários externos', icone: 'agenda' },
  { nome: 'Pagamentos', descricao: 'Confirmar venda pelo recebimento', icone: 'pagamentos' },
  { nome: 'Outras plataformas de anúncios', descricao: 'Google Ads, TikTok Ads', icone: 'anuncios' },
]

export default function IntegracoesPage() {
  const router = useRouter()
  const { role, loading } = useSession()
  const superadmin = podePapel(role, 'superadmin')

  useEffect(() => {
    if (!loading && !podePapel(role, 'admin')) router.replace('/dashboard')
  }, [loading, role, router])

  if (loading || !podePapel(role, 'admin')) {
    return <p className="text-sm text-ink-3">Carregando...</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Integrações</h1>
        <p className="mt-1 text-sm text-ink-3">
          Conecte o Atendimento Views às plataformas que você já usa. Cada integração é
          configurada por empresa e vale só para ela.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {INTEGRACOES.map((it) => (
          <article key={it.id} className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-ink-2">
                <Icone nome={it.icone} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-ink">{it.nome}</h2>
                  <Selo estado={it.estado} />
                </div>
                <p className="mt-1.5 text-sm text-ink-2">{it.descricao}</p>
              </div>
            </div>
            {it.href ? (
              <Link
                href={it.href}
                className="mt-4 block rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark"
              >
                Configurar
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="Disponível em breve"
                className="mt-4 w-full cursor-not-allowed rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink-3"
              >
                Configurar
              </button>
            )}
          </article>
        ))}
      </div>

      {superadmin && (
        <section className="space-y-3" aria-label="API de busca de leads">
          <div>
            <h2 className="text-sm font-semibold text-ink">API de busca de leads</h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-3">
              Área de plataforma. Só superadmin cria, revoga e rotaciona códigos externos.
              A tela de Aquisição consome o motor internamente sem precisar destes códigos.
            </p>
          </div>
          <LeadSearchApiKeys />
        </section>
      )}

      <Card titulo="Próximas integrações" descricao="Elas entram aqui como novos cards, sem crescer o menu principal.">
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {PROXIMAS.map((p) => (
            <li key={p.nome} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3">
                <Icone nome={p.icone} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-2">{p.nome}</p>
                <p className="truncate text-xs text-ink-3">{p.descricao}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function Selo({ estado }: { estado: Estado }) {
  if (estado === 'disponivel') {
    return <span className="rounded-full bg-estado-ok/10 px-2 py-0.5 text-[11px] font-semibold text-estado-ok">Disponível</span>
  }
  return <span className="rounded-full bg-estado-warn/10 px-2 py-0.5 text-[11px] font-semibold text-estado-warn">Em breve</span>
}

function Icone({ nome }: { nome: Integracao['icone'] }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      {nome === 'meta' && <path {...common} d="M3 15c0-4 2-8 4.5-8S11 12 12 12s2-5 4.5-5S21 11 21 15a3 3 0 0 1-5.5 1.7M8.5 16.7A3 3 0 0 1 3 15" />}
      {nome === 'crm' && (
        <>
          <circle {...common} cx="9" cy="8" r="3" />
          <path {...common} d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M16 6.5a3 3 0 0 1 0 5.5M18 14.5a4 4 0 0 1 3 3.5v1" />
        </>
      )}
      {nome === 'agenda' && (
        <>
          <path {...common} d="M5 6h14v14H5zM5 10h14M8 3v4M16 3v4" />
        </>
      )}
      {nome === 'pagamentos' && (
        <>
          <path {...common} d="M3 7h18v11H3zM3 11h18" />
          <path {...common} d="M7 15h3" />
        </>
      )}
      {nome === 'anuncios' && (
        <>
          <path {...common} d="M4 9h3l7-4v14l-7-4H4zM18 9.5a3.5 3.5 0 0 1 0 5" />
        </>
      )}
    </svg>
  )
}
