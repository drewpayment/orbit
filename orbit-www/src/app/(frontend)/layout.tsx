import React from 'react'
import { Toaster } from '@/components/ui/sonner'
import '../globals.css'

export const metadata = {
  description: 'Orbit - Internal Developer Portal',
  title: 'Orbit IDP',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  )
}
