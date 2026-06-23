import { trackingReadinessStyles } from "@/lib/status-styles";
import type { ReadinessTag } from "@/lib/types/tracking";

export function ReadinessBadge({ tag }: { tag: ReadinessTag | null }) {
  if (!tag) return null;

  const style = trackingReadinessStyles[tag];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] ${style.className}`}
    >
      {style.label}
    </span>
  );
}
