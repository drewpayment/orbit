'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { retryVirtualClusterProvisioning } from '@/app/actions/kafka-applications'

interface RetryProvisioningButtonProps {
  applicationId: string
  onRetryComplete: () => void
  disabled?: boolean
  size?: 'default' | 'sm' | 'lg' | 'icon'
  variant?: 'default' | 'secondary' | 'outline' | 'ghost'
}

export function RetryProvisioningButton({
  applicationId,
  onRetryComplete,
  disabled = false,
  size = 'default',
  variant = 'default',
}: RetryProvisioningButtonProps) {
  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = useCallback(async () => {
    if (isRetrying || disabled) return

    setIsRetrying(true)
    toast.success('Provisioning started')

    try {
      const result = await retryVirtualClusterProvisioning(applicationId)

      if (result.success) {
        toast.success('Provisioning workflow started successfully')
        onRetryComplete()
      } else {
        toast.error(`Failed to start provisioning: ${result.error}`)
      }
    } catch (error) {
      toast.error('Failed to start provisioning')
      console.error('Retry provisioning error:', error)
    } finally {
      setIsRetrying(false)
    }
  }, [applicationId, onRetryComplete, isRetrying, disabled])

  return (
    <Button
      onClick={handleRetry}
      disabled={disabled || isRetrying}
      size={size}
      variant={variant}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
      {isRetrying ? 'Retrying...' : 'Retry Provisioning'}
    </Button>
  )
}
