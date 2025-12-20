'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Upload } from 'lucide-react'
import {
  EnvironmentVariablesTable,
  EnvironmentVariableModal,
  BulkImportModal,
} from '@/components/features/env-vars'
import {
  getWorkspaceEnvironmentVariables,
  type EnvironmentVariableDisplay,
} from '@/app/actions/environment-variables'

interface WorkspaceSettingsClientProps {
  workspaceId: string
  workspaceSlug: string
}

export function WorkspaceSettingsClient({
  workspaceId,
  workspaceSlug,
}: WorkspaceSettingsClientProps) {
  const [variables, setVariables] = useState<EnvironmentVariableDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [editVariable, setEditVariable] = useState<EnvironmentVariableDisplay | undefined>()

  const loadVariables = useCallback(async () => {
    setLoading(true)
    const result = await getWorkspaceEnvironmentVariables(workspaceId)
    if (result.success && result.variables) {
      setVariables(result.variables)
    }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    loadVariables()
  }, [loadVariables])

  const handleEdit = (variable: EnvironmentVariableDisplay) => {
    setEditVariable(variable)
    setAddModalOpen(true)
  }

  const handleCloseModal = () => {
    setAddModalOpen(false)
    setEditVariable(undefined)
  }

  const handleSuccess = () => {
    loadVariables()
  }

  return (
    <div className="space-y-6">
      {/* Environment Variables Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>
                Configure variables available to all apps in this workspace.
                Apps can override these values with app-specific settings.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Bulk Import
              </Button>
              <Button onClick={() => setAddModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Variable
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : (
            <EnvironmentVariablesTable
              variables={variables}
              onEdit={handleEdit}
              onRefresh={loadVariables}
              isWorkspaceLevel={true}
            />
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Variable Modal */}
      <EnvironmentVariableModal
        open={addModalOpen}
        onOpenChange={handleCloseModal}
        workspaceId={workspaceId}
        editVariable={editVariable}
        onSuccess={handleSuccess}
      />

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
        workspaceId={workspaceId}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
