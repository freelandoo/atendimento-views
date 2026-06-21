import type { Metadata } from 'next'
import { Space_Grotesk, Sora, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import MotionProvider from '@/components/motion/MotionProvider'

const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const sans = Sora({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'atendimento-views — Command Deck',
  description: 'Agente de vendas WhatsApp multiempresa',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}
