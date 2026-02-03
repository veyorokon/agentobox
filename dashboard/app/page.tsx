'use client';

import { useBentoStore } from '@/stores';
import { Nav } from '@/components/layout/nav';
import { BentoList } from '@/components/bento/bento-list';
import { CreateBentoModal } from '@/components/bento/create-bento-modal';

export default function BentoListPage() {
  const bentos = useBentoStore((s) => s.bentos);

  return (
    <div className="min-h-screen bg-[#2b303b]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Nav />
          <CreateBentoModal />
        </div>

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#c0c5ce] mb-2">Your Bentos</h1>
          <p className="text-[#65737e]">
            Orchestrate AI agents across your projects
          </p>
        </div>

        {/* Bento Grid */}
        <BentoList bentos={bentos} />
      </div>
    </div>
  );
}
