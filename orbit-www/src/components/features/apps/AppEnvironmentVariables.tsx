'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Upload, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  EnvironmentVariablesTable,
  EnvironmentVariableModal,
  BulkImportModal,
} from '@/components/features/env-vars'
import {
  getAppEnvironmentVariables,
  createAppOverride,
  type EnvironmentVariableDisplay,
} from '@/app/actions/environment-variables'
import { toast } from 'sonner'

interface AppEnvironmentVariablesProps {
  appId: string
  workspaceId: string
  workspaceSlug?: string
}

export function AppEnvironmentVariables({
  appId,
  workspaceId,
  workspaceSlug,
}: AppEnvironmentVariablesProps) {
  const [appVariables, setAppVariables] = useState<EnvironmentVariableDisplay[]>([])
  const [workspaceVariables, setWorkspaceVariables] = useState<EnvironmentVariableDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [editVariable, setEditVariable] = useState<EnvironmentVariableDisplay | undefined>()

  const loadVariables = useCallback(async () => {
    setLoading(true)
    const result = await getAppEnvironmentVariables(appId)
    if (result.success) {
      setAppVariables(result.variables || [])
      setWorkspaceVariables(result.workspaceVariables || [])
    }
    setLoading(false)
  }, [appId])

  useEffect(() => {
    loadVariables()
  }, [loadVariables])

  const handleEdit = (variable: EnvironmentVariableDisplay) => {
    setEditVariable(variable)
    setAddModalOpen(true)
  }

  const handleCreateOverride = async (workspaceVariable: EnvironmentVariableDisplay) => {
    const result = await createAppOverride(appId, workspaceVariable.id)
    if (result.success) {
      toast.success(`Created override for ${workspaceVariable.name}`)
      loadVariables()
    } else {
      toast.error(result.error || 'Failed to create override')
    }
  }

  const handleCloseModal = () => {
    setAddModalOpen(false)
    setEditVariable(undefined)
  }

  const handleSuccess = () => {
    loadVariables()
  }

  // Combine app and workspace variables for display
  // App variables appear first, then workspace variables that aren't overridden
  const appVarNames = new Set(appVariables.map((v) => v.name))
  const inheritedVariables = workspaceVariables.filter((v) => !appVarNames.has(v.name))
  const allVariables = [
    ...appVariables,
    ...inheritedVariables,
  ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Environment Variables</CardTitle>
              <CardDescription>
                Variables available during builds and deployments.
                App-level variables override workspace defaults.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setBulkImportOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
              <Button size="sm" onClick={() => setAddModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : allVariables.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                No environment variables configured.
              </p>
              {workspaceSlug && (
                <p className="text-sm text-muted-foreground">
                  Configure workspace-level variables in{' '}
                  <a
                    href={`/workspaces/${workspaceSlug}/settings`}
                    className="text-primary hover:underline"
                  >
                    workspace settings
                  </a>
                  , or add app-specific variables here.
                </p>
              )}
            </div>
          ) : (
            <>
              {inheritedVariables.length > 0 && (
                <Alert className="mb-4">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-medium">{inheritedVariables.length}</span> variable
                    {inheritedVariables.length !== 1 ? 's are' : ' is'} inherited from workspace.
                    Click &quot;Override&quot; to set an app-specific value.
                  </AlertDescription>
                </Alert>
              )}
              <EnvironmentVariablesTable
                variables={allVariables}
                onEdit={handleEdit}
                onCreateOverride={handleCreateOverride}
                onRefresh={loadVariables}
                showSource={true}
                isWorkspaceLevel={false}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Variable Modal */}
      <EnvironmentVariableModal
        open={addModalOpen}
        onOpenChange={handleCloseModal}
        workspaceId={workspaceId}
        appId={appId}
        editVariable={editVariable}
        onSuccess={handleSuccess}
      />

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        workspaceId={workspaceId}
        appId={appId}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
