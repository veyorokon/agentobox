"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/shared/code-block";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const components: Components = {
  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const text = String(children).replace(/\n$/, "");

    // Fenced code blocks have a className with the language
    if (match) {
      return <CodeBlock code={text} language={match[1]} />;
    }

    // Inline code
    return (
      <code
        className="bg-bg-300 rounded px-1.5 py-0.5 text-sm font-mono text-accent-secondary-000"
        {...rest}
      >
        {children}
      </code>
    );
  },

  pre({ children }) {
    // Let CodeBlock handle the rendering — pre is just a passthrough
    return <>{children}</>;
  },

  a({ href, children, ...rest }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-secondary-100 hover:underline"
        {...rest}
      >
        {children}
      </a>
    );
  },

  h1({ children, ...rest }) {
    return (
      <h1
        className="text-2xl text-text-000 font-semibold mt-6 mb-3"
        {...rest}
      >
        {children}
      </h1>
    );
  },

  h2({ children, ...rest }) {
    return (
      <h2 className="text-xl text-text-000 font-semibold mt-5 mb-2" {...rest}>
        {children}
      </h2>
    );
  },

  h3({ children, ...rest }) {
    return (
      <h3 className="text-lg text-text-000 font-semibold mt-4 mb-2" {...rest}>
        {children}
      </h3>
    );
  },

  h4({ children, ...rest }) {
    return (
      <h4
        className="text-base text-text-000 font-semibold mt-3 mb-1"
        {...rest}
      >
        {children}
      </h4>
    );
  },

  h5({ children, ...rest }) {
    return (
      <h5 className="text-sm text-text-000 font-semibold mt-3 mb-1" {...rest}>
        {children}
      </h5>
    );
  },

  h6({ children, ...rest }) {
    return (
      <h6 className="text-xs text-text-000 font-semibold mt-3 mb-1" {...rest}>
        {children}
      </h6>
    );
  },

  p({ children, ...rest }) {
    return (
      <p className="text-text-100 leading-relaxed mb-3" {...rest}>
        {children}
      </p>
    );
  },

  ul({ children, ...rest }) {
    return (
      <ul className="list-disc pl-6 space-y-1 mb-3 text-text-100" {...rest}>
        {children}
      </ul>
    );
  },

  ol({ children, ...rest }) {
    return (
      <ol
        className="list-decimal pl-6 space-y-1 mb-3 text-text-100"
        {...rest}
      >
        {children}
      </ol>
    );
  },

  blockquote({ children, ...rest }) {
    return (
      <blockquote
        className="border-l-2 border-border-300 pl-4 text-text-300 italic my-3"
        {...rest}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto my-3">
        <table
          className="w-full border-collapse border border-border-300 text-sm"
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...rest }) {
    return (
      <th
        className="border border-border-300 px-3 py-2 text-sm text-text-000 font-semibold text-left bg-bg-200"
        {...rest}
      >
        {children}
      </th>
    );
  },

  td({ children, ...rest }) {
    return (
      <td
        className="border border-border-300 px-3 py-2 text-sm text-text-200"
        {...rest}
      >
        {children}
      </td>
    );
  },
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
