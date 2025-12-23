import React from 'react'
import { ThemeProvider } from '@/components/theme-provider'
import { BreadcrumbProvider } from '@/components/breadcrumb-provider'
import { AuthGuard } from '@/components/auth-guard'
import { GitHubHealthProviderWrapper } from '@/components/providers/GitHubHealthProviderWrapper'
import { Toaster } from '@/components/ui/sonner'

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <BreadcrumbProvider>
        <AuthGuard>
          <GitHubHealthProviderWrapper>
            <main>{children}</main>
          </GitHubHealthProviderWrapper>
        </AuthGuard>
      </BreadcrumbProvider>
      <Toaster />
    </ThemeProvider>
  )
}
