'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileCode, Globe, Smartphone, BookOpen } from 'lucide-react';

export type TemplateType = 'service' | 'library' | 'frontend' | 'mobile' | 'documentation';

interface Template {
  type: TemplateType;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const templates: Template[] = [
  {
    type: 'service',
    name: 'Microservice',
    description: 'Go-based gRPC microservice with Temporal workflows',
    icon: <FileCode className="h-8 w-8" />,
  },
  {
    type: 'library',
    name: 'Shared Library',
    description: 'Reusable Go library or TypeScript package',
    icon: <Globe className="h-8 w-8" />,
  },
  {
    type: 'frontend',
    name: 'Frontend Application',
    description: 'Next.js application with Payload CMS',
    icon: <Globe className="h-8 w-8" />,
  },
  {
    type: 'mobile',
    name: 'Mobile App',
    description: 'React Native mobile application',
    icon: <Smartphone className="h-8 w-8" />,
  },
  {
    type: 'documentation',
    name: 'Documentation Site',
    description: 'Documentation site with search and versioning',
    icon: <BookOpen className="h-8 w-8" />,
  },
];

interface TemplateSelectProps {
  selectedTemplate: TemplateType | null;
  onSelect: (template: TemplateType) => void;
}

export function TemplateSelect({ selectedTemplate, onSelect }: TemplateSelectProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Select Template</h2>
        <p className="text-muted-foreground">
          Choose a repository template to get started quickly
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <Card
            key={template.type}
            data-testid={`template-${template.type}`}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedTemplate === template.type
                ? 'border-primary ring-2 ring-primary'
                : ''
            }`}
            onClick={() => onSelect(template.type)}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                {template.icon}
                <CardTitle>{template.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>{template.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
