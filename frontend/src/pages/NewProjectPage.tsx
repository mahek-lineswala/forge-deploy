import { useMemo, useState, type FormEvent } from "react";
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
} from "../components/ui";
import { apiData } from "../lib/api";
import { timeAgo } from "../lib/format";
import {
  useConnectGitHub,
  useCreateProject,
  useGitHubAccount,
  useGitHubRepositories,
} from "../lib/queries";
import type { GitHubRepository, ProjectFramework } from "../lib/types";

const PER_PAGE = 30;

export function NewProjectPage() {
  const account = useGitHubAccount();
  const connect = useConnectGitHub();
  const [selected, setSelected] = useState<GitHubRepository | null>(null);

  if (account.isPending) return <Loading />;

  if (!account.data) {
    return (
      <>
        <PageHeader title="Import repository" />
        <ErrorBox error={account.error} />
        <EmptyState
          title="Connect GitHub first"
          description="ForgeDeploy needs access to your repositories to clone and build them."
          action={
            <Button loading={connect.isPending} onClick={() => connect.mutate()}>
              Connect GitHub
            </Button>
          }
        />
      </>
    );
  }

  return selected ? (
    <ConfigureProject repository={selected} onBack={() => setSelected(null)} />
  ) : (
    <RepositoryPicker onSelect={setSelected} />
  );
}

// ============================================
// STEP 1: PICK A REPOSITORY
// ============================================

function RepositoryPicker({ onSelect }: { onSelect: (repo: GitHubRepository) => void }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const repos = useGitHubRepositories(page, true);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (repos.data ?? []).filter((repo) => !term || repo.fullName.toLowerCase().includes(term));
  }, [repos.data, filter]);

  return (
    <>
      <PageHeader
        title="Import repository"
        description="Pick a repository. Static Vite, Create React App, Vue and Angular projects are supported."
        actions={
          <Link to="/">
            <Button variant="ghost">Cancel</Button>
          </Link>
        }
      />

      <Card>
        <div className="border-b border-zinc-800 p-4">
          <Input placeholder="Filter this page…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>

        {repos.isPending && <div className="px-4"><Loading /></div>}
        <div className="p-4 empty:hidden">
          <ErrorBox error={repos.error} />
        </div>

        <ul className="divide-y divide-zinc-800">
          {visible.map((repo) => (
            <li key={repo.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {repo.fullName}
                  {repo.private && (
                    <span className="ml-2 rounded border border-zinc-700 px-1.5 py-0.5 text-xs font-normal text-zinc-400">
                      private
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {[repo.language, `updated ${timeAgo(repo.updatedAt)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button variant="secondary" onClick={() => onSelect(repo)}>
                Import
              </Button>
            </li>
          ))}
        </ul>

        {repos.data && visible.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No repositories on this page match.</p>
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 p-4 text-sm text-zinc-400">
          <span>Page {page}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={(repos.data?.length ?? 0) < PER_PAGE || repos.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

// ============================================
// STEP 2: CONFIGURE AND CREATE
// ============================================

function ConfigureProject({ repository, onBack }: { repository: GitHubRepository; onBack: () => void }) {
  const navigate = useNavigate();
  const createProject = useCreateProject();

  const [name, setName] = useState(repository.name);
  const [branch, setBranch] = useState(repository.defaultBranch);
  const [rootDir, setRootDir] = useState(".");
  const [framework, setFramework] = useState<"" | ProjectFramework>("");
  const [buildCommand, setBuildCommand] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [deployNow, setDeployNow] = useState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const project = await createProject.mutateAsync({
      name: name.trim(),
      repository: repository.fullName,
      repositoryId: String(repository.id),
      branch: branch.trim(),
      rootDir: rootDir.trim() || ".",
      framework: framework || null,
      buildCommand: buildCommand.trim() || null,
      outputDir: outputDir.trim() || null,
    });

    if (deployNow) {
      try {
        const { deployment } = await apiData<{ deployment: { id: string } }>(
          `/projects/${project.id}/deployments`,
          { method: "POST", body: {} },
        );

        await navigate({ to: "/deployments/$deploymentId", params: { deploymentId: deployment.id } });
        return;
      } catch {
        // The project exists; fall through to its page, where Deploy shows the error.
      }
    }

    await navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { tab: undefined } });
  };

  return (
    <>
      <PageHeader
        title="Configure project"
        description={<span className="font-mono">{repository.fullName}</span>}
        actions={
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        }
      />

      <Card className="max-w-2xl p-6">
        <form onSubmit={(e) => void submit(e).catch(() => undefined)} className="space-y-5">
          <Field label="Project name">
            <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Branch" hint="Pushes to this branch deploy (once a webhook is set up).">
              <Input required value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            <Field label="Root directory" hint="Folder containing package.json.">
              <Input value={rootDir} onChange={(e) => setRootDir(e.target.value)} placeholder="." />
            </Field>
          </div>

          <details className="rounded-md border border-zinc-800 p-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-300">
              Build settings <span className="font-normal text-zinc-500">(auto-detected if empty)</span>
            </summary>
            <div className="mt-4 space-y-4">
              <Field label="Framework">
                <Select value={framework} onChange={(e) => setFramework(e.target.value as "" | ProjectFramework)}>
                  <option value="">Auto-detect</option>
                  <option value="vite">Vite</option>
                </Select>
              </Field>
              <Field label="Build command" hint='Default: "npm run build" (or the pnpm/yarn equivalent).'>
                <Input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} placeholder="npm run build" />
              </Field>
              <Field label="Output directory" hint="Default depends on the framework, e.g. dist for Vite.">
                <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" />
              </Field>
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={deployNow} onChange={(e) => setDeployNow(e.target.checked)} />
            Deploy immediately
          </label>

          <ErrorBox error={createProject.error} />

          <Button type="submit" loading={createProject.isPending}>
            Create project
          </Button>
        </form>
      </Card>
    </>
  );
}
