'use client';

import { useState } from 'react';
import { useBentoStore } from '@/stores';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreateBentoModalProps {
  trigger?: React.ReactNode;
}

export function CreateBentoModal({ trigger }: CreateBentoModalProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const createBento = useBentoStore((s) => s.createBento);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      createBento(name.trim());
      setName('');
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="bg-[#343d46] hover:bg-[#4f5b66] text-[#c0c5ce] rounded-full px-5">
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Bento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="bg-[#343d46] border-[#4f5b66] text-[#c0c5ce]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#c0c5ce]">Create New Bento</DialogTitle>
            <DialogDescription className="text-[#65737e]">
              A bento is a workspace for orchestrating AI agents on a specific project.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <Label htmlFor="name" className="text-sm font-medium text-[#c0c5ce]">
              Project Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Website Redesign"
              className="mt-2 bg-transparent border-[#4f5b66] text-white placeholder:text-[#65737e] focus:border-[#c0c5ce] focus:ring-0 rounded-lg"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="text-[#65737e] hover:text-[#c0c5ce] hover:bg-[#4f5b66]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim()}
              className="bg-[#e59758] hover:bg-[#ebcb8b] text-[#2b303b] font-semibold disabled:opacity-50"
            >
              Create Bento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
