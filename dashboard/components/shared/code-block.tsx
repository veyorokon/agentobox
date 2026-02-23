"use client";

import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/shared/copy-button";

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

// Module-level singleton so the highlighter is created once across all instances
let highlighterPromise: Promise<Awaited<
  ReturnType<typeof import("shiki")["createHighlighter"]>
>> | null = null;

function getHighlighterSingleton() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((mod) =>
      mod.createHighlighter({
        themes: ["vitesse-dark"],
        langs: [
          "javascript",
          "typescript",
          "python",
          "bash",
          "json",
          "html",
          "css",
          "yaml",
          "markdown",
          "tsx",
          "jsx",
          "graphql",
          "sql",
          "diff",
          "shell",
          "dockerfile",
        ],
      }),
    );
  }
  return highlighterPromise;
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
}: CodeBlockProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const highlighter = await getHighlighterSingleton();
        const loadedLangs = highlighter.getLoadedLanguages();
        const lang =
          language && loadedLangs.includes(language) ? language : "text";

        const html = highlighter.codeToHtml(code.trim(), {
          lang,
          theme: "vitesse-dark",
        });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        // Fallback stays as plain text
      }
    }

    highlight();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const trimmedCode = code.trim();

  return (
    <div
      ref={containerRef}
      className="relative group !my-3 border-[0.5px] border-border-default bg-surface/50 rounded-lg overflow-hidden"
    >
      {language ? (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-default text-xs text-muted">
          <span>{language}</span>
          <CopyButton
            text={trimmedCode}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      ) : (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <CopyButton text={trimmedCode} />
        </div>
      )}

      {highlightedHtml ? (
        <div
          className={cn(
            "p-4 overflow-x-auto text-sm font-mono leading-relaxed",
            "[&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0",
            "[&_code]:!bg-transparent",
            showLineNumbers && "[&_.line]:before:content-[counter(line)] [&_.line]:before:counter-increment-[line] [&_.line]:before:mr-4 [&_.line]:before:text-muted/50 [&_.line]:before:text-right [&_.line]:before:inline-block [&_.line]:before:w-8 [&_pre]:counter-reset-[line]",
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="p-4 overflow-x-auto text-sm font-mono leading-relaxed text-secondary">
          <code>{trimmedCode}</code>
        </pre>
      )}
    </div>
  );
}
