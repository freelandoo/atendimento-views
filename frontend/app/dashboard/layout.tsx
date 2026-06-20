import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-void text-hi">
      <Sidebar />
      <main className="bg-grid min-w-0 flex-1 overflow-auto p-5 sm:p-8">{children}</main>
    </div>
  )
}
