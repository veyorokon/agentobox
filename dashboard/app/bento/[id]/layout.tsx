'use client';

import React, { useEffect, useState } from 'react';
import { useBentoStore } from '@/stores';
import { AgentoChat } from '@/components/agento/agento-chat';

interface BentoLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default function BentoLayout({ children, params }: BentoLayoutProps) {
  const [id, setId] = useState<string | null>(null);
  const setCurrentBento = useBentoStore((s) => s.setCurrentBento);

  useEffect(() => {
    params.then(({ id: bentoId }) => {
      setId(bentoId);
      setCurrentBento(bentoId);
    });
  }, [params, setCurrentBento]);

  if (!id) {
    return (
      <div className="min-h-screen bg-[#2b303b] flex items-center justify-center">
        <div className="text-[#65737e]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b303b] flex">
      <AgentoChat bentoId={id} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
