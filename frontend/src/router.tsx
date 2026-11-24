import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { AppLayout } from "./components/AppLayout";
import { Button, EmptyState } from "./components/ui";
import { queryClient } from "./lib/queries";
import { ensureSession } from "./lib/session";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { DeploymentPage } from "./pages/DeploymentPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectPage, type ProjectTab } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";

// ============================================
// ROOT
// ============================================

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-6 py-24">
      <EmptyState
        title="Page not found"
        action={
          <Link to="/">
            <Button>Back to projects</Button>
          </Link>
        }
      />
    </div>
  ),
});

// ============================================
// PUBLIC (redirect away when already logged in)
// ============================================

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: "/" });
  },
  component: function LoginRoute() {
    const { redirect: target } = loginRoute.useSearch();
    return <LoginPage redirect={target} />;
  },
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  beforeLoad: async () => {
    if (await ensureSession()) throw redirect({ to: "/" });
  },
  component: RegisterPage,
});

// ============================================
// AUTHENTICATED (pathless layout)
// ============================================

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ location }) => {
    if (!(await ensureSession())) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AppLayout,
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: ProjectsPage,
});

const newProjectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/new",
  component: NewProjectPage,
});

const PROJECT_TABS: ProjectTab[] = ["deployments", "environment", "settings"];

const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects/$projectId",
  validateSearch: (search: Record<string, unknown>): { tab?: ProjectTab } => ({
    tab: PROJECT_TABS.includes(search.tab as ProjectTab) ? (search.tab as ProjectTab) : undefined,
  }),
  component: function ProjectRoute() {
    const { projectId } = projectRoute.useParams();
    const { tab } = projectRoute.useSearch();
    // key: reset per-project form state when switching projects.
    return <ProjectPage key={projectId} projectId={projectId} tab={tab} />;
  },
});

const deploymentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/deployments/$deploymentId",
  component: function DeploymentRoute() {
    const { deploymentId } = deploymentRoute.useParams();
    return <DeploymentPage key={deploymentId} deploymentId={deploymentId} />;
  },
});

const integrationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/integrations",
  validateSearch: (search: Record<string, unknown>): { github?: "success" | "error" } => ({
    github: search.github === "success" || search.github === "error" ? search.github : undefined,
  }),
  component: function IntegrationsRoute() {
    const { github } = integrationsRoute.useSearch();
    return <IntegrationsPage github={github} />;
  },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([projectsRoute, newProjectRoute, projectRoute, deploymentRoute, integrationsRoute]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
