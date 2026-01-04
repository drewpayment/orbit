import React from 'react'
import { Crimson_Pro, Source_Serif_4 } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { BreadcrumbProvider } from '@/components/breadcrumb-provider'
import { AuthGuard } from '@/components/auth-guard'
import { GitHubHealthProviderWrapper } from '@/components/providers/GitHubHealthProviderWrapper'
import { Toaster } from '@/components/ui/sonner'
import '../globals.css'

const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-crimson-pro',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-serif',
  display: 'swap',
})

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${crimsonPro.variable} ${sourceSerif.variable}`}>
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
      </body>
    </html>
  )
}
