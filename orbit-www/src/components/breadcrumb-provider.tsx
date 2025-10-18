'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

interface BreadcrumbItem {
  label: string
  href: string
}

interface BreadcrumbContextType {
  items: BreadcrumbItem[]
  setItems: (items: BreadcrumbItem[]) => void
  workspaceName: string | undefined
  setWorkspaceName: (name: string | undefined) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined)

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([])
  const [workspaceName, setWorkspaceName] = useState<string | undefined>()

  return (
    <BreadcrumbContext.Provider value={{ items, setItems, workspaceName, setWorkspaceName }}>
      {children}
    </BreadcrumbContext.Provider>
  )
}

export function useBreadcrumb() {
  const context = useContext(BreadcrumbContext)
  if (context === undefined) {
    throw new Error('useBreadcrumb must be used within a BreadcrumbProvider')
  }
  return context
}
