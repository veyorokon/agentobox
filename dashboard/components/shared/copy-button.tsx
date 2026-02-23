"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "p-1.5 rounded-md hover:bg-surface-raised/50 transition-colors",
        copied
          ? "text-success"
          : "text-muted hover:text-default",
        className,
      )}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
