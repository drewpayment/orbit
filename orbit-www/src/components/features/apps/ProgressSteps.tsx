'use client'

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

interface ProgressStepsProps {
  currentStep: string
  stepsTotal: number
  stepsCurrent: number
  message: string
  status: string
}

const STEP_NAMES = [
  'Initializing',
  'Validating',
  'Preparing',
  'Generating',
  'Finalizing',
]

export function ProgressSteps({
  currentStep,
  stepsTotal,
  stepsCurrent,
  message,
  status,
}: ProgressStepsProps) {
  const progressPercent = stepsTotal > 0 ? (stepsCurrent / stepsTotal) * 100 : 0
  const isComplete = status === 'generated' || status === 'deployed'
  const isFailed = status === 'failed'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Step {stepsCurrent} of {stepsTotal}: {message}
        </span>
        <span className="text-sm text-muted-foreground">{Math.round(progressPercent)}%</span>
      </div>

      <Progress value={progressPercent} className="h-2" />

      <div className="flex flex-col gap-2">
        {STEP_NAMES.slice(0, stepsTotal).map((step, index) => {
          const stepNum = index + 1
          const isCurrentStep = stepNum === stepsCurrent
          const isCompleted = stepNum < stepsCurrent || isComplete

          return (
            <div key={step} className="flex items-center gap-2 text-sm">
              {isCompleted ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : isCurrentStep ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <Circle className="h-4 w-4 text-gray-300" />
              )}
              <span className={isCompleted ? 'text-muted-foreground' : ''}>
                {step}
              </span>
            </div>
          )
        })}
      </div>

      {isFailed && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          Deployment failed. Check the error details below.
        </div>
      )}
    </div>
  )
}
