import { Loader2, Send } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";

interface ComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  disabled: boolean;
  streaming: boolean;
  backendLabel: string;
}

/** Message input row: text field + send button (spinner while streaming). */
export function Composer({
  input,
  onInputChange,
  onSubmit,
  disabled,
  streaming,
  backendLabel,
}: ComposerProps) {
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border px-4 py-3">
      <input
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.currentTarget.value)}
        placeholder={`Message ${backendLabel}...`}
        disabled={disabled}
        className="flex-1 rounded-lg border-none bg-muted px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={disabled || input.trim().length === 0}
        aria-label="Send message"
        className="mb-0.5 shrink-0"
      >
        {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </form>
  );
}
