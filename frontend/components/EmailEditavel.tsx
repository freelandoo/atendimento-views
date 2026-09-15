'use client'
import { IconEnvelope } from '@/components/ui/icons'
import { ContatoEditavel } from '@/components/ContatoEditavel'

// Campo de e-mail inline e editável, reusado nas telas de Prospecção, Banco de Leads
// e Captação. `onSave` recebe o e-mail já trimado ('' = limpar) e deve persistir + atualizar
// o estado local da lista; lança erro (Error) para exibir a mensagem ao operador.
//
// O comportamento vive em `ContatoEditavel` (mesmo componente do "+ telefone"). Aqui fica só o
// vocabulário do e-mail — as três telas que já importavam daqui não mudaram.
export function EmailEditavel({
  value,
  onSave,
}: {
  value: string | null
  onSave: (email: string) => Promise<void>
}) {
  return (
    <ContatoEditavel
      value={value}
      onSave={onSave}
      rotuloVazio="+ e-mail"
      placeholder="email@dominio.com"
      tipo="email"
      titulo="Editar e-mail"
    >
      <><IconEnvelope /> {value}</>
    </ContatoEditavel>
  )
}
