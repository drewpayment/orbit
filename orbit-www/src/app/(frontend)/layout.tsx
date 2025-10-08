import React from 'react'
import { ThemeProvider } from '@/components/theme-provider'
import { BreadcrumbProvider } from '@/components/breadcrumb-provider'
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
            <main>{children}</main>
          </BreadcrumbProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
