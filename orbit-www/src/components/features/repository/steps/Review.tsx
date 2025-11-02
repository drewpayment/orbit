'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RepositoryFormData } from './RepositoryConfig';
import { TemplateType } from './TemplateSelect';

interface ReviewProps {
  template: TemplateType;
  formData: RepositoryFormData;
}

export function Review({ template, formData }: ReviewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Review & Create</h2>
        <p className="text-muted-foreground">
          Review your repository configuration before creating
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Repository Details</CardTitle>
          <CardDescription>Configuration summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Template Type</p>
            <p className="text-lg capitalize">{template}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p className="text-lg">{formData.name}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">Slug</p>
            <p className="font-mono text-lg">{formData.slug}</p>
          </div>

          {formData.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-lg">{formData.description}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-muted-foreground">Visibility</p>
            <Badge variant="outline" className="capitalize">
              {formData.visibility}
            </Badge>
          </div>

          {formData.gitUrl && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Git URL</p>
              <p className="font-mono text-sm">{formData.gitUrl}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
