'use client';

interface UserBubbleProps {
  text: string;
}

export function UserBubble({ text }: UserBubbleProps) {
  const hasText = text.trim().length > 0;

  return (
    <div
      className="flex justify-end"
      style={{ animation: 'msg-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      <div className="max-w-[85%]">
        {hasText && (
          <p className="text-foreground/80 text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-right">
            {text}
          </p>
        )}
      </div>
    </div>
  );
}
