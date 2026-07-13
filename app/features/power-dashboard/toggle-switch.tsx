export function ToggleSwitch({
  checked,
  onCheckedChange,
  ariaLabel,
  ariaDescribedBy,
  title,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
  ariaDescribedBy?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-brand bg-brand"
          : "border-ink-faint/70 bg-surface-2",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full border border-line bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
        aria-hidden
      />
    </button>
  );
}
