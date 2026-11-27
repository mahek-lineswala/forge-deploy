import type { ReactNode } from "react";

import { errorMessage } from "../../lib/api";
import { cx } from "./cx";
import { ChevronRightIcon } from "./Icons";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-raised", className)} />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

/** Breadcrumb trail: pass <Link> elements for ancestors and plain text for the current page. */
export function Crumbs({ items }: { items: ReactNode[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex min-w-0 items-center gap-1.5 text-sm text-muted">
      {items.map((item, index) => (
        <span
          key={index}
          className={cx("flex min-w-0 items-center gap-1.5 truncate", index === items.length - 1 ? "text-fg" : "[&_a]:hover:text-fg")}
        >
          {index > 0 && <ChevronRightIcon className="size-3.5 text-faint" />}
          {item}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-[28px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type NoticeTone = "error" | "success" | "info";

const noticeTone: Record<NoticeTone, string> = {
  error: "border-bad/40 bg-bad/10 text-bad",
  success: "border-ok/40 bg-ok/10 text-ok",
  info: "border-line-strong bg-raised text-muted",
};

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg border px-3.5 py-2.5 text-sm", noticeTone[tone])}>
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Notice tone="error">{errorMessage(error)}</Notice>;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
      {icon && (
        <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border border-line bg-surface text-muted [&>svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-base font-medium">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Small tag for framework, visibility and similar facts. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-md border border-line-strong px-1.5 py-0.5 text-xs text-muted", className)}>
      {children}
    </span>
  );
}
