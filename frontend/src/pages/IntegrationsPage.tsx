import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  Card,
  ConfirmDialog,
  ErrorBox,
  GitHubIcon,
  Notice,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { timeAgo } from "../lib/format";
import { keys, useConnectGitHub, useDisconnectGitHub, useGitHubAccount } from "../lib/queries";

/** The backend's OAuth callback redirects here with ?github=success|error. */
export function IntegrationsPage({ github }: { github?: "success" | "error" }) {
  const queryClient = useQueryClient();
  const account = useGitHubAccount();
  const connect = useConnectGitHub();
  const disconnect = useDisconnectGitHub();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (github === "success") {
      void queryClient.invalidateQueries({ queryKey: keys.githubAccount });
    }
  }, [github, queryClient]);

  return (
    <>
      <PageHeader title="Integrations" description="Connect the accounts ForgeDeploy deploys from." />

      <div className="max-w-3xl space-y-4">
        {github === "success" && <Notice tone="success">GitHub connected.</Notice>}
        {github === "error" && <Notice tone="error">GitHub connection failed. Try again.</Notice>}

        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              {account.data?.avatarUrl ? (
                <img src={account.data.avatarUrl} alt="" className="size-12 rounded-full ring-1 ring-line" />
              ) : (
                <div className="grid size-12 place-items-center rounded-full border border-line bg-raised">
                  <GitHubIcon className="size-6" />
                </div>
              )}

              <div className="min-w-0">
                <p className="text-base font-semibold">GitHub</p>
                {account.isPending ? (
                  <Skeleton className="mt-1.5 h-4 w-56" />
                ) : account.data ? (
                  <p className="text-sm text-muted">
                    Connected as <span className="font-medium text-fg">@{account.data.githubUsername}</span> · {timeAgo(account.data.connectedAt)}
                  </p>
                ) : (
                  <p className="text-sm text-muted">Not connected. Needed to import and clone repositories.</p>
                )}
              </div>
            </div>

            {account.data ? (
              <div className="flex gap-2">
                <Button variant="secondary" loading={connect.isPending} onClick={() => connect.mutate()}>
                  Reconnect
                </Button>
                <Button variant="danger" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              </div>
            ) : (
              !account.isPending && (
                <Button loading={connect.isPending} onClick={() => connect.mutate()}>
                  <GitHubIcon /> Connect GitHub
                </Button>
              )
            )}
          </div>

          <div className="mt-4 space-y-2 empty:hidden">
            <ErrorBox error={account.error} />
            <ErrorBox error={connect.error} />
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Disconnect GitHub?"
        description="Deployments fail to clone until you reconnect."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        error={disconnect.error}
        onClose={() => setConfirming(false)}
        onConfirm={() => disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
