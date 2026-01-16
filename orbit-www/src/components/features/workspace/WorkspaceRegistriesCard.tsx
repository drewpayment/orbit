import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Box, Plus, ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

function RegistryTypeIcon({ type }: { type: 'orbit' | 'ghcr' | 'acr' }) {
  const colors = {
    orbit: 'bg-orange-500',
    ghcr: 'bg-purple-500',
    acr: 'bg-blue-500',
  }
  const labels = {
    orbit: 'Orbit',
    ghcr: 'GHCR',
    acr: 'ACR',
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`h-8 w-8 rounded-lg ${colors[type]} flex items-center justify-center`}>
        <Box className="h-4 w-4 text-white" />
      </div>
      <span className="text-xs text-muted-foreground">{labels[type]}</span>
    </div>
  )
}

interface GroupedImage {
  registryType: 'orbit' | 'ghcr' | 'acr'
  registryName: string
  imageUrl: string
  appName: string
  appId: string
}

interface WorkspaceRegistriesCardProps {
  images: GroupedImage[]
  workspaceSlug: string
}

export function WorkspaceRegistriesCard({
  images,
  workspaceSlug,
}: WorkspaceRegistriesCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href={`/settings/registries?workspace=${encodeURIComponent(workspaceSlug)}`} className="flex items-center gap-2 hover:text-foreground/80 transition-colors">
            <Box className="h-5 w-5" />
            <CardTitle className="text-base">Registries</CardTitle>
          </Link>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
            <Link href={`/settings/registries?workspace=${encodeURIComponent(workspaceSlug)}&action=new`}>
              <Plus className="h-4 w-4 mr-1" />
              New Registry
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {images.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No images pushed yet</p>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/settings/registries?workspace=${encodeURIComponent(workspaceSlug)}`}>
                Configure registries
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
              Image Repository
            </div>
            {images.map((image, idx) => (
              <Link
                key={`${image.appId}-${idx}`}
                href={`/apps/${image.appId}`}
                className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-muted/50 group"
              >
                <RegistryTypeIcon type={image.registryType} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {image.registryName} - {image.appName}
                  </p>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    {image.imageUrl}
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
