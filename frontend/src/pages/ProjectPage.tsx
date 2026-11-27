import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  Badge,
  BoltIcon,
  BranchIcon,
  Button,
  Card,
  ConfirmDialog,
  Crumbs,
  EmptyState,
  ErrorBox,
  ExternalIcon,
  Field,
  GitHubIcon,
  GlobeIcon,
  HeatBar,
  Input,
  KeyIcon,
  LayersIcon,
  Loading,
  Notice,
  PageHeader,
  ProjectMark,
  Select,
  SlidersIcon,
  StatusBadge,
  Textarea,
  TrashIcon,
  cx,
} from "../components/ui";
import { aliasUrl, liveUrl } from "../lib/domain";
import { formatDuration, shortSha, timeAgo } from "../lib/format";
import {
  useAutoDeploy,
  useConfig,
  useCreateDeployment,
  useDeleteEnvVar,
  useDeleteProject,
  useDeployments,
  useEnvVars,
  useProject,
  useSaveEnvVar,
  useSetAutoDeploy,
  useUpdateProject,
} from "../lib/queries";
import type { Deployment, Project, ProjectFramework } from "../lib/types";

export type ProjectTab = "deployments" | "environment" | "settings";

const TABS: { id: ProjectTab; label: string; icon: typeof LayersIcon }[] = [
  { id: "deployments", label: "Deployments", icon: LayersIcon },
  { id: "environment", label: "Environment", icon: KeyIcon },
  { id: "settings", label: "Settings", icon: SlidersIcon },
];

const stripScheme = (url: string) => url.replace(/^https?:\/\//, "");

export function ProjectPage({ projectId, tab = "deployments" }: { projectId: string; tab?: ProjectTab }) {
  const project = useProject(projectId);
  const deployments = useDeployments(projectId);
  const createDeployment = useCreateDeployment(projectId);
  const navigate = useNavigate();

  if (project.isPending) return <Loading />;
  if (project.error) return <ErrorBox error={project.error} />;

  const live = deployments.data?.find((d) => d.status === "READY");
  const publicUrl = liveUrl(project.data, live);

  const deploy = async () => {
    const deployment = await createDeployment.mutateAsync();
    await navigate({ to: "/deployments/$deploymentId", params: { deploymentId: deployment.id } });
  };

  return (
    <>
      <Crumbs items={[<Link to="/">Projects</Link>, project.data.name]} />

      <PageHeader
        leading={<ProjectMark name={project.data.name} className="size-14 rounded-2xl" />}
        title={project.data.name}
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={`https://github.com/${project.data.repository}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-fg"
            >
              <GitHubIcon className="size-3.5" /> {project.data.repository}
            </a>
            <span className="inline-flex items-center gap-1.5">
              <BranchIcon className="size-3.5" /> {project.data.branch}
            </span>
            {project.data.framework && <Badge>{project.data.framework}</Badge>}
          </div>
        }
        actions={
          <>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  Visit <ExternalIcon />
                </Button>
              </a>
            )}
            <Button loading={createDeployment.isPending} onClick={() => void deploy().catch(() => undefined)}>
              <BoltIcon /> Deploy
            </Button>
          </>
        }
      />

      <div className="mb-4 empty:hidden">
        <ErrorBox error={createDeployment.error} />
      </div>

      <ProductionCard publicUrl={publicUrl} deployments={deployments.data} loading={deployments.isPending} onDeploy={() => void deploy().catch(() => undefined)} deploying={createDeployment.isPending} />

      <div role="tablist" aria-label="Project sections" className="mt-10 mb-6 flex gap-1 border-b border-line">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <Link
              key={item.id}
              role="tab"
              aria-selected={active}
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ tab: item.id === "deployments" ? undefined : item.id }}
              className={cx(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
              )}
            >
              <item.icon /> {item.label}
            </Link>
          );
        })}
      </div>

      {tab === "deployments" && <DeploymentsTab projectId={projectId} liveId={live?.id} />}
      {tab === "environment" && <EnvironmentTab projectId={projectId} />}
      {tab === "settings" && <SettingsTab project={project.data} />}
    </>
  );
}

// ============================================
// PRODUCTION CARD
// ============================================

function ProductionCard({
  publicUrl,
  deployments,
  loading,
  onDeploy,
  deploying,
}: {
  publicUrl: string | null;
  deployments: Deployment[] | undefined;
  loading: boolean;
  onDeploy: () => void;
  deploying: boolean;
}) {
  if (loading) return null;

  if (!deployments || deployments.length === 0) {
    return (
      <EmptyState
        icon={<BoltIcon />}
        title="Nothing deployed yet"
        description="Deploy builds the latest commit on your branch and gives it a URL."
        action={
          <Button loading={deploying} onClick={onDeploy}>
            <BoltIcon /> Deploy now
          </Button>
        }
      />
    );
  }

  const live = deployments.find((d) => d.status === "READY");
  const latest = deployments[0]!;
  const showLatest = latest.id !== live?.id;

  return (
    <div className="space-y-3">
      {live && (
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted">Production</p>
              <a
                href={publicUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-[-0.01em] hover:underline"
              >
                <GlobeIcon className="size-5 text-cool" />
                <span className="truncate">{publicUrl ? stripScheme(publicUrl) : "—"}</span>
              </a>
              {live.deploymentUrl && publicUrl !== live.deploymentUrl && (
                <p className="mt-1.5 truncate font-mono text-[13px] text-muted">
                  Permanent link: {stripScheme(live.deploymentUrl)}
                </p>
              )}
            </div>
            <StatusBadge status={live.status} />
          </div>

          <HeatBar status={live.status} className="mt-6" />

          <Link
            to="/deployments/$deploymentId"
            params={{ deploymentId: live.id }}
            className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted hover:text-fg"
          >
            <span className="font-mono">{shortSha(live.commitSha)}</span>
            <span className="min-w-0 flex-1 truncate">{live.commitMessage ?? "Manual deployment"}</span>
            <span>
              {timeAgo(live.createdAt)}
              {live.buildDurationMs != null && ` · built in ${formatDuration(live.buildDurationMs)}`}
            </span>
          </Link>
        </Card>
      )}

      {showLatest && (
        <Link to="/deployments/$deploymentId" params={{ deploymentId: latest.id }} className="group block rounded-xl">
          <Card className="space-y-3 p-4 transition-colors group-hover:border-line-strong">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">{live ? "Latest deployment" : "Deployment"}</span>
              <StatusBadge status={latest.status} />
            </div>
            <HeatBar status={latest.status} />
            <p className="truncate text-sm text-muted">
              <span className="font-mono">{shortSha(latest.commitSha)}</span>{" "}
              {latest.commitMessage ?? "Manual deployment"}
            </p>
          </Card>
        </Link>
      )}
    </div>
  );
}

// ============================================
// DEPLOYMENTS
// ============================================

function DeploymentsTab({ projectId, liveId }: { projectId: string; liveId: string | undefined }) {
  const deployments = useDeployments(projectId);

  if (deployments.isPending) return <Loading />;
  if (deployments.error) return <ErrorBox error={deployments.error} />;

  if (deployments.data.length === 0) {
    return <EmptyState title="No deployments yet" description="Press Deploy to build the latest commit." />;
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {deployments.data.map((deployment) => (
          <li key={deployment.id}>
            <Link
              to="/deployments/$deploymentId"
              params={{ deploymentId: deployment.id }}
              className="grid grid-cols-1 items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors hover:bg-raised sm:grid-cols-[7.5rem_minmax(0,1fr)_7rem_auto]"
            >
              <span className="flex">
                <StatusBadge status={deployment.status} />
              </span>

              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">
                    {deployment.commitMessage ?? <span className="text-muted">Manual deployment</span>}
                  </span>
                  {deployment.id === liveId && <Badge className="border-cool/40 text-cool">Production</Badge>}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted">
                  {shortSha(deployment.commitSha)} · {deployment.id}
                </p>
              </div>

              <HeatBar status={deployment.status} className="hidden sm:flex" />

              <div className="text-xs text-muted sm:text-right">
                <p>{timeAgo(deployment.createdAt)}</p>
                {deployment.buildDurationMs != null && <p>{formatDuration(deployment.buildDurationMs)}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

function EnvironmentTab({ projectId }: { projectId: string }) {
  const variables = useEnvVars(projectId);
  const save = useSaveEnvVar(projectId);
  const remove = useDeleteEnvVar(projectId);

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const existing = new Set(variables.data?.map((v) => v.key));

  const reset = () => {
    setKey("");
    setValue("");
    setEditing(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedKey = key.trim();

    await save.mutateAsync({ key: trimmedKey, value, exists: existing.has(trimmedKey) });
    reset();
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-base font-semibold">{editing ? `Update ${editing}` : "Add a variable"}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Values are encrypted and only available while the project builds. Vite exposes variables prefixed with{" "}
          <code className="rounded bg-raised px-1 font-mono text-[13px] text-fg">VITE_</code> to the browser bundle.
          Changes apply to the next deployment.
        </p>

        <form
          onSubmit={(e) => void submit(e).catch(() => undefined)}
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start"
        >
          <Input
            placeholder="KEY"
            aria-label="Variable name"
            required
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            title="Letters, numbers and underscores; cannot start with a number"
            className="font-mono"
            value={key}
            readOnly={editing !== null}
            onChange={(e) => setKey(e.target.value)}
          />
          <Textarea
            placeholder="value"
            aria-label="Variable value"
            rows={1}
            maxLength={10000}
            className="font-mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              {editing || existing.has(key.trim()) ? "Update" : "Add"}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
        <div className="mt-3 empty:hidden">
          <ErrorBox error={save.error} />
        </div>
      </Card>

      {variables.isPending && <Loading />}
      <ErrorBox error={variables.error} />

      {variables.data?.length === 0 && (
        <EmptyState icon={<KeyIcon />} title="No environment variables" description="Add one above, for example VITE_API_URL." />
      )}

      {variables.data && variables.data.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {variables.data.map((variable) => (
              <li key={variable.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{variable.key}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="tracking-widest">••••••••</span> · updated {timeAgo(variable.updatedAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(variable.key);
                      setKey(variable.key);
                      setValue("");
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${variable.key}`}
                    className="hover:text-bad"
                    onClick={() => setToDelete(variable.key)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete ?? "variable"}?`}
        description="Future deployments will build without it. Existing deployments are not affected."
        confirmLabel="Delete variable"
        pending={remove.isPending}
        error={remove.error}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete, { onSuccess: () => setToDelete(null) });
        }}
      />
    </div>
  );
}

// ============================================
// SETTINGS
// ============================================

const FRAMEWORKS: { value: ProjectFramework; label: string }[] = [
  { value: "vite", label: "Vite / static site" },
  { value: "nextjs", label: "Next.js" },
  { value: "node", label: "Node.js server" },
];

function SettingsTab({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject(project.id);
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch);
  const [rootDir, setRootDir] = useState(project.rootDir);
  const [framework, setFramework] = useState(project.framework ?? "");
  const [buildCommand, setBuildCommand] = useState(project.buildCommand ?? "");
  const [startCommand, setStartCommand] = useState(project.startCommand ?? "");
  const [outputDir, setOutputDir] = useState(project.outputDir ?? "");
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isServer = framework === "nextjs" || framework === "node";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);

    await update.mutateAsync({
      name: name.trim(),
      branch: branch.trim(),
      rootDir: rootDir.trim() || ".",
      framework: (framework || null) as ProjectFramework | null,
      buildCommand: buildCommand.trim() || null,
      startCommand: isServer ? startCommand.trim() || null : null,
      outputDir: outputDir.trim() || null,
    });

    setSaved(true);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-6">
        <form onSubmit={(e) => void submit(e).catch(() => undefined)} className="space-y-5">
          <Field label="Project name">
            <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Branch">
              <Input required value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            <Field label="Root directory" hint="Folder containing package.json.">
              <Input value={rootDir} onChange={(e) => setRootDir(e.target.value)} />
            </Field>
          </div>
          <Field label="Framework">
            <Select value={framework} onChange={(e) => setFramework(e.target.value)}>
              <option value="">Auto-detect</option>
              {FRAMEWORKS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
              {framework && !FRAMEWORKS.some((item) => item.value === framework) && (
                <option value={framework}>{framework}</option>
              )}
            </Select>
          </Field>
          <Field label="Build command" hint="Leave empty to use the package manager's build script.">
            <Input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} placeholder="npm run build" />
          </Field>
          {isServer ? (
            <Field label="Start command" hint="Leave empty to use npm start.">
              <Input value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start" />
            </Field>
          ) : (
            <Field label="Output directory" hint="Leave empty for the framework default.">
              <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" />
            </Field>
          )}

          <ErrorBox error={update.error} />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={update.isPending}>
              Save changes
            </Button>
            {saved && <span className="text-sm text-ok">Saved. Applies to the next deployment.</span>}
          </div>
        </form>
      </Card>

      <DomainCard project={project} />

      <AutoDeployCard projectId={project.id} />

      <Card className="border-bad/30 p-6">
        <h2 className="text-base font-semibold text-bad">Delete project</h2>
        <p className="mt-1 text-sm text-muted">
          Takes the site offline and permanently removes the project, every deployment and its logs, the environment
          variables and the GitHub auto-deploy hook. This cannot be undone.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setConfirmingDelete(true)}>
          <TrashIcon /> Delete project
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this project?"
        description="The site goes offline and all of the project's data is deleted: deployments, logs, environment variables and files. This cannot be undone."
        confirmLabel="Delete project"
        confirmText={project.name}
        pending={remove.isPending}
        error={remove.error}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void remove.mutateAsync().then(() => navigate({ to: "/" })).catch(() => undefined)}
      />
    </div>
  );
}

// ============================================
// DOMAIN (custom subdomain)
// ============================================

function DomainCard({ project }: { project: Project }) {
  const config = useConfig();
  const update = useUpdateProject(project.id);
  const [value, setValue] = useState(project.subdomain ?? "");
  const [done, setDone] = useState<"saved" | "removed" | null>(null);

  const domain = config.data?.deploymentDomain;

  // Without a configured deployment domain (local development) there is nothing to attach a name to.
  if (!domain) return null;

  const name = value.trim().toLowerCase();
  const dirty = name !== (project.subdomain ?? "");

  const save = async (next: string | null) => {
    setDone(null);
    await update.mutateAsync({ subdomain: next });

    if (next === null) setValue("");
    setDone(next === null ? "removed" : "saved");
  };

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold">Domain</h2>
      <p className="mt-1 text-sm text-muted">
        Choose the name of your live URL. It always shows your latest successful deployment. Every deployment also keeps
        its own permanent link.
      </p>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name) void save(name).catch(() => undefined);
        }}
      >
        <Field
          label="Subdomain"
          hint="3–40 characters: lowercase letters, numbers and hyphens."
        >
          <div className="flex items-stretch">
            <Input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setDone(null);
              }}
              placeholder="my-project"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={40}
              className="rounded-r-none border-r-0"
            />
            <span className="flex items-center rounded-r-lg border border-line-strong bg-raised px-3 font-mono text-[13px] text-muted">
              .{domain}
            </span>
          </div>
        </Field>

        <ErrorBox error={update.error} />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={update.isPending} disabled={!name || !dirty}>
            Save domain
          </Button>
          {project.subdomain && (
            <Button
              type="button"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => void save(null).catch(() => undefined)}
            >
              Remove
            </Button>
          )}
          {done === "saved" && <span className="text-sm text-ok">Saved. It can take a few seconds to go live.</span>}
          {done === "removed" && <span className="text-sm text-ok">Removed.</span>}
        </div>

        {project.subdomain && (
          <p className="truncate font-mono text-[13px] text-muted">
            Live at{" "}
            <a
              className="text-fg underline-offset-2 hover:underline"
              href={aliasUrl(`https://x.${domain}`, project.subdomain)}
              target="_blank"
              rel="noreferrer"
            >
              {project.subdomain}.{domain}
            </a>
          </p>
        )}
      </form>
    </Card>
  );
}

// ============================================
// AUTO-DEPLOY (GitHub push webhook)
// ============================================

function AutoDeployCard({ projectId }: { projectId: string }) {
  const status = useAutoDeploy(projectId);
  const setAutoDeploy = useSetAutoDeploy(projectId);

  const enabled = status.data?.enabled ?? false;
  const available = status.data?.available ?? true;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Auto-deploy</h2>
            {status.data && <Badge>{enabled ? "On" : "Off"}</Badge>}
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Deploy automatically whenever you push to the project's branch. This adds a webhook to the GitHub repository
            and needs your GitHub account to be connected.
          </p>
        </div>

        {status.data && (
          <Button
            variant={enabled ? "secondary" : "primary"}
            loading={setAutoDeploy.isPending}
            disabled={!enabled && !available}
            onClick={() => void setAutoDeploy.mutateAsync(!enabled).catch(() => undefined)}
          >
            {enabled ? "Turn off" : "Turn on"}
          </Button>
        )}
      </div>

      {status.data && !available && !enabled && (
        <div className="mt-4">
          <Notice tone="info">Auto-deploy is not available: this server has no public webhook URL configured.</Notice>
        </div>
      )}

      <div className="mt-4 empty:hidden">
        <ErrorBox error={status.error ?? setAutoDeploy.error} />
      </div>
    </Card>
  );
}
