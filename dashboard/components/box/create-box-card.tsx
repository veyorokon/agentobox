'use client';

import { useState } from 'react';
import { useAgentStore } from '@/stores';
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
import { Plus } from 'lucide-react';

interface CreateBoxCardProps {
  bentoId: string;
}

export function CreateBoxCard({ bentoId }: CreateBoxCardProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const createAgent = useAgentStore((s) => s.createAgent);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      const agentName = name.trim().toLowerCase().replace(/\s+/g, '-');
      createAgent(bentoId, agentName);
      setName('');
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="min-h-[300px] border-2 border-dashed border-[#4f5b66] bg-[#2b303b] rounded-3xl flex flex-col items-center justify-center gap-3 hover:border-[#e59758] transition-all cursor-pointer group"
          style={{
            boxShadow: '0 4px 20px rgba(0,0,0,0.3), 0 0 0 1px rgba(79,91,102,0.1)',
          }}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#4f5b66] flex items-center justify-center group-hover:bg-[#e59758] transition-colors shadow-lg">
            <Plus className="w-7 h-7 text-[#65737e] group-hover:text-[#2b303b]" />
          </div>
          <span className="text-base font-bold text-[#65737e] group-hover:text-[#e59758]">
            Add Agent
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#343d46] border-[#4f5b66] text-[#c0c5ce]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[#c0c5ce]">Create New Agent</DialogTitle>
            <DialogDescription className="text-[#65737e]">
              Add a new AI agent to this bento. Give it a descriptive name.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <Label htmlFor="agent-name" className="text-sm font-medium text-[#c0c5ce]">
              Agent Name
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Data Analyst"
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
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
