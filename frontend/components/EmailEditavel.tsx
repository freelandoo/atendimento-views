'use client'
import { useState } from 'react'
import { IconEnvelope } from '@/components/ui/icons'

// Campo de e-mail inline e editável, reusado nas telas de Prospecção, Banco de Leads
// e Captação. `onSave` recebe o e-mail já trimado ('' = limpar) e deve persistir + atualizar
// o estado local da lista; lança erro (Error) para exibir a mensagem ao operador.
export function EmailEditavel({
  value,
  onSave,
}: {
  value: string | null
  onSave: (email: string) => Promise<void>
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(value || '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      await onSave(texto.trim())
      setEditando(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  if (!editando) {
    return value ? (
      <button
        onClick={() => { setTexto(value); setEditando(true) }}
        className="inline-flex items-center gap-1.5 text-blue-700 hover:underline"
        title="Editar e-mail"
      >
        <IconEnvelope /> {value}
      </button>
    ) : (
      <button
        onClick={() => { setTexto(''); setEditando(true) }}
        className="text-slate-400 hover:text-blue-700 hover:underline"
      >
        + e-mail
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="email"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="email@dominio.com"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar()
          if (e.key === 'Escape') { setEditando(false); setErro(null) }
        }}
        className="border rounded px-1.5 py-0.5 text-xs w-44"
      />
      <button onClick={salvar} disabled={salvando} className="text-emerald-600 text-xs hover:underline disabled:opacity-40">
        {salvando ? '…' : 'salvar'}
      </button>
      <button onClick={() => { setEditando(false); setErro(null) }} className="text-slate-400 text-xs hover:underline">
        cancelar
      </button>
      {erro && <span className="text-red-600 text-[10px]">{erro}</span>}
    </span>
  )
}
