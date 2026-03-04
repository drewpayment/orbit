import { Cloud, Server, Database, Droplets } from 'lucide-react'
import { cn } from '@/lib/utils'

const providerConfig: Record<string, { icon: React.ElementType; className: string; label: string }> = {
  aws: { icon: Cloud, className: 'text-orange-400', label: 'AWS' },
  gcp: { icon: Server, className: 'text-blue-400', label: 'GCP' },
  azure: { icon: Database, className: 'text-sky-400', label: 'Azure' },
  digitalocean: { icon: Droplets, className: 'text-blue-300', label: 'DigitalOcean' },
}

interface ProviderIconProps {
  provider: string
  size?: number
  showLabel?: boolean
  className?: string
}

export function ProviderIcon({ provider, size = 16, showLabel = false, className }: ProviderIconProps) {
  const config = providerConfig[provider] ?? { icon: Cloud, className: 'text-muted-foreground', label: provider }
  const Icon = config.icon

  if (showLabel) {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <Icon className={cn(config.className)} style={{ width: size, height: size }} />
        <span>{config.label}</span>
      </span>
    )
  }

  return <Icon className={cn(config.className, className)} style={{ width: size, height: size }} />
}

export { providerConfig }
