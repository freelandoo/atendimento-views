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
        // brand repontado para o ciano neon — preserva usos antigos de `bg-brand`.
        brand: { DEFAULT: '#22e3ff', dark: '#15a6c0' },
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
