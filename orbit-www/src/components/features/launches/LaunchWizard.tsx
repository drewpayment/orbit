'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, AlertTriangle, Loader2, Rocket, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createLaunch, startLaunch } from '@/app/actions/launches'
import { ProviderSelector, type Provider } from './ProviderSelector'
import { TemplateSelector } from './TemplateSelector'
import { ParameterForm } from './ParameterForm'

export interface TemplateDoc {
  id: string
  name: string
  slug: string
  description: string
  type: 'bundle' | 'resource'
  provider: string
  category: string
  parameterSchema?: unknown
  estimatedDuration?: string | null
  crossProviderSlugs?: unknown
  icon?: string | null
}

export interface CloudAccountDoc {
  id: string
  name: string
  provider: string
  region?: string | null
  approvalRequired?: boolean
  status?: string
}

interface LaunchWizardProps {
  templates: TemplateDoc[]
  cloudAccounts: CloudAccountDoc[]
  workspaceId: string
}

type WizardStep = 1 | 2 | 3 | 4

const stepLabels = ['Provider', 'Template', 'Configure', 'Review']

const providerLabels: Record<string, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
}

const categoryLabels: Record<string, string> = {
  compute: 'Compute',
  storage: 'Storage',
  database: 'Database',
  networking: 'Networking',
  container: 'Container',
  serverless: 'Serverless',
}

export function LaunchWizard({ templates, cloudAccounts, workspaceId }: LaunchWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(1)
  const [isLaunching, setIsLaunching] = useState(false)

  // Step 1 state
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)

  // Step 2 state
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDoc | null>(null)

  // Step 3 state
  const [launchName, setLaunchName] = useState('')
  const [selectedCloudAccountId, setSelectedCloudAccountId] = useState('')
  const [region, setRegion] = useState('')
  const [parameters, setParameters] = useState<Record<string, unknown>>({})

  // Derived data
  const templateCounts = templates.reduce<Record<string, number>>((acc, t) => {
    acc[t.provider] = (acc[t.provider] || 0) + 1
    return acc
  }, {})

  const filteredCloudAccounts = cloudAccounts.filter(
    (a) => selectedProvider && a.provider === selectedProvider,
  )

  const selectedCloudAccount = cloudAccounts.find((a) => a.id === selectedCloudAccountId)

  const approvalRequired = selectedCloudAccount?.approvalRequired || false

  // Step handlers
  function handleProviderSelect(provider: Provider) {
    setSelectedProvider(provider)
    setSelectedTemplate(null)
    setSelectedCloudAccountId('')
    setRegion('')
    setParameters({})
    setStep(2)
  }

  function handleTemplateSelect(template: TemplateDoc) {
    setSelectedTemplate(template)
    setLaunchName('')
    setParameters({})
    // Pre-select cloud account if there's only one for this provider
    if (filteredCloudAccounts.length === 1) {
      setSelectedCloudAccountId(filteredCloudAccounts[0].id)
      setRegion(filteredCloudAccounts[0].region || '')
    }
    setStep(3)
  }

  function handleCloudAccountChange(accountId: string) {
    setSelectedCloudAccountId(accountId)
    const account = cloudAccounts.find((a) => a.id === accountId)
    if (account?.region) {
      setRegion(account.region)
    }
  }

  function canProceedToReview(): boolean {
    return (
      launchName.trim() !== '' &&
      selectedCloudAccountId !== '' &&
      region.trim() !== ''
    )
  }

  async function handleLaunch() {
    if (!selectedTemplate || !selectedProvider) return

    setIsLaunching(true)
    try {
      const createResult = await createLaunch({
        name: launchName.trim(),
        workspaceId,
        templateId: selectedTemplate.id,
        templateSlug: selectedTemplate.slug,
        cloudAccountId: selectedCloudAccountId,
        provider: selectedProvider,
        region: region.trim(),
        parameters,
      })

      if (!createResult.success || !createResult.launchId) {
        toast.error(createResult.error || 'Failed to create launch')
        setIsLaunching(false)
        return
      }

      const startResult = await startLaunch(createResult.launchId)
      if (!startResult.success) {
        toast.error(startResult.error || 'Failed to start launch')
        // Still navigate to launch page so user can see the status
        router.push(`/launches/${createResult.launchId}`)
        return
      }

      toast.success('Launch started successfully')
      router.push(`/launches/${createResult.launchId}`)
    } catch (error) {
      console.error('Launch failed:', error)
      toast.error('An unexpected error occurred while launching')
      setIsLaunching(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepLabels.map((label, i) => {
          const stepNum = (i + 1) as WizardStep
          const isActive = step === stepNum
          const isCompleted = step > stepNum
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`h-px w-8 ${isCompleted || isActive ? 'bg-primary' : 'bg-border'}`} />
              )}
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isActive ? 'font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Step 1: Provider */}
      {step === 1 && (
        <ProviderSelector
          templateCounts={templateCounts}
          onSelect={handleProviderSelect}
        />
      )}

      {/* Step 2: Template */}
      {step === 2 && selectedProvider && (
        <TemplateSelector
          templates={templates}
          provider={selectedProvider}
          onSelect={handleTemplateSelect}
          onBack={() => setStep(1)}
        />
      )}

      {/* Step 3: Configure */}
      {step === 3 && selectedProvider && selectedTemplate && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl font-semibold">Configure Launch</h2>
              <p className="text-muted-foreground mt-1">
                Set up deployment parameters for {selectedTemplate.name}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Launch Name */}
            <div className="space-y-2">
              <Label htmlFor="launch-name">
                Launch Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="launch-name"
                placeholder="e.g. production-s3-bucket"
                value={launchName}
                onChange={(e) => setLaunchName(e.target.value)}
                required
              />
            </div>

            {/* Cloud Account */}
            <div className="space-y-2">
              <Label htmlFor="cloud-account">
                Cloud Account <span className="text-destructive">*</span>
              </Label>
              {filteredCloudAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No connected {providerLabels[selectedProvider] ?? selectedProvider} accounts available.
                  Ask an admin to add one.
                </p>
              ) : (
                <Select
                  value={selectedCloudAccountId}
                  onValueChange={handleCloudAccountChange}
                >
                  <SelectTrigger id="cloud-account">
                    <SelectValue placeholder="Select a cloud account" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCloudAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                        {account.region ? ` (${account.region})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Region */}
            <div className="space-y-2">
              <Label htmlFor="region">
                Region <span className="text-destructive">*</span>
              </Label>
              <Input
                id="region"
                placeholder="e.g. us-east-1"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                required
              />
            </div>

            {/* Dynamic Parameters */}
            {selectedTemplate.parameterSchema && (
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Template Parameters</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure the template-specific settings
                  </p>
                </div>
                <ParameterForm
                  schema={selectedTemplate.parameterSchema as any}
                  values={parameters}
                  onChange={setParameters}
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              onClick={() => setStep(4)}
              disabled={!canProceedToReview()}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Launch */}
      {step === 4 && selectedProvider && selectedTemplate && selectedCloudAccount && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl font-semibold">Review & Launch</h2>
              <p className="text-muted-foreground mt-1">
                Confirm your deployment details
              </p>
            </div>
          </div>

          {/* Approval notice */}
          {approvalRequired && (
            <Alert className="border-amber-500/50 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-amber-600">Approval Required</AlertTitle>
              <AlertDescription className="text-amber-600/80">
                This launch requires approval before infrastructure will be provisioned.
                An approver will be notified after you submit.
              </AlertDescription>
            </Alert>
          )}

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Launch Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Launch Name</p>
                  <p className="font-medium">{launchName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="font-medium">{providerLabels[selectedProvider]}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Template</p>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{selectedTemplate.name}</p>
                    <Badge variant="outline">
                      {categoryLabels[selectedTemplate.category] || selectedTemplate.category}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cloud Account</p>
                  <p className="font-medium">{selectedCloudAccount.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Region</p>
                  <p className="font-mono text-sm font-medium">{region}</p>
                </div>
                {selectedTemplate.estimatedDuration && (
                  <div>
                    <p className="text-sm text-muted-foreground">Estimated Duration</p>
                    <p className="font-medium">{selectedTemplate.estimatedDuration}</p>
                  </div>
                )}
              </div>

              {Object.keys(parameters).length > 0 && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">Parameters</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(parameters).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-sm text-muted-foreground">
                          {key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim()}
                        </p>
                        <p className="font-mono text-sm">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => setStep(3)} disabled={isLaunching}>
              Back
            </Button>
            <Button onClick={handleLaunch} disabled={isLaunching}>
              {isLaunching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  {approvalRequired ? 'Submit for Approval' : 'Launch'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
