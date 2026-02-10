'use client';

import type { McpSelection } from './mcp-picker';

/** Skill templates — will be fetched from backend once skillTemplates query lands. */
const SKILL_TEMPLATES = [
  {
    id: 'webapp-testing',
    label: 'Web App Testing',
    description: 'End-to-end testing of web applications with Playwright',
    requiredMcps: ['playwright'],
  },
  {
    id: 'desktop-automation',
    label: 'Desktop Automation',
    description: 'GUI interaction via mouse, keyboard, and screenshots',
    requiredMcps: ['computer-use'],
  },
  {
    id: 'full-stack-qa',
    label: 'Full-Stack QA',
    description: 'Complete QA with browser testing and desktop verification',
    requiredMcps: ['playwright', 'computer-use'],
  },
] as const;

export interface SkillSelection {
  id: string;
  label: string;
  description: string;
  requiredMcps: readonly string[];
}

/**
 * McpDependencyResolver — when skills are toggled, this resolves which MCP
 * servers need to be auto-selected/deselected.
 */
export function resolveSkillMcpDeps(
  selectedSkills: SkillSelection[],
  currentMcps: McpSelection[],
): McpSelection[] {
  // Collect all MCP IDs required by any selected skill
  const requiredIds = new Map<string, string[]>();
  for (const skill of selectedSkills) {
    for (const mcpId of skill.requiredMcps) {
      const list = requiredIds.get(mcpId) ?? [];
      list.push(skill.label);
      requiredIds.set(mcpId, list);
    }
  }

  // Registry MCPs for lookup
  const REGISTRY: Record<string, { label: string; description: string; transport: string }> = {
    'computer-use': { label: 'Computer Use', description: 'Mouse, keyboard, and screenshot control', transport: 'stdio' },
    'playwright': { label: 'Playwright', description: 'Browser automation and testing', transport: 'stdio' },
  };

  // Start with current MCPs — update requiredBy tags
  const result: McpSelection[] = currentMcps.map((mcp) => {
    const skills = requiredIds.get(mcp.id);
    if (skills) {
      return { ...mcp, requiredBy: skills.join(', ') };
    }
    // Remove stale requiredBy if skill was deselected
    if (mcp.requiredBy) {
      return { ...mcp, requiredBy: undefined };
    }
    return mcp;
  });

  // Add missing required MCPs
  const existingIds = new Set(result.map((m) => m.id));
  for (const [mcpId, skills] of requiredIds) {
    if (!existingIds.has(mcpId)) {
      const reg = REGISTRY[mcpId];
      if (reg) {
        result.push({
          id: mcpId,
          label: reg.label,
          description: reg.description,
          transport: reg.transport,
          requiredBy: skills.join(', '),
        });
      }
    }
  }

  return result;
}

export function SkillPicker({
  selected,
  onChange,
}: {
  selected: SkillSelection[];
  onChange: (skills: SkillSelection[]) => void;
}) {
  const selectedIds = new Set(selected.map((s) => s.id));

  const toggle = (skill: typeof SKILL_TEMPLATES[number]) => {
    if (selectedIds.has(skill.id)) {
      onChange(selected.filter((s) => s.id !== skill.id));
    } else {
      onChange([...selected, { ...skill }]);
    }
  };

  return (
    <div className="space-y-2">
      {SKILL_TEMPLATES.map((skill) => {
        const isSelected = selectedIds.has(skill.id);

        return (
          <label
            key={skill.id}
            className="flex items-start gap-3 cursor-pointer group"
          >
            <div
              data-augmented-ui="tl-clip br-clip border"
              className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                '--aug-tl': '4px',
                '--aug-br': '4px',
                '--aug-border-all': '1px',
                '--aug-border-bg': isSelected ? 'var(--accent)' : 'var(--border)',
                background: isSelected ? 'var(--accent)' : 'transparent',
              } as React.CSSProperties}
              onClick={() => toggle(skill)}
            >
              {isSelected && (
                <span className="text-accent-foreground text-[10px] font-bold">&#10003;</span>
              )}
            </div>
            <div className="flex-1 min-w-0" onClick={() => toggle(skill)}>
              <span className="text-foreground font-mono text-sm block">{skill.label}</span>
              <span className="text-muted-foreground text-[10px] block">{skill.description}</span>
              {skill.requiredMcps.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">Requires:</span>
                  {skill.requiredMcps.map((mcpId) => (
                    <span
                      key={mcpId}
                      className="text-[9px] font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded"
                    >
                      {mcpId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
