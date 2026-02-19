'use client';

import { useCallback } from 'react';
import { useMutation } from 'urql';
import { toast } from 'sonner';
import {
  BROADCAST_MESSAGE_MUTATION,
  RESTART_AGENT_MUTATION,
  HARD_RESTART_AGENT_MUTATION,
  CLEAR_AGENT_SESSION_MUTATION,
  KILL_AGENT_MUTATION,
  REMOVE_AGENT_MUTATION,
  ANSWER_QUESTION_MUTATION,
  UPDATE_AGENT_INSTRUCTIONS_MUTATION,
  UPDATE_AGENT_CONFIG_MUTATION,
} from '@/lib/graphql/mutations';
import type { ContentBlock } from '@/components/v2/composer';

export function useAgentActions() {
  const [, executeBroadcast] = useMutation(BROADCAST_MESSAGE_MUTATION);
  const [, executeRestart] = useMutation(RESTART_AGENT_MUTATION);
  const [, executeHardRestart] = useMutation(HARD_RESTART_AGENT_MUTATION);
  const [, executeClearSession] = useMutation(CLEAR_AGENT_SESSION_MUTATION);
  const [, executeKill] = useMutation(KILL_AGENT_MUTATION);
  const [, executeRemove] = useMutation(REMOVE_AGENT_MUTATION);
  const [, executeAnswerQuestion] = useMutation(ANSWER_QUESTION_MUTATION);
  const [, executeUpdateInstructions] = useMutation(UPDATE_AGENT_INSTRUCTIONS_MUTATION);
  const [, executeUpdateConfig] = useMutation(UPDATE_AGENT_CONFIG_MUTATION);

  const restartAgent = useCallback(
    (agentId: string) => {
      executeRestart({ agentId });
      toast.success('Restarting...');
    },
    [executeRestart]
  );

  const hardRestartAgent = useCallback(
    (agentId: string) => {
      executeHardRestart({ agentId });
      toast.success('Restarting...');
    },
    [executeHardRestart]
  );

  const startAgent = useCallback(
    (agentId: string) => {
      executeHardRestart({ agentId });
      toast.success('Starting...');
    },
    [executeHardRestart]
  );

  const clearAgentSession = useCallback(
    (agentId: string) => {
      executeClearSession({ agentId });
      toast.success('Session cleared');
    },
    [executeClearSession]
  );

  const killAgent = useCallback(
    (agentId: string) => {
      executeKill({ agentId });
      toast.success('Stopping agent...');
    },
    [executeKill]
  );

  const removeAgent = useCallback(
    (agentId: string) => {
      executeRemove({ agentId });
      toast.success('Agent removed');
    },
    [executeRemove]
  );

  const sendMessage = useCallback(
    (agentIds: string[], content: ContentBlock[]) => {
      const textBlock = content.find(
        (b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text'
      );
      const message = textBlock?.text ?? '';

      const hasImages = content.some((b) => b.type === 'image');
      const input = hasImages
        ? { agentIds, message, content }
        : { agentIds, message };

      executeBroadcast({ input });
    },
    [executeBroadcast]
  );

  const answerQuestion = useCallback(
    (agentId: string, toolUseId: string, answerText: string) => {
      executeAnswerQuestion({ input: { agentId, toolUseId, answerText } });
    },
    [executeAnswerQuestion]
  );

  const updateInstructions = useCallback(
    (agentId: string, instructions: string) => {
      executeUpdateInstructions({ input: { agentId, instructions } });
      toast.success('Instructions saved');
    },
    [executeUpdateInstructions]
  );

  const updateAgentConfig = useCallback(
    async (agentId: string, config: {
      model?: string;
      role?: string;
      mcpRegistryNames?: string[];
      mcpCustomServers?: Record<string, { url: string }>;
    }) => {
      const { error } = await executeUpdateConfig({
        input: { agentId, ...config },
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Restarting with new config...');
      }
    },
    [executeUpdateConfig]
  );

  return {
    restartAgent,
    hardRestartAgent,
    startAgent,
    clearAgentSession,
    killAgent,
    removeAgent,
    sendMessage,
    answerQuestion,
    updateInstructions,
    updateAgentConfig,
  };
}
