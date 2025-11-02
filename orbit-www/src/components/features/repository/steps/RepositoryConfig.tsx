'use client';

import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface RepositoryFormData {
  name: string;
  slug: string;
  description: string;
  visibility: 'private' | 'internal' | 'public';
  gitUrl?: string;
}

interface RepositoryConfigProps {
  form: UseFormReturn<RepositoryFormData>;
}

export function RepositoryConfig({ form }: RepositoryConfigProps) {
  const {
    register,
    formState: { errors },
    setValue,
    watch,
  } = form;

  // Auto-generate slug from name
  const name = watch('name');
  React.useEffect(() => {
    if (name) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setValue('slug', slug);
    }
  }, [name, setValue]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configure Repository</h2>
        <p className="text-muted-foreground">
          Provide details for your new repository
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Repository Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            placeholder="my-awesome-service"
            {...register('name', { required: 'Repository name is required' })}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">
            Slug <span className="text-muted-foreground text-xs">(auto-generated)</span>
          </Label>
          <Input id="slug" disabled {...register('slug')} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            placeholder="A brief description of this repository"
            rows={3}
            {...register('description')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            defaultValue="private"
            onValueChange={(value) => setValue('visibility', value as any)}
          >
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Private: Only workspace members • Internal: All authenticated users • Public:
            Everyone
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gitUrl">
            Git URL <span className="text-muted-foreground text-xs">(optional)</span>
          </Label>
          <Input
            id="gitUrl"
            placeholder="https://github.com/org/repo.git"
            {...register('gitUrl')}
          />
        </div>
      </div>
    </div>
  );
}
