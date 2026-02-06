import { timeAgo } from '@/lib/time';

interface ChatMessage {
  id: string;
  role: 'user' | 'agento';
  content: string;
  ts: string;
}

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div
          data-augmented-ui="tl-clip bl-clip border"
          className="max-w-[85%] px-3 py-2"
          style={{
            '--aug-tl': '8px',
            '--aug-bl': '8px',
            '--aug-border-all': '1px',
            '--aug-border-bg': 'var(--accent)',
            background: 'var(--agent-glow)',
          } as React.CSSProperties}
        >
          <p className="text-foreground text-sm leading-relaxed">
            {message.content}
          </p>
        </div>
        <span className="text-muted-foreground text-[10px] font-mono mr-1">
          {timeAgo(message.ts)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div
        data-augmented-ui="tr-clip br-clip border"
        className="max-w-[85%] px-3 py-2"
        style={{
          '--aug-tr': '8px',
          '--aug-br': '8px',
          '--aug-border-all': '1px',
          '--aug-border-bg': 'var(--border)',
        } as React.CSSProperties}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1">
          agento
        </p>
        <p className="text-foreground text-sm leading-relaxed">
          {message.content}
        </p>
      </div>
      <span className="text-muted-foreground text-[10px] font-mono ml-1">
        {timeAgo(message.ts)}
      </span>
    </div>
  );
}
