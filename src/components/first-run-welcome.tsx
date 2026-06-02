import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProviderProfile } from "@/core/providers/types";

export interface FirstRunWelcomeProps {
  /** Open when `main_provider` is null at boot (Parameter 10 single trigger). */
  open: boolean;
  profiles: ProviderProfile[];
  /** Pre-select this provider if at least one key is already in keychain. */
  preselectId: string | null;
  /** True if at least one provider has a configured key (decides copy). */
  hasAnyKey: boolean;
  onSelect: (providerId: string) => void;
}

/**
 * First-Run Welcome step. Trigger is the single condition `main_provider ==
 * null at boot` (Parameter 10). Content branches on keychain state:
 *   - At least one key configured → picker pre-selects that provider; note
 *     reads "We'll use your existing <provider> key."
 *   - No keys configured → picker has no pre-selection; note reads
 *     "You'll add an API key in the next step."
 *
 * After selection, App.tsx persists `main_provider` and deep-links to the
 * Providers panel pre-focused on the chosen provider (Parameter 10 final
 * sentence — unconditional, even when a key already exists).
 */
export function FirstRunWelcome({
  open,
  profiles,
  preselectId,
  hasAnyKey,
  onSelect,
}: FirstRunWelcomeProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-2">
            <BrandLogo size={56} />
          </div>
          <DialogTitle className="text-center">Welcome to Delphy Agent</DialogTitle>
          <DialogDescription className="text-center">
            Pick a default provider. You can add more in Settings later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {profiles.map((p) => {
            const isPreselected = preselectId === p.id;
            return (
              <Button
                key={p.id}
                type="button"
                variant={isPreselected ? "default" : "outline"}
                className="w-full justify-between"
                onClick={() => onSelect(p.id)}
              >
                <span>{p.label}</span>
                {isPreselected ? <span className="text-[10px]">(key configured)</span> : null}
              </Button>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          {hasAnyKey
            ? "We'll use your existing key for the provider you pick."
            : "You'll add an API key in the next step."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
