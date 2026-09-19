import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // brand azul original — usado pelas páginas claras (a coluna/login usam tokens neon diretamente).
        brand: { DEFAULT: '#2563eb', dark: '#1d4ed8' },

        // ── Tema CLARO (área de trabalho) ────────────────────────────────────
        // Tokens SEMÂNTICOS: dizem o PAPEL, não a cor. Os valores são exatamente
        // os literais que as telas já usam hoje (família `slate`), medidos em
        // 2026-09-18 — adotá-los não muda um pixel, só passa a nomear o que existe.
        // Regra: em tela nova, use o token; literal `slate-*`/`gray-*` é legado.
        surface: {
          DEFAULT: '#ffffff', // card, modal, linha de tabela      (era bg-white, 253 usos)
          2: '#f8fafc', //       fundo de página, zebra, cabeçalho  (era bg-slate-50, 187)
          3: '#f1f5f9', //       hover, input, faixa neutra         (era bg-slate-100, 65)
        },
        line: {
          DEFAULT: '#e2e8f0', // borda padrão                       (era border-slate-200, 127)
          strong: '#cbd5e1', //  divisor com ênfase                 (era border-slate-300, 32)
        },
        ink: {
          DEFAULT: '#0f172a', // texto principal                    (era text-slate-900, 60)
          2: '#475569', //       texto secundário                   (era text-slate-600, 206)
          3: '#64748b', //       texto de apoio, rótulo             (era text-slate-500, 406)
        },
        // Estados. Cor NUNCA é o único sinal — sempre acompanhe de rótulo em texto
        // (mesma regra que `BolinhaPontuacao` e `AlternadorModoIa` já cumprem).
        estado: {
          ok: '#059669', //     emerald-600
          warn: '#d97706', //   amber-600
          danger: '#dc2626', // red-600
          info: '#2563eb', //   = brand
        },

        // ── Tema NEON (login, signup e a Sidebar — a porta de entrada) ───────
        void: '#060912',
        panel: { DEFAULT: '#0d1322', 2: '#111a2e' },
        neon: {
          cyan: '#22e3ff',
          magenta: '#ff3df0',
          lime: '#7cff6b',
          amber: '#ffb020',
          red: '#ff4d6d',
          violet: '#9d7bff',
        },
        hi: '#eaf2ff',
        mid: '#a7b4d0',
        lo: '#6b7a9e',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Elevação do tema claro. `card` é o mesmo valor de `shadow-sm` (104 usos):
        // nomear não muda nada hoje e evita a próxima tela escolher outra sombra.
        card: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        'glow-cyan': '0 0 24px rgba(34,227,255,.45)',
        'glow-magenta': '0 0 24px rgba(255,61,240,.40)',
        'glow-lime': '0 0 24px rgba(124,255,107,.40)',
        'glow-soft': '0 0 0 1px rgba(34,227,255,.14), 0 14px 50px -18px rgba(34,227,255,.35)',
      },
      keyframes: {
        'pulse-glow': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        'float-y': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        'float-y': 'float-y 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
