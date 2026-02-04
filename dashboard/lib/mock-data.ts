import type { Bento, Agent, AgentEvent, ChatMessage, AgentStatus } from '@/types';

// Helper to generate timestamps relative to now
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// Mock Bentos
export const mockBentos: Bento[] = [
  {
    id: 'bento-1',
    name: 'Website Redesign',
    agents: [],
    agentoOnline: true,
    lastActivity: minutesAgo(5),
  },
  {
    id: 'bento-2',
    name: 'Competitor Research',
    agents: [],
    agentoOnline: true,
    lastActivity: minutesAgo(12),
  },
  {
    id: 'bento-3',
    name: 'Data Migration',
    agents: [],
    agentoOnline: false,
    lastActivity: minutesAgo(120),
  },
];

// Mock Agents per Bento
export const mockAgents: Record<string, Agent[]> = {
  'bento-1': [
    {
      name: 'scout',
      status: 'working',
      message: 'browsing competitor websites',
      createdAt: minutesAgo(45),
      lastActivity: minutesAgo(2),
      vncUrl: 'https://localhost:6902',
    },
    {
      name: 'researcher',
      status: 'completed',
      message: '',
      createdAt: minutesAgo(60),
      lastActivity: minutesAgo(15),
    },
    {
      name: 'writer',
      status: 'idle',
      message: 'waiting for content brief',
      createdAt: minutesAgo(30),
      lastActivity: minutesAgo(20),
    },
    {
      name: 'deployer',
      status: 'blocked',
      message: 'waiting for AWS credentials',
      createdAt: minutesAgo(35),
      lastActivity: minutesAgo(10),
    },
    {
      name: 'auditor',
      status: 'dead',
      message: 'process killed — out of memory',
      createdAt: minutesAgo(50),
      lastActivity: minutesAgo(25),
    },
  ],
  'bento-2': [
    {
      name: 'analyst',
      status: 'blocked',
      message: 'need login credentials for LinkedIn',
      createdAt: minutesAgo(25),
      lastActivity: minutesAgo(8),
    },
    {
      name: 'scraper',
      status: 'working',
      message: 'extracting pricing data from ProductHunt',
      createdAt: minutesAgo(20),
      lastActivity: minutesAgo(1),
    },
  ],
  'bento-3': [
    {
      name: 'extractor',
      status: 'completed',
      message: '',
      createdAt: minutesAgo(180),
      lastActivity: minutesAgo(90),
    },
    {
      name: 'validator',
      status: 'completed',
      message: '',
      createdAt: minutesAgo(150),
      lastActivity: minutesAgo(85),
    },
    {
      name: 'loader',
      status: 'completed',
      message: '',
      createdAt: minutesAgo(120),
      lastActivity: minutesAgo(80),
    },
  ],
};

// Mock Events
export const mockEvents: Record<string, AgentEvent[]> = {
  'bento-1': [
    { ts: minutesAgo(2), agent: 'scout', state: 'working', msg: 'browsing competitor websites' },
    { ts: minutesAgo(5), agent: 'designer', state: 'working', msg: 'creating wireframes in Figma' },
    { ts: minutesAgo(8), agent: 'scout', state: 'working', msg: 'analyzing color schemes' },
    { ts: minutesAgo(15), agent: 'researcher', state: 'completed', msg: '' },
    { ts: minutesAgo(18), agent: 'researcher', state: 'working', msg: 'compiling research notes' },
    { ts: minutesAgo(20), agent: 'writer', state: 'idle', msg: 'waiting for content brief' },
    { ts: minutesAgo(25), agent: 'designer', state: 'working', msg: 'reviewing brand guidelines' },
    { ts: minutesAgo(30), agent: 'writer', state: 'completed', msg: '' },
    { ts: minutesAgo(35), agent: 'writer', state: 'working', msg: 'drafting homepage copy' },
    { ts: minutesAgo(40), agent: 'designer', state: 'idle', msg: 'ready for next task' },
  ],
  'bento-2': [
    { ts: minutesAgo(1), agent: 'scraper', state: 'working', msg: 'extracting pricing data from ProductHunt' },
    { ts: minutesAgo(5), agent: 'scraper', state: 'working', msg: 'navigating to pricing page' },
    { ts: minutesAgo(8), agent: 'analyst', state: 'blocked', msg: 'need login credentials for LinkedIn' },
    { ts: minutesAgo(10), agent: 'analyst', state: 'working', msg: 'attempting LinkedIn login' },
    { ts: minutesAgo(15), agent: 'scraper', state: 'idle', msg: 'waiting for URLs' },
    { ts: minutesAgo(20), agent: 'analyst', state: 'working', msg: 'gathering competitor profiles' },
  ],
  'bento-3': [
    { ts: minutesAgo(80), agent: 'loader', state: 'completed', msg: '' },
    { ts: minutesAgo(82), agent: 'loader', state: 'working', msg: 'inserting batch 5/5' },
    { ts: minutesAgo(85), agent: 'validator', state: 'completed', msg: '' },
    { ts: minutesAgo(88), agent: 'validator', state: 'working', msg: 'validating data integrity' },
    { ts: minutesAgo(90), agent: 'extractor', state: 'completed', msg: '' },
    { ts: minutesAgo(95), agent: 'extractor', state: 'working', msg: 'exporting final CSV' },
  ],
};

// Mock Chat Messages
export const mockChat: Record<string, ChatMessage[]> = {
  'bento-1': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Start researching competitor websites for the redesign project',
      ts: minutesAgo(50),
    },
    {
      id: 'msg-2',
      role: 'agento',
      content: "I've created 4 agents: scout, designer, researcher, and writer. Scout is now browsing competitor websites to gather design inspiration.",
      ts: minutesAgo(48),
    },
    {
      id: 'msg-3',
      role: 'user',
      content: 'Focus on SaaS landing pages specifically',
      ts: minutesAgo(35),
    },
    {
      id: 'msg-4',
      role: 'agento',
      content: "Got it. I've directed scout to focus on SaaS landing pages. Designer is now reviewing the gathered materials and starting wireframes.",
      ts: minutesAgo(33),
    },
    {
      id: 'msg-5',
      role: 'user',
      content: 'How is the progress?',
      ts: minutesAgo(10),
    },
    {
      id: 'msg-6',
      role: 'agento',
      content: 'Good progress! Researcher has completed their task. Scout and designer are actively working. Writer is idle, waiting for the content brief once we finalize the direction.',
      ts: minutesAgo(8),
    },
  ],
  'bento-2': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Research our top 3 competitors and their pricing',
      ts: minutesAgo(30),
    },
    {
      id: 'msg-2',
      role: 'agento',
      content: "I've deployed analyst and scraper. They're gathering competitive intelligence now.",
      ts: minutesAgo(28),
    },
    {
      id: 'msg-3',
      role: 'agento',
      content: "Heads up: analyst is blocked - they need LinkedIn credentials to access some competitor profiles. Can you provide login details?",
      ts: minutesAgo(8),
    },
  ],
  'bento-3': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Migrate data from the old PostgreSQL database to the new schema',
      ts: minutesAgo(200),
    },
    {
      id: 'msg-2',
      role: 'agento',
      content: "Created extractor, validator, and loader agents. Starting the migration pipeline.",
      ts: minutesAgo(195),
    },
    {
      id: 'msg-3',
      role: 'agento',
      content: "Migration complete! All 3 agents have finished their tasks. 50,000 records migrated successfully with 100% data integrity.",
      ts: minutesAgo(75),
    },
  ],
};

// Helper to count agents by status
export function countAgentsByStatus(agents: Agent[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = {
    idle: 0,
    working: 0,
    completed: 0,
    blocked: 0,
    dead: 0,
  };

  for (const agent of agents) {
    counts[agent.status]++;
  }

  return counts;
}

// Helper to format status summary
export function formatStatusSummary(agents: Agent[]): string {
  const counts = countAgentsByStatus(agents);
  const parts: string[] = [];

  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  if (counts.idle > 0) parts.push(`${counts.idle} idle`);
  if (counts.dead > 0) parts.push(`${counts.dead} dead`);

  return parts.join(', ') || 'No agents';
}

// Helper to format relative time
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Helper to format timestamp for event feed
export function formatEventTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
