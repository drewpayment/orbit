import { ThemeProvider } from '@/components/theme-provider'
import { RuntimeEnvScript } from '@/components/runtime-env-script'
import '@/app/globals.css'

export const metadata = {
  title: 'Setup - Orbit',
  description: 'Set up your Orbit instance',
}

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <RuntimeEnvScript />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
