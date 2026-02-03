'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Agent } from '@/types';
import { BoxExpandable } from './box-expandable';
import { CreateBoxCard } from './create-box-card';

interface BoxGridProps {
  agents: Agent[];
  bentoId: string;
}

export function BoxGrid({ agents, bentoId }: BoxGridProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const handleToggle = (agentName: string) => {
    setExpandedAgent(expandedAgent === agentName ? null : agentName);
  };

  return (
    <>
      {/* Backdrop overlay when expanded */}
      <AnimatePresence>
        {expandedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setExpandedAgent(null)}
          />
        )}
      </AnimatePresence>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 p-2">
        {agents.map((agent) => (
          <BoxExpandable
            key={agent.name}
            agent={agent}
            bentoId={bentoId}
            isExpanded={expandedAgent === agent.name}
            onToggle={() => handleToggle(agent.name)}
          />
        ))}

        {/* Only show create card when nothing is expanded */}
        {!expandedAgent && <CreateBoxCard bentoId={bentoId} />}
      </div>
    </>
  );
}
