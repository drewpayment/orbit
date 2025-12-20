'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { validateEnvName } from '@/lib/env-parser'
import type { EnvironmentVariableDisplay } from '@/app/actions/environment-variables'
import {
  createEnvironmentVariable,
  updateEnvironmentVariable,
  revealEnvironmentVariableValue,
} from '@/app/actions/environment-variables'

interface EnvironmentVariableModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  appId?: string
  editVariable?: EnvironmentVariableDisplay
  onSuccess?: () => void
}

export function EnvironmentVariableModal({
  open,
  onOpenChange,
  workspaceId,
  appId,
  editVariable,
  onSuccess,
}: EnvironmentVariableModalProps) {
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [useInBuilds, setUseInBuilds] = useState(true)
  const [useInDeployments, setUseInDeployments] = useState(true)
  const [showValue, setShowValue] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const isEditing = !!editVariable

  // Reset form when modal opens/closes or editVariable changes
  useEffect(() => {
    if (open) {
      if (editVariable) {
        setName(editVariable.name)
        setValue('') // Value is masked, needs to be re-entered or revealed
        setDescription(editVariable.description || '')
        setUseInBuilds(editVariable.useInBuilds)
        setUseInDeployments(editVariable.useInDeployments)
        setShowValue(false)
      } else {
        setName('')
        setValue('')
        setDescription('')
        setUseInBuilds(true)
        setUseInDeployments(true)
        setShowValue(false)
      }
      setNameError(null)
    }
  }, [open, editVariable])

  const handleRevealValue = async () => {
    if (!editVariable) return

    const result = await revealEnvironmentVariableValue(editVariable.id)
    if (result.success && result.value) {
      setValue(result.value)
      setShowValue(true)
    } else {
      toast.error(result.error || 'Failed to reveal value')
    }
  }

  const handleNameChange = (newName: string) => {
    setName(newName)
    const validation = validateEnvName(newName)
    setNameError(validation.valid ? null : validation.error || null)
  }

  const handleSubmit = () => {
    // Validate name
    const nameValidation = validateEnvName(name)
    if (!nameValidation.valid) {
      setNameError(nameValidation.error || 'Invalid name')
      return
    }

    // Validate value for new variables
    if (!isEditing && !value.trim()) {
      toast.error('Value is required')
      return
    }

    startTransition(async () => {
      if (isEditing && editVariable) {
        // Update existing variable
        const updateData: {
          name?: string
          value?: string
          description?: string
          useInBuilds?: boolean
          useInDeployments?: boolean
        } = {
          name,
          description,
          useInBuilds,
          useInDeployments,
        }

        // Only update value if it was changed
        if (value.trim()) {
          updateData.value = value
        }

        const result = await updateEnvironmentVariable(editVariable.id, updateData)
        if (result.success) {
          toast.success(`Updated ${name}`)
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(result.error || 'Failed to update variable')
        }
      } else {
        // Create new variable
        const result = await createEnvironmentVariable({
          name,
          value,
          workspaceId,
          appId,
          description,
          useInBuilds,
          useInDeployments,
        })

        if (result.success) {
          toast.success(`Created ${name}`)
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(result.error || 'Failed to create variable')
        }
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Environment Variable' : 'Add Environment Variable'}
          </DialogTitle>
          <DialogDescription>
            {appId
              ? 'This variable will only apply to this app.'
              : 'This variable will be available to all apps in the workspace.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name field */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value.toUpperCase())}
              placeholder="TURSO_DATABASE_URL"
              className="font-mono"
              disabled={isPending}
            />
            {nameError && (
              <p className="text-sm text-destructive">{nameError}</p>
            )}
          </div>

          {/* Value field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="value">Value</Label>
              {isEditing && !value && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRevealValue}
                  className="h-6 text-xs"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Reveal current value
                </Button>
              )}
            </div>
            <div className="relative">
              <Input
                id="value"
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isEditing ? '(unchanged)' : 'Enter value'}
                className="font-mono pr-10"
                disabled={isPending}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowValue(!showValue)}
              >
                {showValue ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the current value
              </p>
            )}
          </div>

          {/* Description field */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this variable is used for"
              rows={2}
              disabled={isPending}
            />
          </div>

          {/* Usage checkboxes */}
          <div className="space-y-3">
            <Label>Use in</Label>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useInBuilds"
                  checked={useInBuilds}
                  onCheckedChange={(checked) => setUseInBuilds(checked === true)}
                  disabled={isPending}
                />
                <Label htmlFor="useInBuilds" className="font-normal cursor-pointer">
                  Builds
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useInDeployments"
                  checked={useInDeployments}
                  onCheckedChange={(checked) => setUseInDeployments(checked === true)}
                  disabled={isPending}
                />
                <Label htmlFor="useInDeployments" className="font-normal cursor-pointer">
                  Deployments
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending
              ? isEditing
                ? 'Saving...'
                : 'Creating...'
              : isEditing
                ? 'Save Changes'
                : 'Add Variable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
