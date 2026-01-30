'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight, Loader2, CheckCircle } from 'lucide-react'
import { BasicInfoStep, type APIFormData } from '@/components/features/api-catalog/wizard/BasicInfoStep'
import { SchemaContentStep } from '@/components/features/api-catalog/wizard/SchemaContentStep'
import { ReviewStep } from '@/components/features/api-catalog/wizard/ReviewStep'
import type { ValidationResult } from '@/lib/schema-validators'
import { createAPISchema } from '../actions'
import { toast } from 'sonner'

interface NewAPIClientProps {
  workspaceId: string
  workspaceSlug: string
  userId: string
}

type WizardStep = 'basic' | 'schema' | 'review'

const STEPS: WizardStep[] = ['basic', 'schema', 'review']

const STEP_NAMES: Record<WizardStep, string> = {
  basic: 'Basic Information',
  schema: 'OpenAPI Specification',
  review: 'Review & Create',
}

export function NewAPIClient({ workspaceId, workspaceSlug, userId }: NewAPIClientProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = React.useState<WizardStep>('basic')
  const [isCreating, setIsCreating] = React.useState(false)
  const [validation, setValidation] = React.useState<ValidationResult>({ valid: false, errors: [] })

  const form = useForm<APIFormData>({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      visibility: 'workspace',
      tags: [],
      rawContent: '',
      contactName: '',
      contactEmail: '',
    },
  })

  const currentStepIndex = STEPS.indexOf(currentStep)

  const handleNext = async () => {
    if (currentStep === 'basic') {
      const isValid = await form.trigger(['name', 'slug', 'visibility'])
      if (!isValid) {
        toast.error('Please fill in all required fields')
        return
      }
    }

    if (currentStep === 'schema') {
      if (!validation.valid) {
        toast.error('Please fix validation errors before continuing')
        return
      }
    }

    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const handleCreate = async () => {
    const formData = form.getValues()

    if (!formData.name || !formData.slug || !formData.rawContent) {
      toast.error('Missing required fields')
      return
    }

    setIsCreating(true)
    try {
      const result = await createAPISchema({
        name: formData.name,
        slug: formData.slug,
        description: formData.description,
        workspaceId,
        visibility: formData.visibility,
        rawContent: formData.rawContent,
        tags: formData.tags,
        contactName: formData.contactName,
        contactEmail: formData.contactEmail,
        userId,
      })

      toast.success('API created successfully')
      router.push(`/catalog/apis/${result.schemaId}`)
    } catch (error) {
      console.error('Failed to create API:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create API')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCancel = () => {
    router.push(`/workspaces/${workspaceSlug}/apis`)
  }

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((step, index) => (
          <React.Fragment key={step}>
            <div
              className={`flex items-center gap-2 ${
                index <= currentStepIndex ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  index < currentStepIndex
                    ? 'bg-primary text-primary-foreground'
                    : index === currentStepIndex
                      ? 'border-2 border-primary'
                      : 'border-2 border-muted'
                }`}
              >
                {index < currentStepIndex ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  index + 1
                )}
              </div>
              <span className="hidden sm:inline text-sm font-medium">{STEP_NAMES[step]}</span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-8 sm:w-16 ${
                  index < currentStepIndex ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[500px]">
        {currentStep === 'basic' && <BasicInfoStep form={form} />}
        {currentStep === 'schema' && (
          <SchemaContentStep
            form={form}
            validation={validation}
            onValidationChange={setValidation}
          />
        )}
        {currentStep === 'review' && <ReviewStep form={form} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div>
          {currentStep === 'basic' && (
            <Button variant="ghost" onClick={handleCancel} disabled={isCreating}>
              Cancel
            </Button>
          )}
          {currentStep !== 'basic' && (
            <Button variant="outline" onClick={handleBack} disabled={isCreating}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
        </div>

        <div>
          {currentStep !== 'review' ? (
            <Button onClick={handleNext} disabled={isCreating}>
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create API'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
