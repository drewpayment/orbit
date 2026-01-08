import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { KafkaNavigation } from '@/components/features/kafka/KafkaNavigation'

interface KafkaLayoutProps {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function KafkaLayout({ children, params }: KafkaLayoutProps) {
  const { slug } = await params

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container mx-auto">
            <KafkaNavigation slug={slug} />
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
