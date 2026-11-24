import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";

import { Button, ErrorBox, Field, Input } from "../components/ui";
import { login, register } from "../lib/session";

function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-7 place-items-center rounded bg-white text-sm font-bold text-zinc-950">
            F
          </span>
          ForgeDeploy
        </div>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
        <p className="mt-6 text-sm text-zinc-400">{footer}</p>
      </div>
    </div>
  );
}

/** Only allow same-site paths as a post-login redirect target. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

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
      footer={
        <>
          No account?{" "}
          <Link to="/register" className="text-zinc-100 underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
      title="Create account"
      footer={
        <>
          Already registered?{" "}
          <Link to="/login" search={{ redirect: undefined }} className="text-zinc-100 underline-offset-4 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name (optional)">
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
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
