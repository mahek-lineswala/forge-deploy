import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  ArrowLeftIcon,
  Badge,
  BoltIcon,
  Button,
  Card,
  Checkbox,
  Crumbs,
  EmptyState,
  ErrorBox,
  Field,
  GitHubIcon,
  Input,
  LockIcon,
  Loading,
  PageHeader,
  SearchIcon,
  Select,
  Skeleton,
  cx,
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
        <PageHeader title="Import a repository" />
        <ErrorBox error={account.error} />
        <EmptyState
          icon={<GitHubIcon />}
          title="Connect GitHub first"
          description="ForgeDeploy needs access to your repositories to clone and build them."
          action={
            <Button loading={connect.isPending} onClick={() => connect.mutate()}>
              <GitHubIcon /> Connect GitHub
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
      <Crumbs items={[<Link to="/">Projects</Link>, "Import a repository"]} />

      <PageHeader
        title="Import a repository"
        description="Static sites (Vite, React, Vue, Angular), Next.js apps and Node.js servers are supported."
      />

      <Card className="overflow-hidden">
        <div className="border-b border-line p-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Filter repositories on this page"
              aria-label="Filter repositories"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {repos.isPending && (
          <div className="space-y-px">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.25rem] rounded-none" />
            ))}
          </div>
        )}
        <div className="p-4 empty:hidden">
          <ErrorBox error={repos.error} />
        </div>

        <ul className="divide-y divide-line">
          {visible.map((repo) => (
            <li key={repo.id} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-raised">
              <div className="flex min-w-0 items-center gap-3.5">
                <img src={repo.ownerAvatarUrl} alt="" loading="lazy" className="size-9 shrink-0 rounded-full ring-1 ring-line" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    <span className="truncate">{repo.fullName}</span>
                    {repo.private && (
                      <Badge>
                        <LockIcon className="mr-1 size-3" /> Private
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {[repo.language, `updated ${timeAgo(repo.updatedAt)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onSelect(repo)}>
                Import
              </Button>
            </li>
          ))}
        </ul>

        {repos.data && visible.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-muted">No repositories on this page match.</p>
        )}

        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
          <span>Page {page}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
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

const FRAMEWORK_OPTIONS: { value: ProjectFramework; label: string }[] = [
  { value: "vite", label: "Vite / static site" },
  { value: "nextjs", label: "Next.js" },
  { value: "node", label: "Node.js server" },
];

function ConfigureProject({ repository, onBack }: { repository: GitHubRepository; onBack: () => void }) {
  const navigate = useNavigate();
  const createProject = useCreateProject();

  const [name, setName] = useState(repository.name);
  const [branch, setBranch] = useState(repository.defaultBranch);
  const [rootDir, setRootDir] = useState(".");
  const [framework, setFramework] = useState<"" | ProjectFramework>("");
  const [buildCommand, setBuildCommand] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [deployNow, setDeployNow] = useState(true);

  const isServer = framework === "nextjs" || framework === "node";

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
      startCommand: isServer ? startCommand.trim() || null : null,
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
      <Crumbs items={[<Link to="/">Projects</Link>, "Configure project"]} />

      <PageHeader
        title="Configure project"
        description={
          <span className="inline-flex items-center gap-2 font-mono text-[13px]">
            <GitHubIcon className="size-3.5" /> {repository.fullName}
          </span>
        }
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeftIcon /> Choose another
          </Button>
        }
      />

      <Card className="max-w-2xl p-6">
        <form onSubmit={(e) => void submit(e).catch(() => undefined)} className="space-y-5">
          <Field label="Project name">
            <Input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Branch" hint="Pushes to this branch deploy once a webhook is set up.">
              <Input required value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
            <Field label="Root directory" hint="Folder containing package.json.">
              <Input value={rootDir} onChange={(e) => setRootDir(e.target.value)} placeholder="." />
            </Field>
          </div>

          <details className="group rounded-lg border border-line open:bg-raised/40">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
              <span>
                Build settings <span className="font-normal text-muted">· detected automatically when empty</span>
              </span>
              <span className={cx("text-muted transition-transform group-open:rotate-180")}>⌄</span>
            </summary>
            <div className="space-y-4 border-t border-line p-4">
              <Field label="Framework">
                <Select value={framework} onChange={(e) => setFramework(e.target.value as "" | ProjectFramework)}>
                  <option value="">Auto-detect</option>
                  {FRAMEWORK_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Build command" hint="Default: the build script of your package manager.">
                <Input value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} placeholder="npm run build" />
              </Field>
              {isServer ? (
                <Field label="Start command" hint="Default: npm start.">
                  <Input value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start" />
                </Field>
              ) : (
                <Field label="Output directory" hint="Default depends on the framework, for example dist for Vite.">
                  <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" />
                </Field>
              )}
            </div>
          </details>

          <Checkbox label="Deploy right after creating" checked={deployNow} onChange={(e) => setDeployNow(e.target.checked)} />

          <ErrorBox error={createProject.error} />

          <Button type="submit" loading={createProject.isPending}>
            <BoltIcon /> {deployNow ? "Create and deploy" : "Create project"}
          </Button>
        </form>
      </Card>
    </>
  );
}
