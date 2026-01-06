'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createServiceAccount } from '@/app/actions/kafka-service-accounts'

interface CreateServiceAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applicationId: string
  virtualClusterId: string
  environment: string
  onSuccess: (password: string) => void
}

export function CreateServiceAccountDialog({
  open,
  onOpenChange,
  applicationId,
  virtualClusterId,
  environment,
  onSuccess,
}: CreateServiceAccountDialogProps) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<'producer' | 'consumer' | 'admin'>('consumer')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }

    setLoading(true)
    try {
      const result = await createServiceAccount({
        name: name.trim(),
        applicationId,
        virtualClusterId,
        permissionTemplate: template,
      })

      if (result.success && result.password) {
        setName('')
        setTemplate('consumer')
        onSuccess(result.password)
      } else {
        toast.error(result.error || 'Failed to create service account')
      }
    } catch {
      toast.error('Failed to create service account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Service Account</DialogTitle>
          <DialogDescription>
            Create a new service account for the {environment} environment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., order-processor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">Used to generate the username</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="template">Permission Template</Label>
            <Select
              value={template}
              onValueChange={(v) => setTemplate(v as typeof template)}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producer">
                  <div>
                    <div className="font-medium">Producer</div>
                    <div className="text-xs text-muted-foreground">
                      Write to topics, describe configs
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="consumer">
                  <div>
                    <div className="font-medium">Consumer</div>
                    <div className="text-xs text-muted-foreground">
                      Read from topics, manage consumer groups
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div>
                    <div className="font-medium">Admin</div>
                    <div className="text-xs text-muted-foreground">
                      Full access: create/delete topics, manage configs
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
