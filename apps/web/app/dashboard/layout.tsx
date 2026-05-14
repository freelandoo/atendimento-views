import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-gray-50">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto p-5 sm:p-8">{children}</main>
    </div>
  )
}
