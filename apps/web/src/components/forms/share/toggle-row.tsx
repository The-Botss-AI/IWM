/** A labelled on/off row (checkbox look matches the document share dialog). */
export function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="border-line flex items-start justify-between gap-3 rounded-md border bg-white p-3">
      <span className="min-w-0 space-y-0.5">
        <span className="text-ink block text-sm font-medium">{label}</span>
        <span className="text-ink-muted block text-xs">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-brand-600 mt-1 h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
