import React from 'react'
import { Toaster } from '@/components/ui/sonner'

export const metadata = {
  description: 'Orbit - Internal Developer Portal',
  title: 'Orbit IDP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
