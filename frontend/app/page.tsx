import type { Metadata } from 'next'
import Link from 'next/link'

// Landing pública (porta de entrada) — tema NEON, como login/signup.
// Nomes dos planos são PLACEHOLDER (a definir com copy). Preços reais.
// Server component: sem JS de cliente, só conteúdo + links.

export const metadata: Metadata = {
  title: 'Atendimento Views — CRM + captação de leads no WhatsApp',
  description:
    'Encontre empresas, descubra os dados que faltam e atenda no WhatsApp com IA. Fila inteligente entre vários chips e leads já cruzados.',
}

const PLANOS = [
  {
    nome: 'Essencial', // placeholder (interno: Mínimo)
    preco: 'R$ 79',
    periodo: '/mês',
    resumo: 'O app para organizar e trabalhar seus leads na mão.',
    itens: [
      'Banco de Leads + Quadro do Dia',
      'Busca de leads por nicho e cidade',
      'Follow-up e agenda manuais',
      'Atendimento pelo WhatsApp (manual)',
    ],
    falta: ['Sem IA automática', 'Sem follow-up automático'],
    destaque: false,
    estado: 'ativo' as const,
  },
  {
    nome: 'Profissional', // placeholder (interno: Básico)
    preco: 'R$ 149,90',
    periodo: '/mês',
    resumo: 'O dia a dia de quem vende de verdade, com a IA trabalhando junto.',
    itens: [
      'Tudo do Essencial',
      'IA responde no WhatsApp sozinha',
      'Follow-up automático',
      'Vários chips com fila anti-ban',
      'Mais leads por busca + ICP',
    ],
    falta: [],
    destaque: true,
    estado: 'ativo' as const,
  },
  {
    nome: 'Equipe', // placeholder (interno: Pro)
    preco: 'R$ 600+',
    periodo: '/mês',
    resumo: 'Para o time comercial inteiro, com os dados completos.',
    itens: [
      'Tudo do Profissional',
      'Cruzamento completo dos dados do lead',
      'Central de Ligações',
      'CRM comercial de equipe (metas, comissão, distribuição)',
    ],
    falta: [],
    destaque: false,
    estado: 'em_breve' as const,
  },
]

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-neon-cyan" aria-hidden="true">
      <path fill="currentColor" d="M8.2 13.3 4.9 10l-1.2 1.2 4.5 4.5 9-9-1.2-1.2z" />
    </svg>
  )
}

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      {/* halos de profundidade (mesmo recurso do login) */}
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-neon-cyan/15 blur-[130px]" />
      <div className="pointer-events-none absolute -right-24 top-[40rem] h-96 w-96 rounded-full bg-neon-magenta/12 blur-[130px]" />

      {/* ───────── Barra de topo ───────── */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-lg font-bold bg-gradient-to-r from-neon-magenta to-neon-cyan bg-clip-text text-transparent">
          Atendimento Views
        </span>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 text-mid transition hover:text-hi">
            Entrar
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-4 py-2 font-semibold text-neon-cyan transition-all hover:bg-neon-cyan/25 hover:shadow-glow-cyan"
          >
            Testar grátis
          </Link>
        </nav>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="bg-grid relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-14 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-neon-lime/30 bg-neon-lime/10 px-3 py-1 text-xs font-medium text-neon-lime">
          <span className="h-1.5 w-1.5 rounded-full bg-neon-lime animate-pulse-glow" />
          Beta · já funcional para trabalho
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-bold leading-tight text-hi sm:text-6xl">
          O CRM que <span className="bg-gradient-to-r from-neon-magenta to-neon-cyan bg-clip-text text-transparent">capta, cruza e atende</span> seus leads no WhatsApp
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-base text-mid sm:text-lg">
          Encontre empresas, descubra os dados que faltam e atenda no WhatsApp — com
          uma IA que organiza o trabalho e protege seus números.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="w-full rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-6 py-3 text-sm font-semibold text-neon-cyan transition-all hover:bg-neon-cyan/25 hover:shadow-glow-cyan active:scale-[0.98] sm:w-auto"
          >
            Testar 7 dias grátis →
          </Link>
          <Link
            href="/login"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-hi transition hover:bg-white/10 sm:w-auto"
          >
            Já tenho conta
          </Link>
        </div>
        <p className="mt-3 text-xs text-lo">Sem cartão no teste. Cancele quando quiser.</p>
      </section>

      {/* ───────── Problema → virada ───────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              dor: 'Lista de leads sem contexto',
              ganho: 'Leads já com telefone, site e contexto — prontos para abordar.',
            },
            {
              dor: 'Follow-up que escapa',
              ganho: 'A IA cuida do follow-up e da agenda no tempo certo.',
            },
            {
              dor: 'Medo de queimar o número',
              ganho: 'Fila inteligente entre vários chips, com intervalo e limite.',
            },
          ].map((c) => (
            <div key={c.dor} className="glass rounded-2xl p-6">
              <p className="text-xs font-medium uppercase tracking-wider text-neon-red/70">
                {c.dor}
              </p>
              <p className="mt-2 text-sm text-hi">{c.ganho}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Diferenciais ───────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-bold text-hi">
          O que a maioria não faz
        </h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="glass rounded-2xl p-8 shadow-glow-soft">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan/70">
              Vários chips, sem queimar número
            </p>
            <h3 className="mt-2 font-display text-xl font-bold text-hi">
              Conecte quantos chips quiser — o sistema sabe disparar
            </h3>
            <p className="mt-3 text-sm text-mid">
              Os números não disparam todos de uma vez. Eles entram em fila, com
              intervalo entre envios e limite por número — manda um, depois o outro,
              seguindo a ordem. Mais seguro, não só mais rápido.
            </p>
          </div>

          <div className="glass rounded-2xl p-8 shadow-glow-soft">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-magenta/70">
              A ferramenta cruza os dados
            </p>
            <h3 className="mt-2 font-display text-xl font-bold text-hi">
              Um lead chega inteiro, não pela metade
            </h3>
            <p className="mt-3 text-sm text-mid">
              Pega a página do Facebook, descobre o telefone, confere se o Google Maps
              está ativo, se tem site próprio — e junta tudo numa tela onde você
              trabalha em poucos cliques, com a IA conversando entre os dados.
            </p>
          </div>
        </div>
      </section>

      {/* ───────── Como funciona ───────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-bold text-hi">Como funciona</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {[
            { n: '1', t: 'Capta e cruza', d: 'Escolha nicho e cidade. Receba empresas com os dados já cruzados.' },
            { n: '2', t: 'Qualifica', d: 'O ICP mostra quais leads valem o seu tempo primeiro.' },
            { n: '3', t: 'Atende e agenda', d: 'WhatsApp com IA, follow-up e agenda cuidando do resto.' },
          ].map((s) => (
            <div key={s.n} className="glass rounded-2xl p-6">
              <span className="font-display text-3xl font-bold text-neon-cyan">{s.n}</span>
              <h3 className="mt-2 font-display text-lg font-bold text-hi">{s.t}</h3>
              <p className="mt-1 text-sm text-mid">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Planos ───────── */}
      <section id="planos" className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-bold text-hi">Planos</h2>
        <p className="mt-2 text-center text-sm text-mid">
          7 dias grátis para testar, sem cartão.
        </p>

        <div className="mt-10 grid items-start gap-5 lg:grid-cols-3">
          {PLANOS.map((p) => (
            <div
              key={p.nome}
              className={`glass relative flex flex-col rounded-2xl p-7 ${
                p.destaque ? 'border-neon-cyan/40 shadow-glow-soft' : ''
              }`}
            >
              {p.destaque && (
                <span className="absolute -top-3 left-7 rounded-full border border-neon-cyan/40 bg-neon-cyan/20 px-3 py-0.5 text-xs font-semibold text-neon-cyan">
                  Mais popular
                </span>
              )}
              {p.estado === 'em_breve' && (
                <span className="absolute -top-3 left-7 rounded-full border border-neon-amber/40 bg-neon-amber/15 px-3 py-0.5 text-xs font-semibold text-neon-amber">
                  Em construção · em breve
                </span>
              )}

              <h3 className="font-display text-xl font-bold text-hi">{p.nome}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-3xl font-bold text-hi">{p.preco}</span>
                <span className="text-sm text-lo">{p.periodo}</span>
              </div>
              <p className="mt-2 text-sm text-mid">{p.resumo}</p>

              <ul className="mt-5 space-y-2 text-sm text-hi">
                {p.itens.map((i) => (
                  <li key={i} className="flex gap-2">
                    <Check />
                    <span>{i}</span>
                  </li>
                ))}
                {p.falta.map((i) => (
                  <li key={i} className="flex gap-2 text-lo">
                    <span className="mt-0.5 h-4 w-4 shrink-0 text-center">–</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 pt-2">
                {p.estado === 'em_breve' ? (
                  <span className="block cursor-not-allowed rounded-lg border border-white/10 bg-white/5 py-2.5 text-center text-sm font-medium text-lo">
                    Em breve
                  </span>
                ) : (
                  <Link
                    href="/signup"
                    className={`block rounded-lg py-2.5 text-center text-sm font-semibold transition-all active:scale-[0.98] ${
                      p.destaque
                        ? 'border border-neon-cyan/40 bg-neon-cyan/15 text-neon-cyan hover:bg-neon-cyan/25 hover:shadow-glow-cyan'
                        : 'border border-white/10 bg-white/5 text-hi hover:bg-white/10'
                    }`}
                  >
                    Começar teste
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Resultado (sem métrica inventada) ───────── */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 py-16 text-center">
        <h2 className="font-display text-3xl font-bold text-hi">
          Menos tempo procurando lead. Mais tempo vendendo.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base text-mid">
          O lead chega pronto, o follow-up não escapa e a agenda enche. Você trabalha
          a lista certa, na ordem certa — e deixa a parte repetitiva com a ferramenta.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-lg border border-neon-cyan/40 bg-neon-cyan/15 px-6 py-3 text-sm font-semibold text-neon-cyan transition-all hover:bg-neon-cyan/25 hover:shadow-glow-cyan active:scale-[0.98]"
        >
          Testar 7 dias grátis →
        </Link>
      </section>

      {/* ───────── Rodapé ───────── */}
      <footer className="relative z-10 mt-8 border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-lo sm:flex-row">
          <span>© {new Date().getFullYear()} Atendimento Views · versão beta</span>
          <div className="flex gap-5">
            <Link href="/login" className="transition hover:text-hi">Entrar</Link>
            <Link href="/signup" className="transition hover:text-hi">Criar conta</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
