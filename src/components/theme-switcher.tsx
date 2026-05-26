import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/themes/types";

interface ThemeSwitcherProps {
  themes: Theme[];
  selectedThemeId: string;
  onThemeChange: (themeId: string) => void;
}

export function ThemeSwitcher({ themes, selectedThemeId, onThemeChange }: ThemeSwitcherProps) {
  const current = themes.find((t) => t.id === selectedThemeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={themes.length === 0}
        >
          <Palette className="h-3 w-3" />
          {current?.label ?? selectedThemeId}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {themes.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onThemeChange(t.id)} className="gap-2">
            <Check
              className={`h-3 w-3 ${t.id === selectedThemeId ? "opacity-100" : "opacity-0"}`}
            />
            <span className="font-medium">{t.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
