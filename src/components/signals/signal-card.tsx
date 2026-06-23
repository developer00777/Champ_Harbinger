"use client";

import { Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { signalIconMap } from "@/lib/signal-icons";
import type {
  Signal,
  SignalCategory,
  SignalExecutionType,
} from "@/lib/types/signal";

const serviceLabels: Record<SignalExecutionType, string> = {
  browser_script: "Browser",
  exa_search: "Web Search",
  tool_call: "Tool",
  agent_instructions: "Agent",
};

// Color-coded category pills (Aegis). Tints work in both light and dark.
const categoryPillClass: Record<SignalCategory, string> = {
  hiring: "bg-green-500/15 text-green-700 dark:text-green-400",
  funding: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  executive: "bg-primary/15 text-primary",
  product: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  engagement: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  custom: "bg-muted text-muted-foreground",
};

interface SignalCardProps {
  signal: Signal;
  enabled?: boolean;
  showToggle?: boolean;
  variant?: "card" | "row";
  onToggle?: (signalId: string, enabled: boolean) => void;
  onClick?: (signal: Signal) => void;
}

export function SignalCard({
  signal,
  enabled,
  showToggle = false,
  variant = "card",
  onToggle,
  onClick,
}: SignalCardProps) {
  const Icon = (signal.icon && signalIconMap[signal.icon]) || Zap;

  const badge = signal.is_builtin
    ? "Built-in"
    : signal.is_public
      ? "Community"
      : "Custom";

  const badgeClass = signal.is_builtin
    ? "bg-blue-500/10 text-blue-500"
    : signal.is_public
      ? "bg-purple-500/10 text-purple-500"
      : "bg-emerald-500/10 text-emerald-500";

  const serviceLabel =
    signal.execution_type === "tool_call" && signal.tool_key
      ? signal.tool_key
      : serviceLabels[signal.execution_type];

  const categoryClass =
    categoryPillClass[signal.category] ?? categoryPillClass.custom;

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={() => onClick?.(signal)}
        className="border-border bg-card shadow-card hover:border-primary flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors"
      >
        <div className="bg-peach text-peach-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{signal.name}</h3>
            <span
              className={`inline-flex shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${categoryClass}`}
            >
              {signal.category}
            </span>
            <span
              className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}`}
            >
              {badge}
            </span>
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px]">
              {serviceLabel}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {signal.description}
          </p>
        </div>
        {showToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onToggle?.(signal.id, checked)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(signal)}
      className="border-border bg-card shadow-card hover:border-primary flex flex-col rounded-xl border p-4 text-left transition-colors"
    >
      {/* Top row: peach icon tile + toggle */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="bg-peach text-peach-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </div>
        {showToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => onToggle?.(signal.id, checked)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      <h3 className="text-sm font-semibold">{signal.name}</h3>
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        {signal.description}
      </p>

      {/* Footer: category pill + provenance/service metadata */}
      <div className="mt-3 flex items-center gap-1.5">
        <span
          className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${categoryClass}`}
        >
          {signal.category}
        </span>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeClass}`}
        >
          {badge}
        </span>
        <span className="bg-muted text-muted-foreground ml-auto rounded-full px-1.5 py-0.5 font-mono text-[10px]">
          {serviceLabel}
        </span>
      </div>
    </button>
  );
}
