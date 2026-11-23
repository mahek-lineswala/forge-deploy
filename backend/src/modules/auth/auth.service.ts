  import { createHash, randomBytes } from "node:crypto";
  import * as argon2 from "argon2";
  import { Prisma } from "@prisma/client";

  import { prisma } from "../../lib/prisma.js";
  import { AppError } from "../../lib/app-error.js";
  import type { LoginBody, RegisterBody } from "./auth.schema.js";

  export const ACCESS_TOKEN_TTL = "15m";
  export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // Mongo + Prisma: a field that was never written is not matched by `null`,
  // so match both "explicitly null" and "missing".
  const notRevoked: Prisma.RefreshSessionWhereInput = {
    OR: [{ revokedAt: null }, { revokedAt: { isSet: false } }],
  };

  const publicUserSelect = {
    id: true,
    name: true,
    email: true,
    createdAt: true,
  } satisfies Prisma.UserSelect;

  const INVALID_CREDENTIALS = "Invalid email or password";
  const INVALID_SESSION = "Invalid or expired session";

  function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  // Used to keep login timing similar when the email doesn't exist.
  let dummyHash: string | undefined;
  async function getDummyHash(): Promise<string> {
    dummyHash ??= await argon2.hash("forgedeploy-dummy-password", {
      type: argon2.argon2id,
    });
    return dummyHash;
  }

  export async function registerUser(input: RegisterBody) {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    try {
      return await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
        },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(409, "An account with this email already exists");
      }
      throw error;
    }
  }

  export async function loginUser(input: LoginBody) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    const hashToVerify = user?.passwordHash ?? (await getDummyHash());
    const valid = await argon2.verify(hashToVerify, input.password);

    if (!user || !valid) {
      throw new AppError(401, INVALID_CREDENTIALS);
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  export async function createRefreshSession(userId: string) {
    const token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

      await prisma.refreshSession.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt,
        revokedAt: null,
      },
    });

    return { token, expiresAt };
  }

  export async function rotateRefreshSession(rawToken: string) {
    const session = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!session) {
      throw new AppError(401, INVALID_SESSION);
    }

    // A revoked token being presented again suggests it was stolen/replayed:
    // revoke every active session for this user.
    if (session.revokedAt) {
      // in rotateRefreshSession, reuse detection
  await prisma.refreshSession.updateMany({
    where: { userId: session.userId, ...notRevoked },
    data: { revokedAt: new Date() },
  });
      throw new AppError(401, INVALID_SESSION);
    }

    if (session.expiresAt <= new Date()) {
      throw new AppError(401, INVALID_SESSION);
    }

    // Atomically claim the session so only one concurrent request can rotate it.
    const claimed = await prisma.refreshSession.updateMany({
      where: { id: session.id, ...notRevoked },
      data: { revokedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new AppError(401, INVALID_SESSION);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: publicUserSelect,
    });

    if (!user) {
      throw new AppError(401, INVALID_SESSION);
    }

    const next = await createRefreshSession(user.id);

    return { user, ...next };
  }

  export async function revokeRefreshSession(rawToken: string): Promise<void> {
    await prisma.refreshSession.updateMany({
      where: { tokenHash: hashToken(rawToken), ...notRevoked },
      data: { revokedAt: new Date() },
    });
  }

  export async function getCurrentUser(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
  }