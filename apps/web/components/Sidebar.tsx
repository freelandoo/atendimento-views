'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard', label: 'Visão Geral' },
  { href: '/dashboard/conversas', label: 'Conversas' },
  { href: '/dashboard/contextos', label: 'Contextos' },
  { href: '/dashboard/empresa', label: 'Empresa' },
  { href: '/dashboard/llm', label: 'Modelo LLM' },
  { href: '/dashboard/relatorios', label: 'Relatórios' },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-56 min-h-screen bg-white border-r flex flex-col">
      <div className="px-6 py-5 border-b">
        <span className="font-bold text-brand text-lg">PJ Codeworks</span>
      </div>
      <nav className="flex-1 py-4 space-y-1 px-3">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              pathname === href
                ? 'bg-brand text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
