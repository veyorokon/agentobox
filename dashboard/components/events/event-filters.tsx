'use client';

import { useEventStore, useAgentStore } from '@/stores';
import { STATE_COLORS } from '@/lib/constants';
import type { AgentStatus } from '@/types';

interface EventFiltersProps {
  bentoId: string;
}

const STATUSES: AgentStatus[] = ['idle', 'working', 'completed', 'blocked', 'dead'];

export function EventFilters({ bentoId }: EventFiltersProps) {
  const agents = useAgentStore((s) => s.getAgentsForBento(bentoId));
  const filters = useEventStore((s) => s.filters);
  const setFilters = useEventStore((s) => s.setFilters);

  const toggleAgent = (agentName: string) => {
    const newAgents = filters.agents.includes(agentName)
      ? filters.agents.filter((a) => a !== agentName)
      : [...filters.agents, agentName];
    setFilters({ agents: newAgents });
  };

  const toggleState = (state: AgentStatus) => {
    const newStates = filters.states.includes(state)
      ? filters.states.filter((s) => s !== state)
      : [...filters.states, state];
    setFilters({ states: newStates });
  };

  const clearFilters = () => {
    setFilters({ agents: [], states: [] });
  };

  const hasFilters = filters.agents.length > 0 || filters.states.length > 0;

  return (
    <div className="bg-[#343d46] rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#c0c5ce]">Filters</h3>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-[#65737e] hover:text-[#c0c5ce] transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Agent Filters */}
      <div className="mb-4">
        <p className="text-xs text-[#65737e] mb-2">Agents</p>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => {
            const isSelected = filters.agents.includes(agent.name);
            return (
              <button
                key={agent.name}
                onClick={() => toggleAgent(agent.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-[#8fa1b3] text-[#2b303b]'
                    : 'bg-[#4f5b66] text-[#c0c5ce] hover:bg-[#65737e]'
                }`}
              >
                {agent.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* State Filters */}
      <div>
        <p className="text-xs text-[#65737e] mb-2">States</p>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((state) => {
            const colors = STATE_COLORS[state];
            const isSelected = filters.states.includes(state);
            return (
              <button
                key={state}
                onClick={() => toggleState(state)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-all ${
                  isSelected
                    ? `${colors.bg} text-[#2b303b]`
                    : 'bg-[#4f5b66] text-[#c0c5ce] hover:bg-[#65737e]'
                }`}
              >
                {state}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
