import React from 'react'

// Root layout is a pass-through since child route groups have their own html/body.
// Fonts and styles are imported in (frontend)/layout.tsx for non-Payload routes.
// Payload's (payload)/layout.tsx handles its own html/body with @payloadcms/next/layouts.

export const metadata = {
  description: 'Orbit - Internal Developer Portal',
  title: 'Orbit IDP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
