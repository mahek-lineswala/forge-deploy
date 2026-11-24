import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Button, Card, ErrorBox, Loading, PageHeader, Spinner, StatusBadge, cx } from "../components/ui";
import { formatDuration, formatTime, shortSha, timeAgo } from "../lib/format";
import { useCancelDeployment, useDeployment, useDeploymentLogs, useProject } from "../lib/queries";
import { isActiveStatus, type Deployment, type DeploymentLog, type DeploymentStatus } from "../lib/types";

const PIPELINE: DeploymentStatus[] = ["QUEUED", "CLONING", "BUILDING", "DEPLOYING", "HEALTH_CHECK", "READY"];

export function DeploymentPage({ deploymentId }: { deploymentId: string }) {
  const deployment = useDeployment(deploymentId);

  if (deployment.isPending) return <Loading />;
  if (deployment.error) return <ErrorBox error={deployment.error} />;

  return <DeploymentView deployment={deployment.data} />;
}

function DeploymentView({ deployment }: { deployment: Deployment }) {
  const project = useProject(deployment.projectId);
  const cancel = useCancelDeployment(deployment);
  const active = isActiveStatus(deployment.status);

  return (
    <>
      <div className="mb-2 text-sm text-zinc-400">
        <Link
          to="/projects/$projectId"
          params={{ projectId: deployment.projectId }}
          search={{ tab: undefined }}
          className="hover:text-zinc-200"
        >
          ← {project.data?.name ?? "Project"}
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Deployment <span className="font-mono text-base text-zinc-500">{deployment.id}</span>
          </span>
        }
        description={<StatusBadge status={deployment.status} />}
        actions={
          <>
            {deployment.status === "READY" && deployment.deploymentUrl && (
              <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer">
                <Button>Visit</Button>
              </a>
            )}
            {active && (
              <Button
                variant="danger"
                loading={cancel.isPending}
                onClick={() => {
                  if (confirm("Cancel this deployment?")) cancel.mutate();
                }}
              >
                Cancel
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <ErrorBox error={cancel.error} />

        <Pipeline status={deployment.status} />

        {deployment.status === "FAILED" && deployment.errorMessage && (
          <Card className="border-red-900 p-4">
            <p className="text-sm font-medium text-red-200">Deployment failed</p>
            <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-red-200/80">
              {deployment.errorMessage}
            </pre>
          </Card>
        )}

        <Card className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="URL">
            {deployment.deploymentUrl ? (
              <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer" className="break-all text-emerald-300 hover:underline">
                {deployment.deploymentUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              "—"
            )}
          </Meta>
          <Meta label="Commit">
            <span className="font-mono">{shortSha(deployment.commitSha)}</span>
            {deployment.commitMessage && <span className="block truncate text-zinc-400">{deployment.commitMessage}</span>}
          </Meta>
          <Meta label="Framework">
            {deployment.framework ?? "—"}
            {deployment.packageManager && <span className="text-zinc-500"> · {deployment.packageManager}</span>}
          </Meta>
          <Meta label="Build time">{formatDuration(deployment.buildDurationMs)}</Meta>
          <Meta label="Created">{timeAgo(deployment.createdAt)}</Meta>
          <Meta label="Finished">{timeAgo(deployment.finishedAt)}</Meta>
          <Meta label="Attempts">{deployment.attempts ?? "—"}</Meta>
          <Meta label="Output">{deployment.outputDir ?? "—"}</Meta>
        </Card>

        <LogViewer deploymentId={deployment.id} />
      </div>
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs tracking-wide text-zinc-500 uppercase">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Pipeline({ status }: { status: DeploymentStatus }) {
  const index = PIPELINE.indexOf(status);
  const stopped = index === -1; // FAILED / CANCELLED / SUPERSEDED

  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {PIPELINE.map((step, i) => {
        const done = !stopped && (i < index || status === "READY");
        const current = !stopped && i === index && status !== "READY";

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cx(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                done && "border-emerald-900 bg-emerald-950/40 text-emerald-300",
                current && "border-amber-800 bg-amber-950/40 text-amber-200",
                !done && !current && "border-zinc-800 text-zinc-500",
              )}
            >
              {current && <Spinner className="size-3" />}
              {step.replace("_", " ").toLowerCase()}
            </span>
            {i < PIPELINE.length - 1 && <span className="text-zinc-700">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ============================================
// LOGS
// ============================================

const stageColor: Record<string, string> = {
  CLONE: "text-sky-300",
  INSTALL: "text-violet-300",
  BUILD: "text-amber-300",
  DEPLOY: "text-emerald-300",
  HEALTH_CHECK: "text-teal-300",
  SYSTEM: "text-zinc-400",
};

function LogViewer({ deploymentId }: { deploymentId: string }) {
  const { logs, finished, error } = useDeploymentLogs(deploymentId);
  const [follow, setFollow] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [logs.length, follow]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2 font-medium">
          Logs {!finished && <Spinner className="size-3.5 text-zinc-400" />}
        </span>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
      </div>

      <div className="max-h-[32rem] overflow-auto bg-black/40 p-4 font-mono text-xs leading-relaxed">
        {error != null && <ErrorBox error={error} />}
        {logs.length === 0 && !error && <p className="text-zinc-500">{finished ? "No logs." : "Waiting for logs…"}</p>}
        {logs.map((log) => (
          <LogLine key={log.id} log={log} />
        ))}
        <div ref={bottom} />
      </div>
    </Card>
  );
}

function LogLine({ log }: { log: DeploymentLog }) {
  return (
    <div
      className={cx(
        "grid grid-cols-[5.5rem_7rem_1fr] gap-3 py-0.5",
        log.level === "ERROR" && "text-red-300",
        log.level === "WARN" && "text-amber-200",
      )}
    >
      <span className="text-zinc-600">{formatTime(log.createdAt)}</span>
      <span className={stageColor[log.stage] ?? "text-zinc-400"}>{log.stage}</span>
      <span className="break-words whitespace-pre-wrap">{log.message}</span>
    </div>
  );
}
