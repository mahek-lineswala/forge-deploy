import { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, apiData } from "./api";
import {
  isActiveStatus,
  type Deployment,
  type DeploymentLog,
  type DeploymentLogsPage,
  type DeploymentStatus,
  type EnvironmentVariable,
  type GitHubAccount,
  type GitHubRepository,
  type Project,
  type ProjectInput,
} from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const keys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  deployments: (projectId: string) => ["projects", projectId, "deployments"] as const,
  deployment: (id: string) => ["deployments", id] as const,
  envVars: (projectId: string) => ["projects", projectId, "env"] as const,
  githubAccount: ["github", "account"] as const,
  githubRepos: (page: number) => ["github", "repos", page] as const,
};

// ============================================
// PROJECTS
// ============================================

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => apiData<{ projects: Project[] }>("/projects").then((d) => d.projects),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => apiData<{ project: Project }>(`/projects/${id}`).then((d) => d.project),
  });
}

export function useCreateProject() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: ProjectInput) =>
      apiData<{ project: Project }>("/projects", { method: "POST", body: input }).then(
        (d) => d.project,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateProject(id: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<ProjectInput>) =>
      apiData<{ project: Project }>(`/projects/${id}`, { method: "PATCH", body: input }).then(
        (d) => d.project,
      ),
    onSuccess: (project) => {
      client.setQueryData(keys.project(id), project);
      void client.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}

export function useDeleteProject(id: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => apiData(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.removeQueries({ queryKey: keys.project(id) });
      void client.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}

// ============================================
// DEPLOYMENTS
// ============================================

export function useDeployments(projectId: string) {
  return useQuery({
    queryKey: keys.deployments(projectId),
    queryFn: () =>
      apiData<{ deployments: Deployment[] }>(`/projects/${projectId}/deployments`).then(
        (d) => d.deployments,
      ),
    // Poll only while something is in progress.
    refetchInterval: (query) =>
      query.state.data?.some((d) => isActiveStatus(d.status)) ? 3_000 : false,
  });
}

export function useDeployment(id: string) {
  return useQuery({
    queryKey: keys.deployment(id),
    queryFn: () =>
      apiData<{ deployment: Deployment }>(`/deployments/${id}`).then((d) => d.deployment),
    refetchInterval: (query) =>
      query.state.data && isActiveStatus(query.state.data.status) ? 2_000 : false,
  });
}

export function useCreateDeployment(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiData<{ deployment: Deployment }>(`/projects/${projectId}/deployments`, {
        method: "POST",
        body: {},
      }).then((d) => d.deployment),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.deployments(projectId) }),
  });
}

export function useCancelDeployment(deployment: Pick<Deployment, "id" | "projectId">) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiData<{ deployment: Deployment }>(`/deployments/${deployment.id}/cancel`, {
        method: "POST",
      }).then((d) => d.deployment),
    onSuccess: (updated) => {
      client.setQueryData(keys.deployment(deployment.id), updated);
      void client.invalidateQueries({ queryKey: keys.deployments(deployment.projectId) });
    },
  });
}

/**
 * Follows a deployment's logs: fetches pages with the backend cursor until
 * the deployment is finished, polling every 2 s while it is still running.
 */
export function useDeploymentLogs(deploymentId: string) {
  const [logs, setLogs] = useState<DeploymentLog[]>([]);
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cursor = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    cursor.current = null;
    setLogs([]);
    setStatus(null);
    setFinished(false);
    setError(null);

    const poll = async () => {
      try {
        const params = new URLSearchParams({ limit: "500" });
        if (cursor.current) params.set("after", cursor.current);

        const page = await apiData<DeploymentLogsPage>(
          `/deployments/${deploymentId}/logs?${params}`,
          { signal: controller.signal },
        );

        if (page.logs.length > 0) {
          setLogs((previous) => [...previous, ...page.logs]);
        }

        cursor.current = page.nextCursor;
        setStatus(page.status);
        setError(null);

        if (page.finished) {
          setFinished(true);
          return;
        }

        // A full page means more is already waiting: fetch it right away.
        timer = setTimeout(poll, page.logs.length >= 500 ? 0 : 2_000);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught);
        timer = setTimeout(poll, 5_000);
      }
    };

    void poll();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [deploymentId]);

  return { logs, status, finished, error };
}

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

export function useEnvVars(projectId: string) {
  return useQuery({
    queryKey: keys.envVars(projectId),
    queryFn: () =>
      apiData<{ environmentVariables: EnvironmentVariable[] }>(
        `/projects/${projectId}/environment-variables`,
      ).then((d) => d.environmentVariables),
  });
}

export function useSaveEnvVar(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value, exists }: { key: string; value: string; exists: boolean }) =>
      exists
        ? apiData(`/projects/${projectId}/environment-variables/${encodeURIComponent(key)}`, {
            method: "PATCH",
            body: { value },
          })
        : apiData(`/projects/${projectId}/environment-variables`, {
            method: "POST",
            body: { key, value },
          }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.envVars(projectId) }),
  });
}

export function useDeleteEnvVar(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (key: string) =>
      apiData(`/projects/${projectId}/environment-variables/${encodeURIComponent(key)}`, {
        method: "DELETE",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.envVars(projectId) }),
  });
}

// ============================================
// GITHUB
// ============================================

/** null = not connected (the backend answers 404). */
export function useGitHubAccount() {
  return useQuery({
    queryKey: keys.githubAccount,
    queryFn: async () => {
      try {
        return await apiData<{ account: GitHubAccount }>("/github/account").then(
          (d) => d.account,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useGitHubRepositories(page: number, enabled: boolean) {
  return useQuery({
    queryKey: keys.githubRepos(page),
    queryFn: () =>
      apiData<{ repositories: GitHubRepository[] }>(
        `/github/repositories?page=${page}&perPage=30`,
      ).then((d) => d.repositories),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useConnectGitHub() {
  return useMutation({
    mutationFn: () =>
      apiData<{ authorizationUrl: string }>("/github/connect").then((d) => d.authorizationUrl),
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

export function useDisconnectGitHub() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => apiData("/github/connection", { method: "DELETE" }),
    onSuccess: () => {
      client.setQueryData(keys.githubAccount, null);
      client.removeQueries({ queryKey: ["github", "repos"] });
    },
  });
}
