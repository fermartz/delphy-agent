import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface ApiKeyInputProps {
  /** Placeholder shown when empty (typically the provider's key prefix, e.g. "sk-ant-..."). */
  placeholder?: string;
  /** Label for the submit button. Defaults to "Save". */
  submitLabel?: string;
  /** Whether the input is currently disabled (e.g. during a save). */
  disabled?: boolean;
  /** Called when the user submits a non-empty trimmed value. */
  onSubmit: (value: string) => void | Promise<void>;
  /** Called when the user cancels (optional — caller may not want a cancel affordance). */
  onCancel?: () => void;
}

/**
 * Shared password input used by both the bootscreen banner and the Providers
 * panel for entering API keys. Paste-friendly, no autocomplete, no spellcheck,
 * and submits on Enter. Per Parameter 8 of the multi-provider plan, the
 * component is intentionally minimal so the two callers can't drift.
 */
export function ApiKeyInput({
  placeholder = "",
  submitLabel = "Save",
  disabled = false,
  onSubmit,
  onCancel,
}: ApiKeyInputProps) {
  const [value, setValue] = useState("");
  const canSubmit = !disabled && value.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(value.trim());
    setValue("");
  }

  return (
    <form className="flex gap-2" onSubmit={handleSubmit}>
      <input
        type="password"
        autoComplete="off"
        spellCheck="false"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded border border-border bg-background px-3 py-1 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
      />
      <Button type="submit" size="sm" disabled={!canSubmit}>
        {disabled ? "Saving..." : submitLabel}
      </Button>
      {onCancel ? (
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      ) : null}
    </form>
  );
}
