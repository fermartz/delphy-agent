import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Single status badge shared by the Providers panel and the MCP server rows.
 * Replaces the two bespoke badge components (provider `StatusBadge` +
 * `McpStatusBadge`) with one shadcn `Badge`-backed mapper. Each kind maps to
 * a tone (color) + optional icon + default label; pass `children` to override
 * the label (e.g. "Configured (***nAAA)").
 */
export type StatusKind =
  | "connected"
  | "connecting"
  | "failed"
  | "disabled"
  | "configured"
  | "invalid"
  | "testing"
  | "neutral";

const STYLES: Record<
  StatusKind,
  { className: string; icon?: typeof CheckCircle2; spin?: boolean; label: string }
> = {
  connected: { className: "bg-primary/10 text-primary", icon: CheckCircle2, label: "connected" },
  configured: { className: "bg-primary/10 text-primary", icon: CheckCircle2, label: "Configured" },
  connecting: {
    className: "bg-muted text-muted-foreground",
    icon: Loader2,
    spin: true,
    label: "connecting…",
  },
  testing: {
    className: "bg-muted text-muted-foreground",
    icon: Loader2,
    spin: true,
    label: "Testing…",
  },
  failed: { className: "bg-destructive/10 text-destructive", icon: XCircle, label: "failed" },
  invalid: { className: "bg-destructive/10 text-destructive", icon: XCircle, label: "Invalid" },
  disabled: { className: "bg-muted text-muted-foreground", label: "disabled" },
  neutral: { className: "bg-muted text-muted-foreground", label: "Not configured" },
};

export function StatusBadge({
  kind,
  title,
  children,
}: {
  kind: StatusKind;
  title?: string;
  children?: ReactNode;
}) {
  const style = STYLES[kind];
  const Icon = style.icon;
  return (
    <Badge className={cn("border-transparent font-normal", style.className)} title={title}>
      {Icon ? <Icon className={cn("h-3 w-3", style.spin && "animate-spin")} /> : null}
      {children ?? style.label}
    </Badge>
  );
}
