import React from 'react'
import { Crimson_Pro, Source_Serif_4 } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { BreadcrumbProvider } from '@/components/breadcrumb-provider'
import { AuthGuard } from '@/components/auth-guard'
import { GitHubHealthProviderWrapper } from '@/components/providers/GitHubHealthProviderWrapper'
import { Toaster } from '@/components/ui/sonner'
import { RuntimeEnvScript } from '@/components/runtime-env-script'
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
      <head>
        <RuntimeEnvScript />
      </head>
      <body className={`${crimsonPro.variable} ${sourceSerif.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <BreadcrumbProvider>
            <AuthGuard>
              <GitHubHealthProviderWrapper>
                {/*
                 * Outer <main> wraps every (frontend) page. Width is
                 * explicit (w-full + flex column) so child pages that
                 * use SidebarInset don't fight the default intrinsic
                 * sizing of an un-styled <main>. Pages without
                 * SidebarInset still get a <main> landmark from here.
                 */}
                <main className="flex min-h-svh w-full flex-col">
                  {children}
                </main>
              </GitHubHealthProviderWrapper>
            </AuthGuard>
          </BreadcrumbProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
