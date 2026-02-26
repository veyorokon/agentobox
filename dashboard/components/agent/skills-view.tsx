"use client"

import { useState } from "react"
import {
  ChevronRight,
  Tag,
  BookOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Collapsible } from "@/components/ui/collapsible"
import { MarkdownRenderer } from "@/components/shared/markdown-renderer"
import { getAgentSkills } from "@/lib/data/mock"
import type { FakeAgent } from "@/lib/types"

export interface AgentSkillsViewProps {
  agent: FakeAgent
}

export function AgentSkillsView({ agent }: AgentSkillsViewProps) {
  const skills = getAgentSkills(agent)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Agent tags */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
          Tags
        </label>
        {agent.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[11px] font-mono text-accent"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted/50 font-mono">no tags</span>
        )}
      </div>

      {/* Inherited skills */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
          Inherited Skills
        </label>
        {skills.length === 0 ? (
          <div className="py-4 text-center rounded-md border border-border-subtle bg-surface-sunken/20">
            <BookOpen className="h-5 w-5 text-muted/20 mx-auto mb-1" />
            <p className="text-[11px] text-muted/50">No skills assigned via tags</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {skills.map((skill) => {
              const isExpanded = expandedSkill === skill.id
              const sourceTag = skill.assignedTags.find(t => agent.tags.includes(t))
              return (
                <div key={skill.id} className="rounded-md border border-border-subtle overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                    className="w-full text-left px-2.5 py-2 flex items-center gap-2 hover:bg-surface-sunken/30 transition-colors"
                  >
                    <ChevronRight
                      size={12}
                      className={cn(
                        "shrink-0 text-muted transition-transform duration-(--duration-normal)",
                        isExpanded && "rotate-90",
                      )}
                    />
                    <span className="text-xs font-medium text-default flex-1 min-w-0 truncate">
                      {skill.name}
                    </span>
                    {sourceTag && (
                      <span className="text-[9px] font-mono text-muted/60 shrink-0">
                        via {sourceTag}
                      </span>
                    )}
                    {skill.steps && (
                      <span className="text-[9px] font-mono text-info/60 shrink-0">
                        {skill.steps} steps
                      </span>
                    )}
                  </button>
                  <Collapsible open={isExpanded}>
                    <div className="px-2.5 pb-2.5 border-t border-border-subtle">
                      <MarkdownRenderer
                        content={skill.content}
                        className="text-xs text-secondary"
                      />
                    </div>
                  </Collapsible>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
