import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  BoltIcon,
  Button,
  Card,
  ChevronDownIcon,
  ChevronRightIcon,
  ConfirmDialog,
  Crumbs,
  CopyIcon,
  DownloadIcon,
  ErrorBox,
  ExternalIcon,
  Loading,
  PageHeader,
  PipelineBar,
  Spinner,
  StatusBadge,
  XIcon,
  cx,
} from "../components/ui";
import { useNow } from "../lib/hooks";
import { formatDuration, formatTime, shortSha, timeAgo } from "../lib/format";
import { failedStep, stepDurations, stripAnsi } from "../lib/pipeline";
import {
  useCancelDeployment,
  useCreateDeployment,
  useDeployment,
  useDeploymentLogs,
  useProject,
} from "../lib/queries";
import { isActiveStatus, type Deployment, type DeploymentLog } from "../lib/types";

export function DeploymentPage({ deploymentId }: { deploymentId: string }) {
  const deployment = useDeployment(deploymentId);

  if (deployment.isPending) return <Loading />;
  if (deployment.error) return <ErrorBox error={deployment.error} />;

  return <DeploymentView deployment={deployment.data} />;
}

function DeploymentView({ deployment }: { deployment: Deployment }) {
  const project = useProject(deployment.projectId);
  const cancel = useCancelDeployment(deployment);
  const redeploy = useCreateDeployment(deployment.projectId);
  const navigate = useNavigate();
  const { logs, finished, error: logsError } = useDeploymentLogs(deployment.id);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const active = isActiveStatus(deployment.status);
  const now = useNow(active);
  const durations = useMemo(() => stepDurations(logs, deployment, now), [logs, deployment, now]);
  const failedAt = deployment.status === "FAILED" ? failedStep(logs) : null;

  const runAgain = async () => {
    const next = await redeploy.mutateAsync();
    await navigate({ to: "/deployments/$deploymentId", params: { deploymentId: next.id } });
  };

  return (
    <>
      <Crumbs
        items={[
          <Link to="/">Projects</Link>,
          <Link to="/projects/$projectId" params={{ projectId: deployment.projectId }} search={{ tab: undefined }}>
            {project.data?.name ?? "Project"}
          </Link>,
          <span className="font-mono">{deployment.id.slice(-8)}</span>,
        ]}
      />

      <PageHeader
        title={deployment.commitMessage ?? "Manual deployment"}
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge status={deployment.status} />
            <span className="font-mono text-[13px]">{shortSha(deployment.commitSha)}</span>
            <span>{timeAgo(deployment.createdAt)}</span>
          </div>
        }
        actions={
          <>
            {deployment.status === "READY" && deployment.deploymentUrl && (
              <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer">
                <Button>
                  Visit <ExternalIcon />
                </Button>
              </a>
            )}
            {active ? (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                <XIcon /> Cancel
              </Button>
            ) : (
              <Button variant="secondary" loading={redeploy.isPending} onClick={() => void runAgain().catch(() => undefined)}>
                <BoltIcon /> Redeploy
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <ErrorBox error={cancel.error ?? redeploy.error} />

        <Card className="p-6">
          <PipelineBar status={deployment.status} failedAt={failedAt} durations={durations} />
        </Card>

        {deployment.status === "FAILED" && deployment.errorMessage && (
          <Card className="border-bad/40 p-5">
            <p className="text-sm font-semibold text-bad">
              {failedAt ? `Deployment failed during ${failedAt.toLowerCase().replace("_", " ")}` : "Deployment failed"}
            </p>
            <pre className="mt-2.5 max-h-52 overflow-auto font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
              {stripAnsi(deployment.errorMessage)}
            </pre>
          </Card>
        )}

        <Card className="grid grid-cols-1 gap-x-8 gap-y-5 p-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Domain" wide>
            {deployment.deploymentUrl ? (
              <a href={deployment.deploymentUrl} target="_blank" rel="noreferrer" className="break-all hover:underline">
                {deployment.deploymentUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              "—"
            )}
          </Meta>
          <Meta label="Commit">
            <span className="font-mono">{shortSha(deployment.commitSha)}</span>
          </Meta>
          <Meta label="Framework">
            {deployment.framework ?? "—"}
            {deployment.packageManager && <span className="text-muted"> · {deployment.packageManager}</span>}
          </Meta>
          <Meta label="Build time">{formatDuration(deployment.buildDurationMs)}</Meta>
          <Meta label="Created">{timeAgo(deployment.createdAt)}</Meta>
          <Meta label="Finished">{timeAgo(deployment.finishedAt)}</Meta>
          <Meta label="Attempts">{deployment.attempts ?? "—"}</Meta>
          <Meta label="Output">{deployment.outputDir ?? "—"}</Meta>
        </Card>

        <LogViewer logs={logs} finished={finished} error={logsError} deployment={deployment} now={now} />
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this deployment?"
        description="The build stops and nothing is published. You can deploy again at any time."
        confirmLabel="Cancel deployment"
        pending={cancel.isPending}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate(undefined, { onSettled: () => setConfirmCancel(false) })}
      />
    </>
  );
}

function Meta({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2")}>
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}

// ============================================
// LOGS
// ============================================

const STAGE_TITLE: Record<string, string> = {
  CLONE: "Clone repository",
  INSTALL: "Install dependencies",
  BUILD: "Build",
  DEPLOY: "Deploy",
  HEALTH_CHECK: "Health check",
  SYSTEM: "System",
};

const STAGE_COLOR: Record<string, string> = {
  CLONE: "var(--h-rust)",
  INSTALL: "var(--h-ember)",
  BUILD: "var(--h-ember)",
  DEPLOY: "var(--h-amber)",
  HEALTH_CHECK: "var(--h-gold)",
  SYSTEM: "var(--h-steel)",
};

interface LogGroup {
  key: string;
  stage: string;
  logs: DeploymentLog[];
}

/** Consecutive lines of the same stage collapse into one section. */
function groupLogs(logs: DeploymentLog[]): LogGroup[] {
  const groups: LogGroup[] = [];

  logs.forEach((log) => {
    const last = groups[groups.length - 1];

    if (last && last.stage === log.stage) {
      last.logs.push(log);
    } else {
      groups.push({ key: `${log.stage}-${log.id}`, stage: log.stage, logs: [log] });
    }
  });

  return groups;
}

function LogViewer({
  logs,
  finished,
  error,
  deployment,
  now,
}: {
  logs: DeploymentLog[];
  finished: boolean;
  error: unknown;
  deployment: Deployment;
  now: number;
}) {
  const [follow, setFollow] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupLogs(logs), [logs]);
  const lineOf = useMemo(() => new Map(logs.map((log, index) => [log.id, index + 1])), [logs]);
  const problemCount = useMemo(() => logs.filter((l) => l.level === "ERROR" || l.level === "WARN").length, [logs]);

  // Scroll the log pane itself; scrolling the page would yank the view away from the header.
  useEffect(() => {
    const pane = scroller.current;
    if (follow && pane) pane.scrollTop = pane.scrollHeight;
  }, [logs.length, follow]);

  const toggle = (key: string) =>
    setClosed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const asText = () =>
    logs.map((l) => `${new Date(l.createdAt).toISOString()} [${l.stage}] ${stripAnsi(l.message)}`).join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the download button still works.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([asText()], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `deployment-${deployment.id}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2.5 text-[15px] font-semibold">
          Build logs
          {!finished && <Spinner className="size-3.5 text-muted" />}
          <span className="font-mono text-xs font-normal text-muted">{logs.length} lines</span>
        </h2>

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" aria-pressed={errorsOnly} onClick={() => setErrorsOnly((v) => !v)} className={cx(errorsOnly && "bg-raised text-fg")}>
            Errors and warnings{problemCount > 0 && <span className="font-mono text-bad">{problemCount}</span>}
          </Button>
          <Button variant="ghost" size="sm" aria-pressed={follow} onClick={() => setFollow((v) => !v)} className={cx(follow && "bg-raised text-fg")}>
            Follow
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void copy()} disabled={logs.length === 0}>
            <CopyIcon /> {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={download} disabled={logs.length === 0} aria-label="Download logs">
            <DownloadIcon />
          </Button>
        </div>
      </div>

      <div ref={scroller} data-theme="dark" className="max-h-[36rem] min-h-40 overflow-auto bg-sunken font-mono text-[12.5px] leading-6 text-fg">
        {error != null && (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        )}

        {logs.length === 0 && !error && (
          <p className="p-5 text-muted">{finished ? "No logs were recorded." : "Waiting for the first log line…"}</p>
        )}

        {groups.map((group, index) => (
          <LogSection
            key={group.key}
            group={group}
            open={!closed.has(group.key)}
            onToggle={() => toggle(group.key)}
            errorsOnly={errorsOnly}
            lineOf={lineOf}
            running={!finished && index === groups.length - 1}
            now={now}
          />
        ))}
      </div>
    </Card>
  );
}

function LogSection({
  group,
  open,
  onToggle,
  errorsOnly,
  lineOf,
  running,
  now,
}: {
  group: LogGroup;
  open: boolean;
  onToggle: () => void;
  errorsOnly: boolean;
  lineOf: Map<string, number>;
  running: boolean;
  now: number;
}) {
  const first = new Date(group.logs[0]!.createdAt).getTime();
  const last = new Date(group.logs[group.logs.length - 1]!.createdAt).getTime();
  const duration = (running ? Math.max(now, last) : last) - first;
  const hasError = group.logs.some((l) => l.level === "ERROR");
  const shown = errorsOnly ? group.logs.filter((l) => l.level === "ERROR" || l.level === "WARN") : group.logs;

  if (errorsOnly && shown.length === 0) return null;

  return (
    <section className="border-b border-line last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-3 bg-sunken/95 px-5 py-2 text-left backdrop-blur hover:bg-raised"
      >
        {open ? <ChevronDownIcon className="size-3.5 text-muted" /> : <ChevronRightIcon className="size-3.5 text-muted" />}
        <span className="size-2 rounded-full" style={{ background: hasError ? "var(--bad)" : (STAGE_COLOR[group.stage] ?? "var(--h-steel)") }} />
        <span className="font-sans text-[13px] font-medium">{STAGE_TITLE[group.stage] ?? group.stage}</span>
        <span className="text-xs text-muted">{group.logs.length}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          {running && <Spinner className="size-3" />}
          {formatDuration(duration)}
        </span>
      </button>

      {open && (
        <div className="pb-2">
          {shown.map((log) => (
            <LogLine key={log.id} log={log} lineNumber={lineOf.get(log.id) ?? 0} />
          ))}
        </div>
      )}
    </section>
  );
}

function LogLine({ log, lineNumber }: { log: DeploymentLog; lineNumber: number }) {
  return (
    <div
      className={cx(
        "grid grid-cols-[2.75rem_5rem_minmax(0,1fr)] gap-x-3 px-5 hover:bg-white/[0.03]",
        log.level === "ERROR" && "bg-bad/10 text-bad",
        log.level === "WARN" && "text-warn",
      )}
    >
      <span className="text-right text-faint select-none">{lineNumber}</span>
      <span className="text-faint select-none">{formatTime(log.createdAt)}</span>
      <span className="break-words whitespace-pre-wrap">{stripAnsi(log.message)}</span>
    </div>
  );
}
