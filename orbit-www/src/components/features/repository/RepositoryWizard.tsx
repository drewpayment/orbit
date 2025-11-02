'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { TemplateSelect, TemplateType } from './steps/TemplateSelect';
import { RepositoryConfig, RepositoryFormData } from './steps/RepositoryConfig';
import { Review } from './steps/Review';
import { repositoryClient } from '@/lib/grpc/repository-client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

interface RepositoryWizardProps {
  workspaceId: string;
  onComplete: (repositoryId: string) => void;
}

type WizardStep = 'template' | 'config' | 'review';

export function RepositoryWizard({ workspaceId, onComplete }: RepositoryWizardProps) {
  const [currentStep, setCurrentStep] = React.useState<WizardStep>('template');
  const [selectedTemplate, setSelectedTemplate] = React.useState<TemplateType | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const form = useForm<RepositoryFormData>({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      visibility: 'private',
      gitUrl: '',
    },
  });

  const handleNext = async () => {
    if (currentStep === 'template' && !selectedTemplate) {
      toast.error('Please select a template');
      return;
    }

    if (currentStep === 'config') {
      const isValid = await form.trigger();
      if (!isValid) return;
    }

    const steps: WizardStep[] = ['template', 'config', 'review'];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: WizardStep[] = ['template', 'config', 'review'];
    const currentIndex = steps.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1]);
    }
  };

  const handleCreate = async () => {
    const formData = form.getValues();

    setIsCreating(true);
    try {
      const response = await repositoryClient.createRepository({
        workspaceId,
        name: formData.name,
        slug: formData.slug,
        description: formData.description,
        visibility: formData.visibility,
        templateType: selectedTemplate!,
        gitUrl: formData.gitUrl || undefined,
      });

      toast.success('Repository created successfully');
      onComplete(response.repository!.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  const steps: WizardStep[] = ['template', 'config', 'review'];
  const stepNames = {
    template: 'Select Template',
    config: 'Configure Repository',
    review: 'Review & Create',
  };
  const currentStepIndex = steps.indexOf(currentStep);
  const totalSteps = steps.length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-2"
          role="progressbar"
          aria-valuenow={currentStepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Step ${currentStepIndex + 1} of ${totalSteps}: ${stepNames[currentStep]}`}
        >
          <div
            className={`h-2 w-24 rounded ${currentStep === 'template' ? 'bg-primary' : 'bg-muted'}`}
            aria-label="Step 1: Select Template"
          />
          <div
            className={`h-2 w-24 rounded ${currentStep === 'config' ? 'bg-primary' : 'bg-muted'}`}
            aria-label="Step 2: Configure Repository"
          />
          <div
            className={`h-2 w-24 rounded ${currentStep === 'review' ? 'bg-primary' : 'bg-muted'}`}
            aria-label="Step 3: Review & Create"
          />
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {currentStep === 'template' && (
          <TemplateSelect
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplate}
          />
        )}

        {currentStep === 'config' && (
          <RepositoryConfig form={form} />
        )}

        {currentStep === 'review' && (
          <Review template={selectedTemplate!} formData={form.getValues()} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 'template' || isCreating}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {currentStep !== 'review' ? (
          <Button onClick={handleNext} disabled={isCreating}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Repository
          </Button>
        )}
      </div>
    </div>
  );
}
