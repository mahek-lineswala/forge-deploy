import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

import { errorMessage } from "../lib/api";
import type { DeploymentStatus } from "../lib/types";

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ============================================
// BUTTON
// ============================================

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-white text-zinc-950 hover:bg-zinc-200",
  secondary: "border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
  danger: "border border-red-900 bg-red-950/60 text-red-200 hover:bg-red-900/60",
  ghost: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
};

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

// ============================================
// FORM FIELDS
// ============================================

const fieldClass =
  "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClass, className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClass, className)} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

// ============================================
// LAYOUT PIECES
// ============================================

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-lg border border-zinc-800 bg-zinc-900/40", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-zinc-400">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-400">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;

  return (
    <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
      {errorMessage(error)}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 px-6 py-14 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ============================================
// DEPLOYMENT STATUS
// ============================================

const statusStyle: Record<DeploymentStatus, { dot: string; text: string; label: string }> = {
  QUEUED: { dot: "bg-zinc-400", text: "text-zinc-300", label: "Queued" },
  CLONING: { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", label: "Cloning" },
  BUILDING: { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", label: "Building" },
  DEPLOYING: { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", label: "Deploying" },
  HEALTH_CHECK: { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", label: "Health check" },
  READY: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Ready" },
  FAILED: { dot: "bg-red-500", text: "text-red-300", label: "Failed" },
  CANCELLED: { dot: "bg-zinc-600", text: "text-zinc-400", label: "Cancelled" },
  SUPERSEDED: { dot: "bg-zinc-600", text: "text-zinc-500", label: "Superseded" },
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  const style = statusStyle[status] ?? statusStyle.QUEUED;

  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm font-medium", style.text)}>
      <span className={cx("size-2 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}

export { cx };
