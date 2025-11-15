import React from 'react'
import { ThemeProvider } from '@/components/theme-provider'
import { BreadcrumbProvider } from '@/components/breadcrumb-provider'
import { AuthGuard } from '@/components/auth-guard'
import '@/app/globals.css'

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <BreadcrumbProvider>
            <AuthGuard>
              <main>{children}</main>
            </AuthGuard>
          </BreadcrumbProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
