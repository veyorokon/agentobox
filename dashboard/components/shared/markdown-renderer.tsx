"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn, stripSystemReminders } from "@/lib/utils";
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
        className="bg-bg-100/50 border border-border-300 text-danger-000 rounded-[0.4rem] px-1 py-px font-mono text-[13px]"
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
      <ul className="list-disc list-outside ml-6 space-y-1 mb-2 text-sm text-text-100" {...rest}>
        {children}
      </ul>
    );
  },

  ol({ children, ...rest }) {
    return (
      <ol
        className="list-decimal list-outside ml-6 space-y-1 mb-2 text-sm text-text-100"
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
        className="border-l-4 border-border-400 pl-4 italic mb-2"
        {...rest}
      >
        {children}
      </blockquote>
    );
  },

  table({ children, ...rest }) {
    return (
      <div className="overflow-x-auto mb-2 rounded border border-border-300">
        <table
          className="min-w-full border-collapse text-sm"
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },

  thead({ children, ...rest }) {
    return (
      <thead className="bg-bg-200 border-b border-border-300" {...rest}>
        {children}
      </thead>
    );
  },

  tr({ children, ...rest }) {
    return (
      <tr className="border-b border-border-300 last:border-b-0" {...rest}>
        {children}
      </tr>
    );
  },

  th({ children, ...rest }) {
    return (
      <th
        className="px-3 py-2 text-left font-semibold text-text-200 border-r border-border-300 last:border-r-0"
        {...rest}
      >
        {children}
      </th>
    );
  },

  td({ children, ...rest }) {
    return (
      <td
        className="px-3 py-2 text-text-300 border-r border-border-300 last:border-r-0"
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
  // Defense-in-depth: strip system-reminder tags that may leak from agent events
  const cleaned = stripSystemReminders(content);

  return (
    <div className={cn("prose-none space-y-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
