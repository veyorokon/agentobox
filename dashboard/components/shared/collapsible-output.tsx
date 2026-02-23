"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleOutputProps {
  content: string;
  maxHeight?: number;
  className?: string;
}

const COLLAPSE_THRESHOLD = 300;

export function CollapsibleOutput({
  content,
  maxHeight = 100,
  className,
}: CollapsibleOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > COLLAPSE_THRESHOLD;

  if (!isLong) {
    return (
      <pre
        className={cn(
          "whitespace-pre-wrap font-mono text-sm text-secondary leading-relaxed",
          className,
        )}
      >
        {content}
      </pre>
    );
  }

  return (
    <div>
      <pre
        className={cn(
          "whitespace-pre-wrap font-mono text-sm text-secondary leading-relaxed overflow-hidden transition-all",
          !expanded && "[mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]",
          className,
        )}
        style={!expanded ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {content}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-[11px] text-info-hover hover:text-info cursor-pointer mt-0.5 font-mono"
      >
        {expanded ? "show less" : "show more"}
      </button>
    </div>
  );
}
