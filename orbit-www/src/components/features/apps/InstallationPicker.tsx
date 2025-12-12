'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GitHubInstallation } from '@/app/actions/github'

interface InstallationPickerProps {
  installations: GitHubInstallation[]
  selected: GitHubInstallation | null
  onSelect: (installation: GitHubInstallation) => void
}

export function InstallationPicker({
  installations,
  selected,
  onSelect,
}: InstallationPickerProps) {
  return (
    <Select
      value={selected?.id || ''}
      onValueChange={(value) => {
        const installation = installations.find((i) => i.id === value)
        if (installation) {
          onSelect(installation)
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a GitHub organization">
          {selected && (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={selected.accountAvatarUrl} alt={selected.accountLogin} />
                <AvatarFallback>{selected.accountLogin[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <span>{selected.accountLogin}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {installations.map((installation) => (
          <SelectItem key={installation.id} value={installation.id}>
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage
                  src={installation.accountAvatarUrl}
                  alt={installation.accountLogin}
                />
                <AvatarFallback>{installation.accountLogin[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <span>{installation.accountLogin}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
