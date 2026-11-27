import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { logout, useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { Wordmark } from "./Logo";
import {
  Button,
  GridIcon,
  LinkIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  UserMark,
  XIcon,
  cx,
} from "./ui";

const navClass =
  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors " +
  "hover:bg-raised hover:text-fg data-[status=active]:bg-raised data-[status=active]:text-fg";

export function AppLayout() {
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // The drawer closes whenever navigation happens.
  useEffect(() => setMenuOpen(false), [pathname]);

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    queryClient.clear();
    await navigate({ to: "/login", search: { redirect: undefined } });
  };

  const displayName = session.user?.name || session.user?.email || "Account";

  return (
    <div className="min-h-full">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
        <Link to="/">
          <Wordmark />
        </Link>
        <Button variant="ghost" aria-label="Open menu" onClick={() => setMenuOpen(true)} className="px-2">
          <MenuIcon className="size-5" />
        </Button>
      </header>

      {menuOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface px-3 py-4 transition-transform duration-200 lg:z-20 lg:translate-x-0",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-1.5">
          <Link to="/">
            <Wordmark />
          </Link>
          <Button variant="ghost" size="sm" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="px-1.5 lg:hidden">
            <XIcon className="size-4" />
          </Button>
        </div>

        <Link to="/projects/new" className="mt-6 block">
          <Button className="w-full">
            <PlusIcon /> New project
          </Button>
        </Link>

        <nav className="mt-5 space-y-1" aria-label="Main">
          <Link to="/" activeOptions={{ exact: true }} className={navClass}>
            <GridIcon /> Projects
          </Link>
          <Link to="/settings/integrations" search={{ github: undefined }} className={navClass}>
            <LinkIcon /> Integrations
          </Link>
        </nav>

        <div className="mt-auto space-y-1 border-t border-line pt-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <UserMark name={displayName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              {session.user?.name && <p className="truncate text-xs text-muted">{session.user.email}</p>}
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={toggleTheme} className="flex-1">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="flex-1">
              <LogoutIcon /> Log out
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 lg:pl-64">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
