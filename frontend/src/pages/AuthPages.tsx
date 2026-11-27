import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";

import { Wordmark } from "../components/Logo";
import { Button, ErrorBox, Field, Input, PipelineBar } from "../components/ui";
import { login, register } from "../lib/session";
import { useTheme } from "../lib/theme";

// ============================================
// SHELL: form on the left, a build in progress on the right
// ============================================

const SAMPLE_LOG: { stage: string; color: string; text: string }[] = [
  { stage: "clone", color: "var(--h-rust)", text: "Cloning acme/storefront @ main" },
  { stage: "build", color: "var(--h-ember)", text: "npm ci · 312 packages installed" },
  { stage: "build", color: "var(--h-ember)", text: "next build · compiled in 41s" },
  { stage: "deploy", color: "var(--h-amber)", text: "Container started on :3000" },
  { stage: "health", color: "var(--h-gold)", text: "GET / → 200 OK" },
  { stage: "ready", color: "var(--h-cool)", text: "https://6a1f9c0e…yourdomain.dev" },
];

function BrandPanel() {
  return (
    <div
      data-theme="dark"
      className="relative hidden flex-col justify-between overflow-hidden border-l border-line bg-sunken p-12 text-fg lg:flex"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-32 size-[34rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
      />

      <h2 className="relative max-w-md text-[40px] leading-[1.08] font-semibold tracking-[-0.03em]">
        Import a repository. Get a live URL.
      </h2>

      <div className="relative space-y-8">
        <PipelineBar status="READY" durations={{}} animateIn />

        <div className="rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[12.5px] leading-6" aria-hidden="true">
          {SAMPLE_LOG.map((line, index) => (
            <div key={index} className="grid grid-cols-[3.5rem_1fr] gap-3 text-muted">
              <span style={{ color: line.color }}>{line.stage}</span>
              <span className="truncate">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  const [, toggleTheme] = useTheme();

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Wordmark />
          <Button variant="ghost" size="sm" onClick={toggleTheme}>
            Theme
          </Button>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 mb-8 text-sm text-muted">{subtitle}</p>
          {children}
          <p className="mt-8 text-sm text-muted">{footer}</p>
        </div>
      </div>

      <BrandPanel />
    </div>
  );
}

/** Only allow same-site paths as a post-login redirect target. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

// ============================================
// LOGIN
// ============================================

export function LoginPage({ redirect }: { redirect?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await login(email, password);
      router.history.push(safeRedirect(redirect));
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Log in"
      subtitle="Welcome back. Your projects are where you left them."
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-medium text-fg underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={pending} className="w-full">
          Log in
        </Button>
      </form>
    </AuthShell>
  );
}

// ============================================
// REGISTER
// ============================================

export function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await register(name.trim(), email, password);
      await login(email, password);
      router.history.push("/");
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Connect GitHub next, then import your first repository."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" search={{ redirect: undefined }} className="font-medium text-fg underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name (optional)">
          <Input autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={pending} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
