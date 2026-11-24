import { Link } from "@tanstack/react-router";

import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useProjects } from "../lib/queries";

export function ProjectsPage() {
  const projects = useProjects();

  return (
    <>
      <PageHeader
        title="Projects"
        description="Repositories ForgeDeploy builds and serves."
        actions={
          <Link to="/projects/new">
            <Button>New project</Button>
          </Link>
        }
      />

      {projects.isPending && <Loading />}
      <ErrorBox error={projects.error} />

      {projects.data?.length === 0 && (
        <EmptyState
          title="No projects yet"
          description="Import a GitHub repository to create your first deployment."
          action={
            <Link to="/projects/new">
              <Button>Import repository</Button>
            </Link>
          }
        />
      )}

      {projects.data && projects.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              search={{ tab: undefined }}
              className="group"
            >
              <Card className="h-full p-5 transition-colors group-hover:border-zinc-600">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="truncate font-medium">{project.name}</h2>
                  {project.framework && (
                    <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">
                      {project.framework}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-zinc-400">{project.repository}</p>
                <p className="mt-4 text-xs text-zinc-500">
                  {project.branch} · updated {timeAgo(project.updatedAt)}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
