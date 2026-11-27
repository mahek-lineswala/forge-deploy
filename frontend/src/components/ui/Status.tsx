import { cx } from "./cx";
import { formatDuration } from "../../lib/format";
import {
  PIPELINE,
  STEP_COLOR,
  STEP_LABEL,
  stepIndex,
  type PipelineStep,
} from "../../lib/pipeline";
import { isActiveStatus, type DeploymentStatus } from "../../lib/types";

// ============================================
// STATUS BADGE
// ============================================

const BADGE: Record<DeploymentStatus, { label: string; color: string }> = {
  QUEUED: { label: "Queued", color: "var(--h-steel)" },
  CLONING: { label: "Cloning", color: "var(--h-rust)" },
  BUILDING: { label: "Building", color: "var(--h-ember)" },
  DEPLOYING: { label: "Deploying", color: "var(--h-amber)" },
  HEALTH_CHECK: { label: "Health check", color: "var(--h-gold)" },
  READY: { label: "Ready", color: "var(--h-cool)" },
  FAILED: { label: "Failed", color: "var(--bad)" },
  CANCELLED: { label: "Cancelled", color: "var(--faint)" },
  SUPERSEDED: { label: "Superseded", color: "var(--faint)" },
};

export function StatusBadge({ status, className }: { status: DeploymentStatus; className?: string }) {
  const { label, color } = BADGE[status] ?? BADGE.QUEUED;
  const active = isActiveStatus(status);

  return (
    <span
      style={{ ["--c" as string]: color }}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-medium",
        "border-[color-mix(in_oklab,var(--c)_32%,transparent)] bg-[color-mix(in_oklab,var(--c)_12%,transparent)]",
        "text-[color-mix(in_oklab,var(--c)_72%,var(--fg))]",
        className,
      )}
    >
      <span className={cx("size-1.5 rounded-full bg-[var(--c)]", active && "heat-dot-active")} />
      {label}
    </span>
  );
}

// ============================================
// HEAT BAR
// ============================================

type SegmentState = "done" | "current" | "pending" | "failed" | "stopped";

function segmentStates(status: DeploymentStatus, failedAt?: PipelineStep | null): SegmentState[] {
  const index = stepIndex(status);

  if (status === "READY" || status === "SUPERSEDED") return PIPELINE.map(() => "done");

  if (index !== -1) {
    return PIPELINE.map((_, i) => (i < index ? "done" : i === index ? "current" : "pending"));
  }

  if (status === "FAILED") {
    const at = failedAt ? stepIndex(failedAt) : -1;
    if (at === -1) return PIPELINE.map(() => "failed");
    return PIPELINE.map((_, i) => (i < at ? "done" : i === at ? "failed" : "pending"));
  }

  return PIPELINE.map(() => "stopped"); // CANCELLED
}

function segmentStyle(state: SegmentState, step: PipelineStep, dim: boolean) {
  const color = STEP_COLOR[step];
  const base = { ["--seg" as string]: color } as React.CSSProperties;

  switch (state) {
    case "done":
      return { ...base, background: color, opacity: dim ? 0.4 : 1 };
    case "current":
      return { ...base, boxShadow: `0 0 14px color-mix(in oklab, ${color} 65%, transparent)` };
    case "failed":
      return { ...base, background: "var(--bad)" };
    case "stopped":
      return { ...base, background: "var(--line-strong)" };
    default:
      return { ...base, background: "var(--line)" };
  }
}

/** Six-tick version of the pipeline for lists and cards. */
export function HeatBar({
  status,
  failedAt,
  className,
}: {
  status: DeploymentStatus;
  failedAt?: PipelineStep | null;
  className?: string;
}) {
  const states = segmentStates(status, failedAt);

  return (
    <div className={cx("flex h-1.5 gap-[3px]", className)} role="img" aria-label={BADGE[status]?.label}>
      {PIPELINE.map((step, i) => (
        <span
          key={step}
          style={segmentStyle(states[i]!, step, status === "SUPERSEDED")}
          className={cx("h-full flex-1 rounded-full", states[i] === "current" && "heat-active")}
        />
      ))}
    </div>
  );
}

/** The hero pipeline on the deployment page: thick bar, step names and timings. */
export function PipelineBar({
  status,
  failedAt,
  durations,
  animateIn,
}: {
  status: DeploymentStatus;
  failedAt?: PipelineStep | null;
  durations: Partial<Record<PipelineStep, number>>;
  /** Heat the segments up one after another on mount (sign-in panel). */
  animateIn?: boolean;
}) {
  const states = segmentStates(status, failedAt);

  return (
    <ol className="grid grid-cols-6 gap-1.5 sm:gap-2" aria-label="Deployment progress">
      {PIPELINE.map((step, i) => {
        const state = states[i]!;
        const duration = durations[step];

        return (
          <li key={step} className="min-w-0">
            <span
              style={{
                ...segmentStyle(state, step, status === "SUPERSEDED"),
                ...(animateIn ? { animationDelay: `${i * 140}ms` } : {}),
              }}
              className={cx("block h-2.5 rounded-full", state === "current" && "heat-active", animateIn && "heat-rise")}
            />
            <p
              className={cx(
                "mt-2.5 truncate text-xs font-medium sm:text-[13px]",
                state === "pending" || state === "stopped" ? "text-faint" : "text-fg",
                state === "failed" && "text-bad",
              )}
            >
              {STEP_LABEL[step]}
            </p>
            <p className="h-4 truncate font-mono text-xs text-muted">
              {duration != null && step !== "QUEUED" ? formatDuration(duration) : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
