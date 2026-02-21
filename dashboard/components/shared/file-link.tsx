"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileLinkProps {
  path: string;
  line?: number;
  className?: string;
}

export function FileLink({ path, line, className }: FileLinkProps) {
  const filename = path.split("/").pop() ?? path;
  const display = line != null ? `${filename}:${line}` : filename;

  const handleClick = () => {
    // TODO: integrate with file navigation / editor opening
    console.log("FileLink clicked:", path, line);
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
      title={line != null ? `${path}:${line}` : path}
      className={cn(
        "text-accent-secondary-100 hover:underline cursor-pointer",
        "font-mono text-sm inline-flex items-center gap-1",
        className,
      )}
    >
      <FileText size={14} className="shrink-0" />
      {display}
    </span>
  );
}
