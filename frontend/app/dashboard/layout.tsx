import Sidebar from '@/components/Sidebar'
import { FeedbackProvider } from '@/components/feedback/FeedbackProvider'
import AuthGuard from '@/components/AuthGuard'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <FeedbackProvider>
        {/* Em telas pequenas o eixo é vertical: a barra do mobile (dentro do Sidebar) fica
            no topo e o conteúdo abaixo. A partir de `md` volta a ser coluna + conteúdo. */}
        <div className="flex min-h-[100dvh] flex-col bg-void md:flex-row">
          <Sidebar />
          {/* Conteúdo em tema claro; a coluna (Sidebar) permanece dark. */}
          <main className="min-w-0 flex-1 overflow-auto bg-gray-50 p-5 text-slate-900 [color-scheme:light] sm:p-8">
            {children}
          </main>
        </div>
      </FeedbackProvider>
    </AuthGuard>
  )
}
