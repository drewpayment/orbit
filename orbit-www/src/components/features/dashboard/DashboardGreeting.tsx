'use client'

import { useState, useEffect } from 'react'

interface DashboardGreetingProps {
  userName: string
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardGreeting({ userName }: DashboardGreetingProps) {
  const [greeting, setGreeting] = useState('Welcome')

  useEffect(() => {
    setGreeting(getGreeting())
  }, [])

  const displayText = userName ? `${greeting}, ${userName}` : greeting

  return (
    <h1 className="text-2xl font-bold tracking-tight text-foreground">
      {displayText}
    </h1>
  )
}
