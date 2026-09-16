'use client'
import { useState, type ReactNode } from 'react'

// Campo de CONTATO inline e editável (e-mail, telefone). Nasceu da generalização do
// `EmailEditavel`, que já servia Prospecção, Banco de Leads e Captação: o "+ telefone" precisava
// do MESMO comportamento (abrir, digitar, Enter salva, Escape cancela, erro do servidor na
// linha), e uma segunda cópia divergiria no primeiro ajuste.
//
// Este componente NÃO valida nada de propósito. Quem diz se o valor serve é o backend — é lá que
// o telefone é conferido contra os outros leads da empresa e que o e-mail tem seu formato
// cobrado. Validar aqui criaria uma segunda régua, mais frouxa, sem o banco na mão.
export function ContatoEditavel({
  value,
  onSave,
  rotuloVazio,
  placeholder,
  tipo = 'text',
  titulo,
  largura = 'w-44',
  classeValor,
  children,
}: {
  value: string | null
  onSave: (valor: string) => Promise<void>
  /** O que aparece quando não há valor (ex.: "+ e-mail", "+ telefone"). */
  rotuloVazio: string
  placeholder: string
  tipo?: 'email' | 'tel' | 'text'
  titulo: string
  largura?: string
  /** Aparência do valor preenchido. Existe para o número no cabeçalho da conversa continuar
      parecendo o número (mono, discreto) em vez de virar um link azul no meio do título. */
  classeValor?: string
  /** Como o valor preenchido é desenhado. Sem isto, mostra o texto cru. */
  children?: ReactNode
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
        className={classeValor ?? 'inline-flex items-center gap-1.5 text-blue-700 hover:underline'}
        title={titulo}
      >
        {children ?? value}
      </button>
    ) : (
      <button
        onClick={() => { setTexto(''); setEditando(true) }}
        className="text-slate-400 hover:text-blue-700 hover:underline"
        title={titulo}
      >
        {rotuloVazio}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type={tipo}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar()
          if (e.key === 'Escape') { setEditando(false); setErro(null) }
        }}
        className={`border rounded px-1.5 py-0.5 text-xs ${largura}`}
      />
      <button onClick={salvar} disabled={salvando} className="text-emerald-600 text-xs hover:underline disabled:opacity-40">
        {salvando ? '…' : 'salvar'}
      </button>
      <button onClick={() => { setEditando(false); setErro(null) }} className="text-slate-400 text-xs hover:underline">
        cancelar
      </button>
      {/* A mensagem do servidor aparece NA LINHA (ex.: "este número já pertence a outro lead"):
          é o único lugar onde o operador ainda tem o contexto do que acabou de digitar. */}
      {erro && <span className="text-red-600 text-[10px] max-w-[18rem]">{erro}</span>}
    </span>
  )
}
