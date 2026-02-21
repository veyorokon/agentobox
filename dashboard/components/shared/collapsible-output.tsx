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
          "whitespace-pre-wrap font-mono text-sm text-text-200",
          className,
        )}
      >
        {content}
      </pre>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <pre
        className={cn(
          "whitespace-pre-wrap font-mono text-sm text-text-200 overflow-hidden transition-all",
          !expanded && "[mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]",
        )}
        style={!expanded ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {content}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-xs text-accent-secondary-100 hover:underline cursor-pointer mt-1"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
