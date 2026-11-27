import type { Deployment, DeploymentLog, DeploymentStatus } from "./types";

/** The steps a healthy deployment moves through, coldest to finished. */
export const PIPELINE = [
  "QUEUED",
  "CLONING",
  "BUILDING",
  "DEPLOYING",
  "HEALTH_CHECK",
  "READY",
] as const satisfies readonly DeploymentStatus[];

export type PipelineStep = (typeof PIPELINE)[number];

export const STEP_LABEL: Record<PipelineStep, string> = {
  QUEUED: "Queued",
  CLONING: "Clone",
  BUILDING: "Build",
  DEPLOYING: "Deploy",
  HEALTH_CHECK: "Health",
  READY: "Ready",
};

/** CSS variable carrying each step's heat colour (see index.css). */
export const STEP_COLOR: Record<PipelineStep, string> = {
  QUEUED: "var(--h-steel)",
  CLONING: "var(--h-rust)",
  BUILDING: "var(--h-ember)",
  DEPLOYING: "var(--h-amber)",
  HEALTH_CHECK: "var(--h-gold)",
  READY: "var(--h-cool)",
};

export function stepIndex(status: DeploymentStatus): number {
  return PIPELINE.indexOf(status as PipelineStep);
}

/** Which pipeline step a log stage belongs to. */
const LOG_STAGE_STEP: Record<string, PipelineStep> = {
  CLONE: "CLONING",
  INSTALL: "BUILDING",
  BUILD: "BUILDING",
  DEPLOY: "DEPLOYING",
  HEALTH_CHECK: "HEALTH_CHECK",
};

/** The step a failed deployment stopped at, judged from its last stage log. */
export function failedStep(logs: DeploymentLog[]): PipelineStep | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const step = LOG_STAGE_STEP[logs[i]!.stage];
    if (step) return step;
  }

  return null;
}

/** Wall-clock time spent in each step, measured from the log timestamps. */
export function stepDurations(
  logs: DeploymentLog[],
  deployment: Pick<Deployment, "status" | "createdAt" | "finishedAt">,
  now = Date.now(),
): Partial<Record<PipelineStep, number>> {
  const starts = new Map<PipelineStep, number>();

  for (const log of logs) {
    const step = LOG_STAGE_STEP[log.stage];
    if (step && !starts.has(step)) starts.set(step, new Date(log.createdAt).getTime());
  }

  const ordered = PIPELINE.filter((step) => starts.has(step));
  const end = deployment.finishedAt ? new Date(deployment.finishedAt).getTime() : now;
  const result: Partial<Record<PipelineStep, number>> = {};

  ordered.forEach((step, i) => {
    const next = ordered[i + 1];
    const to = next ? starts.get(next)! : end;
    result[step] = Math.max(0, to - starts.get(step)!);
  });

  return result;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Build tools colour their output; the viewer shows it plain. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
