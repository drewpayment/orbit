'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ProviderIcon } from './ProviderIcon'

export type Provider = 'aws' | 'gcp' | 'azure' | 'digitalocean'

interface ProviderInfo {
  id: Provider
  name: string
  description: string
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'aws', name: 'AWS', description: 'Amazon Web Services' },
  { id: 'gcp', name: 'GCP', description: 'Google Cloud Platform' },
  { id: 'azure', name: 'Azure', description: 'Microsoft Azure' },
  { id: 'digitalocean', name: 'DigitalOcean', description: 'DigitalOcean' },
]

interface ProviderSelectorProps {
  templateCounts: Record<string, number>
  onSelect: (provider: Provider) => void
}

export function ProviderSelector({ templateCounts, onSelect }: ProviderSelectorProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Select a Cloud Provider</h2>
        <p className="text-muted-foreground mt-2">
          Choose where you want to provision your infrastructure
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PROVIDERS.map((provider) => {
          const count = templateCounts[provider.id] || 0
          return (
            <Card
              key={provider.id}
              className={cn(
                'cursor-pointer transition-all hover:border-primary/50 hover:shadow-md',
                count === 0 && 'opacity-50 cursor-not-allowed',
              )}
              onClick={() => count > 0 && onSelect(provider.id)}
            >
              <CardContent className="flex flex-col items-center text-center pt-6 pb-4 gap-3">
                <ProviderIcon provider={provider.id} size={40} />
                <div>
                  <h3 className="font-semibold text-lg">{provider.name}</h3>
                  <p className="text-sm text-muted-foreground">{provider.description}</p>
                </div>
                <Badge variant={count > 0 ? 'default' : 'secondary'}>
                  {count} template{count !== 1 ? 's' : ''}
                </Badge>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
