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
        className="bg-bg-300/80 rounded px-1 py-0.5 text-[13px] font-mono text-accent-secondary-000"
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
        className="text-base text-text-000 font-semibold mt-4 mb-1.5"
        {...rest}
      >
        {children}
      </h1>
    );
  },

  h2({ children, ...rest }) {
    return (
      <h2 className="text-sm text-text-000 font-semibold mt-3 mb-1" {...rest}>
        {children}
      </h2>
    );
  },

  h3({ children, ...rest }) {
    return (
      <h3 className="text-sm text-text-000 font-semibold mt-2.5 mb-1" {...rest}>
        {children}
      </h3>
    );
  },

  h4({ children, ...rest }) {
    return (
      <h4
        className="text-sm text-text-000 font-medium mt-2 mb-0.5"
        {...rest}
      >
        {children}
      </h4>
    );
  },

  h5({ children, ...rest }) {
    return (
      <h5 className="text-sm text-text-100 font-medium mt-2 mb-0.5" {...rest}>
        {children}
      </h5>
    );
  },

  h6({ children, ...rest }) {
    return (
      <h6 className="text-xs text-text-100 font-medium mt-2 mb-0.5" {...rest}>
        {children}
      </h6>
    );
  },

  p({ children, ...rest }) {
    return (
      <p className="text-text-100 text-sm leading-relaxed mb-2 last:mb-0" {...rest}>
        {children}
      </p>
    );
  },

  ul({ children, ...rest }) {
    return (
      <ul className="list-disc pl-5 space-y-0.5 mb-2 text-sm text-text-100" {...rest}>
        {children}
      </ul>
    );
  },

  ol({ children, ...rest }) {
    return (
      <ol
        className="list-decimal pl-5 space-y-0.5 mb-2 text-sm text-text-100"
        {...rest}
      >
        {children}
      </ol>
    );
  },

  li({ children, ...rest }) {
    return (
      <li className="text-sm text-text-100 leading-relaxed" {...rest}>
        {children}
      </li>
    );
  },

  blockquote({ children, ...rest }) {
    return (
      <blockquote
        className="border-l-2 border-text-500/30 pl-3 text-text-300 italic my-2"
        {...rest}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto my-2">
        <table
          className="w-full border-collapse text-sm font-mono"
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },

  thead({ children, ...rest }) {
    return (
      <thead className="bg-bg-200/60" {...rest}>
        {children}
      </thead>
    );
  },

  th({ children, ...rest }) {
    return (
      <th
        className="border border-border-300/20 px-2.5 py-1.5 text-[12px] text-text-200 font-semibold text-left"
        {...rest}
      >
        {children}
      </th>
    );
  },

  td({ children, ...rest }) {
    return (
      <td
        className="border border-border-300/20 px-2.5 py-1.5 text-[12px] text-text-300"
        {...rest}
      >
        {children}
      </td>
    );
  },

  hr({ ...rest }) {
    return (
      <hr className="border-t border-border-300/15 my-3" {...rest} />
    );
  },

  strong({ children, ...rest }) {
    return (
      <strong className="text-text-000 font-semibold" {...rest}>
        {children}
      </strong>
    );
  },

  em({ children, ...rest }) {
    return (
      <em className="text-text-200 italic" {...rest}>
        {children}
      </em>
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
