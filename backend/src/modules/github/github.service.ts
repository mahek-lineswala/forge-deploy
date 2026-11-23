
  import {
    createHash,
    randomBytes,
  } from "node:crypto";

  import { prisma } from "../../lib/prisma.js";
  import { AppError } from "../../lib/app-error.js";
  import { encrypt, decrypt } from "../../lib/encryption.js";

  import type { GitHubRepositoriesQuery } from "./github.schema.js";

  // ============================================
  // CONFIGURATION
  // ============================================

  function getGitHubConfig() {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const callbackUrl = process.env.GITHUB_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new AppError(500, "GitHub OAuth is not configured");
    }

    return { clientId, clientSecret, callbackUrl };
  }

  function getFrontendUrl() {
    const url = process.env.FRONTEND_URL;

    if (!url) {
      throw new AppError(500, "Frontend URL is not configured");
    }

    return url.replace(/\/$/, "");
  }

  function hashState(state: string) {
    return createHash("sha256").update(state).digest("hex");
  }

  // ============================================
  // OAUTH INITIATION
  // ============================================

  export async function createGitHubAuthorizationUrl(userId: string) {
    const { clientId, callbackUrl } = getGitHubConfig();

    // Remove expired OAuth states.
    await prisma.gitHubOAuthState.deleteMany({
      where: {
        expiresAt: { lte: new Date() },
      },
    });

    const state = randomBytes(32).toString("hex");
    const stateHash = hashState(state);

    await prisma.gitHubOAuthState.create({
      data: {
        stateHash,
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const authorizationUrl = new URL(
      "https://github.com/login/oauth/authorize"
    );

    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizationUrl.searchParams.set(
      "scope",
      "read:user,user:email,repo"
    );
    authorizationUrl.searchParams.set("state", state);

    return authorizationUrl.toString();
  }

  // ============================================
  // OAUTH CALLBACK
  // ============================================

  interface GitHubTokenResponse {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
  }

  interface GitHubUserResponse {
    id: number;
    login: string;
    avatar_url: string;
  }

  export async function completeGitHubOAuth(
    code: string,
    state: string
  ) {
    const { clientId, clientSecret, callbackUrl } =
      getGitHubConfig();

    const stateHash = hashState(state);

    const storedState = await prisma.gitHubOAuthState.findUnique({
      where: { stateHash },
    });

    if (!storedState || storedState.expiresAt <= new Date()) {
      throw new AppError(400, "Invalid or expired GitHub OAuth state");
    }

    // Consume the state so it cannot be reused.
    const consumedState = await prisma.gitHubOAuthState.deleteMany({
      where: {
        id: storedState.id,
        expiresAt: { gt: new Date() },
      },
    });

    if (consumedState.count !== 1) {
      throw new AppError(400, "GitHub OAuth state has already been used");
    }

    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
      }
    );

    if (!tokenResponse.ok) {
      throw new AppError(502, "GitHub token exchange failed");
    }

    const tokenData =
      (await tokenResponse.json()) as GitHubTokenResponse;

    if (!tokenData.access_token || tokenData.error) {
      throw new AppError(400, "Unable to authorize with GitHub");
    }

    const accessToken = tokenData.access_token;

    // Fetch the authenticated GitHub account.
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ForgeDeploy",
      },
    });

    if (!userResponse.ok) {
      throw new AppError(502, "Unable to retrieve GitHub account");
    }

    const githubUser =
      (await userResponse.json()) as GitHubUserResponse;

    const scopes = tokenData.scope
      ? tokenData.scope.split(",").filter(Boolean)
      : [];

    try {
      await prisma.gitHubConnection.upsert({
        where: {
          userId: storedState.userId,
        },
        create: {
          githubUserId: String(githubUser.id),
          githubUsername: githubUser.login,
          avatarUrl: githubUser.avatar_url,
          encryptedAccessToken: encrypt(accessToken),
          scopes,
          userId: storedState.userId,
        },
        update: {
          githubUserId: String(githubUser.id),
          githubUsername: githubUser.login,
          avatarUrl: githubUser.avatar_url,
          encryptedAccessToken: encrypt(accessToken),
          scopes,
        },
      });
    } catch (error) {
      const prismaError = error as { code?: string };

      if (prismaError.code === "P2002") {
        throw new AppError(
          409,
          "This GitHub account is already connected to another ForgeDeploy user"
        );
      }

      throw error;
    }

    return {
      githubUsername: githubUser.login,
    };
  }

  // ============================================
  // GET CONNECTED ACCOUNT
  // ============================================

  export async function getGitHubAccount(userId: string) {
    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId },
      select: {
        githubUserId: true,
        githubUsername: true,
        avatarUrl: true,
        scopes: true,
        createdAt: true,
      },
    });

    if (!connection) {
      throw new AppError(404, "GitHub account is not connected");
    }

    return {
      githubUserId: connection.githubUserId,
      githubUsername: connection.githubUsername,
      avatarUrl: connection.avatarUrl,
      scopes: connection.scopes,
      connectedAt: connection.createdAt,
    };
  }

  // ============================================
  // GITHUB API HELPER
  // ============================================

  export async function getGitHubAccessToken(userId: string) {
    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId },
      select: {
        encryptedAccessToken: true,
      },
    });

    if (!connection) {
      throw new AppError(404, "GitHub account is not connected");
    }

    return decrypt(connection.encryptedAccessToken);
  }

  // ============================================
  // LIST REPOSITORIES
  // ============================================

  interface GitHubRepositoryResponse {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string;
    language: string | null;
    updated_at: string;
    owner: {
      login: string;
      avatar_url: string;
    };
  }

  export async function listGitHubRepositories(
    userId: string,
    query: GitHubRepositoriesQuery
  ) {
    const accessToken = await getGitHubAccessToken(userId);

    const url = new URL("https://api.github.com/user/repos");

    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    url.searchParams.set("per_page", String(query.perPage));
    url.searchParams.set("page", String(query.page));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ForgeDeploy",
      },
    });

    if (response.status === 401) {
      throw new AppError(
        401,
        "GitHub authorization expired or was revoked. Reconnect your account."
      );
    }

    if (!response.ok) {
      throw new AppError(502, "Unable to fetch GitHub repositories");
    }

    const repositories =
      (await response.json()) as GitHubRepositoryResponse[];

    return {
      repositories: repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        htmlUrl: repository.html_url,
        description: repository.description,
        defaultBranch: repository.default_branch,
        language: repository.language,
        updatedAt: repository.updated_at,
        owner: repository.owner.login,
        ownerAvatarUrl: repository.owner.avatar_url,
      })),
      pagination: {
        page: query.page,
        perPage: query.perPage,
      },
    };
  }

  // ============================================
  // DISCONNECT GITHUB
  // ============================================

  export async function disconnectGitHub(userId: string) {
    const connection = await prisma.gitHubConnection.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!connection) {
      throw new AppError(404, "GitHub account is not connected");
    }

    await prisma.gitHubConnection.delete({
      where: { userId },
    });

    return true;
  }

  // ============================================
  // OAUTH REDIRECT URL
  // ============================================

  export function getGitHubCallbackRedirect(
    result: "success" | "error"
  ) {
    return `${getFrontendUrl()}/settings/integrations?github=${result}`;
  }

