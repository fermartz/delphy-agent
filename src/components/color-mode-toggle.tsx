import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ColorMode } from "@/core/settings/types";

const MODES: readonly ColorMode[] = ["light", "dark", "system"];
const DARK_MEDIA = "(prefers-color-scheme: dark)";

interface ColorModeToggleProps {
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
}

/**
 * Three-state color-mode toggle. Click cycles light → dark → system → light.
 * The icon reflects the *resolved* mode (Sun for effective-light, Moon for
 * effective-dark) so the surface tells you what you're currently looking at;
 * "system" is a secondary affordance shown via a small "auto" label beneath
 * the icon + the tooltip. Locked by plan Parameter 6.
 */
export function ColorModeToggle({ mode, onChange }: ColorModeToggleProps) {
  // Track OS preference so the Sun/Moon icon stays right when mode === "system"
  // and the OS flips between light and dark.
  const [osDark, setOsDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(DARK_MEDIA).matches;
  });

  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DARK_MEDIA);
    const handler = (event: MediaQueryListEvent): void => setOsDark(event.matches);
    setOsDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  function cycle(): void {
    const idx = MODES.indexOf(mode);
    onChange(MODES[(idx + 1) % MODES.length]);
  }

  const resolvedDark = mode === "dark" || (mode === "system" && osDark);
  const Icon = resolvedDark ? Moon : Sun;
  const label =
    mode === "light"
      ? "Light mode — click for dark"
      : mode === "dark"
        ? "Dark mode — click for system"
        : "System mode (following OS) — click for light";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={cycle}
      className="relative h-7 w-7 text-muted-foreground hover:text-foreground"
      title={label}
      aria-label={label}
    >
      <Icon className="h-3 w-3" />
      {mode === "system" ? (
        <span
          aria-hidden="true"
          className="absolute right-0 bottom-0 translate-x-[1px] translate-y-[1px] rounded-sm bg-background px-[2px] text-[8px] leading-none text-muted-foreground"
        >
          auto
        </span>
      ) : null}
    </Button>
  );
}
