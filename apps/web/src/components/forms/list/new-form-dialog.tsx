'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateForm } from '@/hooks/use-forms';

export function NewFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const create = useCreateForm();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate(
      { title: trimmed, ...(description.trim() ? { description: description.trim() } : {}) },
      {
        onSuccess: (form) => {
          onOpenChange(false);
          setTitle('');
          setDescription('');
          router.push(`/form-builder/${form.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">New form</DialogTitle>
            <DialogDescription className="text-ink-muted text-sm">
              Name it now. You add the questions next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-form-title">Title</Label>
            <Input
              id="new-form-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-form-description">Description (optional)</Label>
            <Textarea
              id="new-form-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? 'Creating' : 'Create form'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
