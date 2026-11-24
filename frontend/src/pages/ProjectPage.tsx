import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  StatusBadge,
  cx,
} from "../components/ui";
import { formatDuration, shortSha, timeAgo } from "../lib/format";
import {
  useCreateDeployment,
  useDeleteEnvVar,
  useDeleteProject,
  useDeployments,
  useEnvVars,
  useProject,
  useSaveEnvVar,
  useUpdateProject,
} from "../lib/queries";
import type { Project, ProjectFramework } from "../lib/types";

export type ProjectTab = "deployments" | "environment" | "settings";

const TABS: { id: ProjectTab; label: string }[] = [
  { id: "deployments", label: "Deployments" },
  { id: "environment", label: "Environment" },
  { id: "settings", label: "Settings" },
];

export function ProjectPage({ projectId, tab = "deployments" }: { projectId: string; tab?: ProjectTab }) {
  const project = useProject(projectId);
  const deployments = useDeployments(projectId);
  const createDeployment = useCreateDeployment(projectId);
  const navigate = useNavigate();

  if (project.isPending) return <Loading />;
  if (project.error) return <ErrorBox error={project.error} />;

  const live = deployments.data?.find((d) => d.status === "READY");

  const deploy = async () => {
    const deployment = await createDeployment.mutateAsync();
    await navigate({ to: "/deployments/$deploymentId", params: { deploymentId: deployment.id } });
  };

  return (
    <>
      <PageHeader
        title={project.data.name}
        description={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a
              href={`https://github.com/${project.data.repository}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-zinc-200"
            >
              {project.data.repository}
            </a>
            <span>·</span>
            <span>{project.data.branch}</span>
            {live?.deploymentUrl && (
              <>
                <span>·</span>
                <a href={live.deploymentUrl} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                  {live.deploymentUrl.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </div>
        }
        actions={
          <Button loading={createDeployment.isPending} onClick={() => void deploy().catch(() => undefined)}>
            Deploy
          </Button>
        }
      />

      <div className="mb-4 empty:hidden">
        <ErrorBox error={createDeployment.error} />
      </div>

      <div className="mb-6 flex gap-1 border-b border-zinc-800">
        {TABS.map((item) => (
          <Link
            key={item.id}
            to="/projects/$projectId"
            params={{ projectId }}
            search={{ tab: item.id === "deployments" ? undefined : item.id }}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === item.id
                ? "border-white text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-200",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {tab === "deployments" && <DeploymentsTab projectId={projectId} />}
      {tab === "environment" && <EnvironmentTab projectId={projectId} />}
      {tab === "settings" && <SettingsTab project={project.data} />}
    </>
  );
}

// ============================================
// DEPLOYMENTS
// ============================================

function DeploymentsTab({ projectId }: { projectId: string }) {
  const deployments = useDeployments(projectId);

  if (deployments.isPending) return <Loading />;
  if (deployments.error) return <ErrorBox error={deployments.error} />;

  if (deployments.data.length === 0) {
    return <EmptyState title="No deployments yet" description="Press Deploy to build the latest commit." />;
  }

  return (
    <Card>
      <ul className="divide-y divide-zinc-800">
        {deployments.data.map((deployment) => (
          <li key={deployment.id}>
            <Link
              to="/deployments/$deploymentId"
              params={{ deploymentId: deployment.id }}
              className="grid grid-cols-[8rem_1fr_auto] items-center gap-4 px-4 py-3 hover:bg-zinc-900"
            >
              <StatusBadge status={deployment.status} />
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {deployment.commitMessage ?? <span className="text-zinc-400">Manual deployment</span>}
                </p>
                <p className="font-mono text-xs text-zinc-500">
                  {shortSha(deployment.commitSha)} · {deployment.id}
                </p>
              </div>
              <div className="text-right text-xs text-zinc-500">
                <p>{timeAgo(deployment.createdAt)}</p>
                {deployment.buildDurationMs != null && <p>build {formatDuration(deployment.buildDurationMs)}</p>}
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

  const existing = new Set(variables.data?.map((v) => v.key));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedKey = key.trim();

    await save.mutateAsync({ key: trimmedKey, value, exists: existing.has(trimmedKey) });
    setKey("");
    setValue("");
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="font-medium">{editing ? `Update ${editing}` : "Add variable"}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Values are encrypted and only available to the build step. Vite exposes variables prefixed{" "}
          <code className="text-zinc-300">VITE_</code> to the browser bundle. Changes apply to the next deployment.
        </p>

        <form onSubmit={(e) => void submit(e).catch(() => undefined)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
          <Input
            placeholder="KEY"
            required
            pattern="[A-Za-z_][A-Za-z0-9_]*"
            title="Letters, numbers and underscores; cannot start with a number"
            className="font-mono"
            value={key}
            readOnly={editing !== null}
            onChange={(e) => setKey(e.target.value)}
          />
          <textarea
            placeholder="value"
            rows={1}
            maxLength={10000}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              {editing || existing.has(key.trim()) ? "Update" : "Add"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setKey("");
                  setValue("");
                }}
              >
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
      <ErrorBox error={variables.error ?? remove.error} />

      {variables.data?.length === 0 && (
        <EmptyState title="No environment variables" description="Add one above, e.g. VITE_API_URL." />
      )}

      {variables.data && variables.data.length > 0 && (
        <Card>
          <ul className="divide-y divide-zinc-800">
            {variables.data.map((variable) => (
              <li key={variable.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{variable.key}</p>
                  <p className="text-xs text-zinc-500">•••••••• · updated {timeAgo(variable.updatedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
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
                    className="hover:text-red-300"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Delete ${variable.key}?`)) remove.mutate(variable.key);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ============================================
// SETTINGS
// ============================================

function SettingsTab({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject(project.id);
  const navigate = useNavigate();

  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch);
  const [rootDir, setRootDir] = useState(project.rootDir);
  const [framework, setFramework] = useState(project.framework ?? "");
  const [buildCommand, setBuildCommand] = useState(project.buildCommand ?? "");
  const [outputDir, setOutputDir] = useState(project.outputDir ?? "");
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);

    await update.mutateAsync({
      name: name.trim(),
      branch: branch.trim(),
      rootDir: rootDir.trim() || ".",
      framework: (framework || null) as ProjectFramework | null,
      buildCommand: buildCommand.trim() || null,
      outputDir: outputDir.trim() || null,
    });

    setSaved(true);
  };

  const deleteProject = async () => {
    const typed = prompt(`Type "${project.name}" to delete this project.`);
    if (typed !== project.name) return;

    await remove.mutateAsync();
    await navigate({ to: "/" });
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
            <Field label="Root directory">
              <Input value={rootDir} onChange={(e) => setRootDir(e.target.value)} />
            </Field>
          </div>
          <Field label="Framework">
            <Select value={framework} onChange={(e) => setFramework(e.target.value)}>
              <option value="">Auto-detect</option>
              <option value="vite">Vite</option>
              {framework && framework !== "vite" && <option value={framework}>{framework}</option>}
            </Select>
          </Field>
          <Field label="Build command" hint="Leave empty to use the package manager's build script.">
            <Input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} placeholder="npm run build" />
          </Field>
          <Field label="Output directory" hint="Leave empty for the framework default.">
            <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" />
          </Field>

          <ErrorBox error={update.error} />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
            {saved && <span className="text-sm text-emerald-300">Saved. Applies to the next deployment.</span>}
          </div>
        </form>
      </Card>

      <Card className="border-red-950 p-6">
        <h2 className="font-medium text-red-200">Delete project</h2>
        <p className="mt-1 text-sm text-zinc-400">Removes the project and its environment variables. This cannot be undone.</p>
        <div className="mt-4 space-y-3">
          <ErrorBox error={remove.error} />
          <Button variant="danger" loading={remove.isPending} onClick={() => void deleteProject().catch(() => undefined)}>
            Delete project
          </Button>
        </div>
      </Card>
    </div>
  );
}
