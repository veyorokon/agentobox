interface ActionButtonPairProps {
  onPositive: () => void
  onNegative: () => void
  positiveLabel?: string
  negativeLabel?: string
}

export function ActionButtonPair({
  onPositive,
  onNegative,
  positiveLabel = "Allow",
  negativeLabel = "Deny",
}: ActionButtonPairProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPositive}
        className="px-3 py-1.5 rounded-md border border-success/30 text-xs font-medium text-success hover:bg-success-subtle/40 transition-colors"
      >
        {positiveLabel}
      </button>
      <button
        type="button"
        onClick={onNegative}
        className="px-3 py-1.5 rounded-md border border-danger/30 text-xs font-medium text-danger hover:bg-danger-subtle/40 transition-colors"
      >
        {negativeLabel}
      </button>
    </div>
  )
}
