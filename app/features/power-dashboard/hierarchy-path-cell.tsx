import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function HierarchyPathCell({
  path,
  visualDepth,
  hasChildren,
  expanded,
  onToggle,
  className,
  suffix,
  children,
}: {
  path: string;
  visualDepth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  className: string;
  suffix?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <td className={className} title={path}>
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: `${visualDepth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded text-ink-dim outline-none transition hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"}${path}的下级子系统`}
            title={expanded ? "收起下级子系统" : "展开下级子系统"}
          >
            {expanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{path}</span>
        {suffix}
      </div>
      {children}
    </td>
  );
}
