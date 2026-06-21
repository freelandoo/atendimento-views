import Sidebar from '@/components/Sidebar'
import { FeedbackProvider } from '@/components/feedback/FeedbackProvider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <FeedbackProvider>
      <div className="flex min-h-[100dvh] bg-void">
        <Sidebar />
        {/* Conteúdo em tema claro; a coluna (Sidebar) permanece dark. */}
        <main className="min-w-0 flex-1 overflow-auto bg-gray-50 p-5 text-slate-900 [color-scheme:light] sm:p-8">
          {children}
        </main>
      </div>
    </FeedbackProvider>
  )
}
