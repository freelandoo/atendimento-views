import { redirect } from 'next/navigation'

// A antiga página "Empresa" foi fundida na página "Empresas" (/dashboard/contextos).
// Mantido como redirect para não quebrar links/bookmarks antigos.
export default function EmpresaPage() {
  redirect('/dashboard/contextos')
}
