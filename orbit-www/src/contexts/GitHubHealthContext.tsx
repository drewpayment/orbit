'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { getGitHubHealth, triggerTokenRefresh, type GitHubHealthStatus } from '@/app/actions/templates'

const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes
const STORAGE_KEY = 'orbit:github-health-dismissed'

interface GitHubHealthContextType {
  health: GitHubHealthStatus | null
  isLoading: boolean
  isRefreshing: boolean
  lastChecked: Date | null
  dismissedUntil: Date | null
  dismiss: (duration: 'session' | '1hour' | '24hours') => void
  refresh: () => Promise<void>
}

const GitHubHealthContext = createContext<GitHubHealthContextType | null>(null)

export function useGitHubHealth() {
  const context = useContext(GitHubHealthContext)
  if (!context) {
    throw new Error('useGitHubHealth must be used within GitHubHealthProvider')
  }
  return context
}

interface GitHubHealthProviderProps {
  children: React.ReactNode
  workspaceIds: string[]
}

export function GitHubHealthProvider({ children, workspaceIds }: GitHubHealthProviderProps) {
  const [health, setHealth] = useState<GitHubHealthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [dismissedUntil, setDismissedUntil] = useState<Date | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Load dismissed state from SessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      if (stored === 'session') {
        // Session dismissal - already dismissed for this session
        setDismissedUntil(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) // Far future
      } else {
        const dismissedDate = new Date(stored)
        if (dismissedDate > new Date()) {
          setDismissedUntil(dismissedDate)
        } else {
          // Expired, remove from storage
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }, [])

  const checkHealth = useCallback(async () => {
    if (workspaceIds.length === 0) return

    // Skip if dismissed
    if (dismissedUntil && dismissedUntil > new Date()) {
      return
    }

    setIsLoading(true)
    try {
      const result = await getGitHubHealth(workspaceIds)
      setHealth(result)
      setLastChecked(new Date())

      // If health is now good, clear any dismissal
      if (result.healthy) {
        setDismissedUntil(null)
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch (error) {
      console.error('[GitHubHealth] Failed to check health:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceIds, dismissedUntil])

  const dismiss = useCallback((duration: 'session' | '1hour' | '24hours') => {
    let until: Date

    if (duration === 'session') {
      sessionStorage.setItem(STORAGE_KEY, 'session')
      until = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Far future for session
    } else if (duration === '1hour') {
      until = new Date(Date.now() + 60 * 60 * 1000)
      sessionStorage.setItem(STORAGE_KEY, until.toISOString())
    } else {
      until = new Date(Date.now() + 24 * 60 * 60 * 1000)
      sessionStorage.setItem(STORAGE_KEY, until.toISOString())
    }

    setDismissedUntil(until)
  }, [])

  const refresh = useCallback(async () => {
    // Clear dismissal
    setDismissedUntil(null)
    sessionStorage.removeItem(STORAGE_KEY)

    // If we have invalid installations, trigger token refresh workflow
    if (health && !health.healthy) {
      const invalidInstallations = health.installations.filter(inst => !inst.tokenValid)
      if (invalidInstallations.length > 0) {
        setIsRefreshing(true)
        try {
          const installationIds = invalidInstallations.map(inst => inst.id)
          console.log('[GitHubHealth] Triggering token refresh for:', invalidInstallations.map(i => i.accountLogin))

          const result = await triggerTokenRefresh(installationIds)
          console.log('[GitHubHealth] Token refresh result:', result)

          // Wait a moment for the workflow to start and do initial refresh
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (error) {
          console.error('[GitHubHealth] Failed to trigger token refresh:', error)
        } finally {
          setIsRefreshing(false)
        }
      }
    }

    // Re-check health status
    await checkHealth()
  }, [health, checkHealth])

  // Initial check and polling
  useEffect(() => {
    if (workspaceIds.length === 0) return

    // Initial check
    checkHealth()

    // Set up polling
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [workspaceIds, checkHealth])

  return (
    <GitHubHealthContext.Provider
      value={{
        health,
        isLoading,
        isRefreshing,
        lastChecked,
        dismissedUntil,
        dismiss,
        refresh,
      }}
    >
      {children}
    </GitHubHealthContext.Provider>
  )
}
