import React from 'react'
import type { Metadata } from 'next'
import { Instrument_Serif, Inter } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { RuntimeEnvScript } from '@/components/runtime-env-script'
import '@/app/globals.css'

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-instrument-serif',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Orbit — Internal Developer Portal',
  description:
    'The single pane of glass for services, APIs, Kafka topics, and documentation across your organization.',
  openGraph: {
    title: 'Orbit — Internal Developer Portal',
    description:
      'The single pane of glass for services, APIs, Kafka topics, and documentation across your organization.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <RuntimeEnvScript />
      </head>
      <body
        className={`${instrumentSerif.variable} ${inter.variable} font-[family-name:var(--font-inter)] bg-[#0A0A0B] text-white antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
