import { Button } from "@/components/ui/button";
import type { BootErrorKind } from "@/core/adapters/direct-api";

interface BootBannerProps {
  errorKind: BootErrorKind;
  errorMessage: string;
  keyInput: string;
  setKeyInput: (v: string) => void;
  onSave: () => void;
  onRetry: () => void;
  onOpenProviders: () => void;
  saving: boolean;
  providerLabel: string;
}

/**
 * Boot-time API-key entry / failure banner. Extracted verbatim from App.tsx.
 * Branches on `errorKind`: "unknown" → retry banner; "secure-storage-unavailable"
 * → Linux session-only-key copy + "Use for session"; else → inline key entry +
 * "Open Providers".
 */
export function BootBanner({
  errorKind,
  errorMessage,
  keyInput,
  setKeyInput,
  onSave,
  onRetry,
  onOpenProviders,
  saving,
  providerLabel,
}: BootBannerProps) {
  if (errorKind === "unknown") {
    return (
      <div className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground">
        <div className="font-medium">Backend failed to start.</div>
        <div className="mt-1 text-xs text-muted-foreground">{errorMessage}</div>
        <Button type="button" variant="destructive" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      </div>
    );
  }

  const isLinuxFallback = errorKind === "secure-storage-unavailable";

  return (
    <div className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground">
      <div className="font-medium">
        {isLinuxFallback
          ? "Secure storage unavailable — session-only key required"
          : `${providerLabel} API key needed`}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {isLinuxFallback ? (
          <>
            No Secret Service daemon (GNOME Keyring / KWallet) is running on this Linux system. The
            key you enter will live only in memory for this session and won't be saved. To enable
            persistent storage, install GNOME Keyring or KWallet, then reload.
          </>
        ) : (
          <>
            Enter the key inline below, or open Settings → Providers to manage keys for all
            registered providers. Keys are stored in your OS keychain (macOS Keychain / Windows
            Credential Manager / Linux Secret Service).
          </>
        )}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck="false"
          value={keyInput}
          onChange={(e) => setKeyInput(e.currentTarget.value)}
          placeholder={`${providerLabel} API key`}
          disabled={saving}
          className="flex-1 rounded border border-border bg-background px-3 py-1 text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={saving || keyInput.trim().length === 0}>
          {saving ? "Saving..." : isLinuxFallback ? "Use for session" : "Save"}
        </Button>
        {!isLinuxFallback ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpenProviders}>
            Open Providers
          </Button>
        ) : null}
      </form>
    </div>
  );
}
