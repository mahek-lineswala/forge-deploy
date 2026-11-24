import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { logout, useSession } from "../lib/session";
import { Button } from "./ui";

export function AppLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: "/login", search: { redirect: undefined } });
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-6 place-items-center rounded bg-white text-xs font-bold text-zinc-950">
              F
            </span>
            ForgeDeploy
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/"
              className="rounded-md px-2.5 py-1.5 text-zinc-400 hover:text-zinc-100"
              activeProps={{ className: "text-zinc-100" }}
              activeOptions={{ exact: true }}
            >
              Projects
            </Link>
            <Link
              to="/settings/integrations"
              search={{ github: undefined }}
              className="rounded-md px-2.5 py-1.5 text-zinc-400 hover:text-zinc-100"
              activeProps={{ className: "text-zinc-100" }}
            >
              Integrations
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-400 sm:inline">
              {session.user?.name || session.user?.email}
            </span>
            <Button variant="ghost" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}
