interface ActionButtonPairProps {
  onPositive: () => void
  onNegative: () => void
  positiveLabel?: string
  negativeLabel?: string
  onTertiary?: () => void
  tertiaryLabel?: string
  compact?: boolean
}

export function ActionButtonPair({
  onPositive,
  onNegative,
  positiveLabel = "Allow",
  negativeLabel = "Deny",
  onTertiary,
  tertiaryLabel,
  compact = false,
}: ActionButtonPairProps) {
  const size = compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-xs"

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPositive}
        className={`${size} rounded-md border border-success/30 font-medium text-success hover:bg-success-subtle/40 transition-colors`}
      >
        {positiveLabel}
      </button>
      <button
        type="button"
        onClick={onNegative}
        className={`${size} rounded-md border border-danger/30 font-medium text-danger hover:bg-danger-subtle/40 transition-colors`}
      >
        {negativeLabel}
      </button>
      {onTertiary && tertiaryLabel && (
        <button
          type="button"
          onClick={onTertiary}
          className={`${size} rounded-md border border-accent/30 font-medium text-accent hover:bg-accent/10 transition-colors`}
        >
          {tertiaryLabel}
        </button>
      )}
    </div>
  )
}
