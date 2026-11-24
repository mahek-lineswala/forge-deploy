import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Card, ErrorBox, Loading, PageHeader } from "../components/ui";
import { timeAgo } from "../lib/format";
import { keys, useConnectGitHub, useDisconnectGitHub, useGitHubAccount } from "../lib/queries";

/** The backend's OAuth callback redirects here with ?github=success|error. */
export function IntegrationsPage({ github }: { github?: "success" | "error" }) {
  const queryClient = useQueryClient();
  const account = useGitHubAccount();
  const connect = useConnectGitHub();
  const disconnect = useDisconnectGitHub();

  useEffect(() => {
    if (github === "success") {
      void queryClient.invalidateQueries({ queryKey: keys.githubAccount });
    }
  }, [github, queryClient]);

  return (
    <>
      <PageHeader title="Integrations" description="Connect the accounts ForgeDeploy deploys from." />

      {github === "success" && (
        <div className="mb-6 rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          GitHub connected.
        </div>
      )}
      {github === "error" && (
        <div className="mb-6 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          GitHub connection failed. Try again.
        </div>
      )}

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {account.data?.avatarUrl ? (
              <img src={account.data.avatarUrl} alt="" className="size-10 rounded-full" />
            ) : (
              <div className="grid size-10 place-items-center rounded-full bg-zinc-800 text-sm font-semibold">GH</div>
            )}
            <div>
              <p className="font-medium">GitHub</p>
              {account.isPending ? (
                <Loading label="Checking…" />
              ) : account.data ? (
                <p className="text-sm text-zinc-400">
                  Connected as <span className="text-zinc-200">@{account.data.githubUsername}</span> ·{" "}
                  {timeAgo(account.data.connectedAt)}
                </p>
              ) : (
                <p className="text-sm text-zinc-400">Not connected. Required to import and clone repositories.</p>
              )}
            </div>
          </div>

          {account.data ? (
            <div className="flex gap-2">
              <Button variant="secondary" loading={connect.isPending} onClick={() => connect.mutate()}>
                Reconnect
              </Button>
              <Button
                variant="danger"
                loading={disconnect.isPending}
                onClick={() => {
                  if (confirm("Disconnect GitHub? Deployments will fail to clone until you reconnect.")) {
                    disconnect.mutate();
                  }
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            !account.isPending && (
              <Button loading={connect.isPending} onClick={() => connect.mutate()}>
                Connect GitHub
              </Button>
            )
          )}
        </div>

        <div className="mt-4 space-y-2">
          <ErrorBox error={account.error} />
          <ErrorBox error={connect.error} />
          <ErrorBox error={disconnect.error} />
        </div>
      </Card>
    </>
  );
}
