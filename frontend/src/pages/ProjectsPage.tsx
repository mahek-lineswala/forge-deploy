import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import {
  Badge,
  BranchIcon,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  GlobeIcon,
  GridIcon,
  HeatBar,
  Input,
  PageHeader,
  PlusIcon,
  ProjectMark,
  SearchIcon,
  Skeleton,
  StatusBadge,
} from "../components/ui";
import { liveUrl } from "../lib/domain";
import { timeAgo } from "../lib/format";
import { useDeployments, useProjects } from "../lib/queries";
import type { Project } from "../lib/types";

export function ProjectsPage() {
  const projects = useProjects();
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (projects.data ?? []).filter(
      (project) =>
        !term || project.name.toLowerCase().includes(term) || project.repository.toLowerCase().includes(term),
    );
  }, [projects.data, filter]);

  const hasProjects = (projects.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Projects"
        description={hasProjects ? `${projects.data!.length} deployed from GitHub` : "Repositories ForgeDeploy builds and serves."}
        actions={
          <>
            {hasProjects && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
                <Input
                  placeholder="Search projects"
                  aria-label="Search projects"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-56 pl-9"
                />
              </div>
            )}
            <Link to="/projects/new">
              <Button>
                <PlusIcon /> New project
              </Button>
            </Link>
          </>
        }
      />

      {projects.isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}
      <ErrorBox error={projects.error} />

      {projects.data && !hasProjects && (
        <EmptyState
          icon={<GridIcon />}
          title="No projects yet"
          description="Import a GitHub repository and ForgeDeploy builds it, serves it and gives it a URL."
          action={
            <Link to="/projects/new">
              <Button>
                <PlusIcon /> Import a repository
              </Button>
            </Link>
          }
        />
      )}

      {hasProjects && visible.length === 0 && (
        <p className="py-16 text-center text-sm text-muted">No projects match “{filter}”.</p>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const deployments = useDeployments(project.id);
  const latest = deployments.data?.[0];
  const live = deployments.data?.find((d) => d.status === "READY");
  const publicUrl = liveUrl(project, live);

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      search={{ tab: undefined }}
      className="group block min-w-0 rounded-xl focus-visible:outline-offset-4"
    >
      <Card className="flex h-full flex-col gap-5 p-5 transition-[border-color,box-shadow] duration-200 group-hover:border-line-strong group-hover:shadow-[0_18px_44px_-24px_var(--glow)]">
        <div className="flex items-start gap-3.5">
          <ProjectMark name={project.name} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] leading-snug font-semibold tracking-[-0.01em]">{project.name}</h2>
            <p className="truncate font-mono text-xs text-muted">{project.repository}</p>
          </div>
          {project.framework && <Badge>{project.framework}</Badge>}
        </div>

        <div className="min-h-5 text-sm">
          {publicUrl ? (
            <span className="flex items-center gap-1.5 text-muted transition-colors group-hover:text-fg">
              <GlobeIcon className="size-3.5" />
              <span className="truncate">{publicUrl.replace(/^https?:\/\//, "")}</span>
            </span>
          ) : deployments.isPending ? (
            <Skeleton className="h-4 w-2/3" />
          ) : (
            <span className="text-faint">Not deployed yet</span>
          )}
        </div>

        <div className="mt-auto space-y-3">
          {latest ? (
            <>
              <HeatBar status={latest.status} />
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <StatusBadge status={latest.status} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <BranchIcon className="size-3.5" />
                  <span className="truncate">{project.branch}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{timeAgo(latest.createdAt)}</span>
                </span>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <BranchIcon className="size-3.5" /> {project.branch} · created {timeAgo(project.createdAt)}
            </p>
          )}
        </div>
      </Card>
    </Link>
  );
}
