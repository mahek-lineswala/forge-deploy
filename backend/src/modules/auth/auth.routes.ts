
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/app-error.js";

import {
  ACCESS_TOKEN_TTL,
  createRefreshSession,
  getCurrentUser,
  loginUser,
  registerUser,
  revokeRefreshSession,
  rotateRefreshSession,
} from "./auth.service.js";

import {
  loginBodySchema,
  loginBodyJsonSchema,
  meResponseSchema,
  registerBodySchema,
  registerBodyJsonSchema,
  registerResponseSchema,
  sessionResponseSchema,
} from "./auth.schema.js";

const REFRESH_COOKIE = "refresh_token";
const COOKIE_PATH = "/api/auth";
const TRUSTED_ORIGIN = new URL(env.FRONTEND_URL).origin;

const strictRateLimit = {
  rateLimit: { max: 10, timeWindow: "1 minute" },
};

function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
}

function assertTrustedOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;

  if (origin && origin !== TRUSTED_ORIGIN) {
    throw new AppError(403, "Untrusted origin");
  }
}

export async function authRoutes(app: FastifyInstance) {

  // ============================================
  // REGISTER
  // ============================================

  app.post(
    "/register",
    {
      config: strictRateLimit,
      schema: {
        tags: ["Authentication"],
        summary: "Register a new user",
        description: "Create a ForgeDeploy account using an email and password.",
        body: registerBodyJsonSchema,
        response: registerResponseSchema,
      },
    },
    async (request, reply) => {
      const body = registerBodySchema.parse(request.body);
      const user = await registerUser(body);

      return reply.status(201).send({
        success: true,
        message: "Account created",
        data: { user },
      });
    }
  );

  // ============================================
  // LOGIN
  // ============================================

  app.post(
    "/login",
    {
      config: strictRateLimit,
      schema: {
        tags: ["Authentication"],
        summary: "Login",
        description: "Authenticate a user and receive an access token. A refresh token is set in an HTTP-only cookie.",
        body: loginBodyJsonSchema,
        response: sessionResponseSchema,
      },
    },
    async (request, reply) => {
      const body = loginBodySchema.parse(request.body);
      const user = await loginUser(body);

      const session = await createRefreshSession(user.id);
      setRefreshCookie(reply, session.token, session.expiresAt);

      const accessToken = app.jwt.sign(
        { sub: user.id },
        { expiresIn: ACCESS_TOKEN_TTL }
      );

      return reply.status(200).send({
        success: true,
        message: "Logged in",
        data: { user, accessToken },
      });
    }
  );

  // ============================================
  // REFRESH TOKEN
  // ============================================

  app.post(
    "/refresh",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Refresh access token",
        description: "Uses the refresh_token HTTP-only cookie to rotate the refresh session and issue a new access token.",
        response: sessionResponseSchema,
      },
    },
    async (request, reply) => {
      assertTrustedOrigin(request);

      const rawToken = request.cookies[REFRESH_COOKIE];

      try {
        if (!rawToken) {
          throw new AppError(401, "Invalid or expired session");
        }

        const { user, token, expiresAt } =
          await rotateRefreshSession(rawToken);

        setRefreshCookie(reply, token, expiresAt);

        const accessToken = app.jwt.sign(
          { sub: user.id },
          { expiresIn: ACCESS_TOKEN_TTL }
        );

        return reply.status(200).send({
          success: true,
          message: "Session refreshed",
          data: { user, accessToken },
        });
      } catch (error) {
        if (error instanceof AppError) {
          clearRefreshCookie(reply);

          return reply
            .status(401)
            .send({ success: false, message: error.message });
        }

        throw error;
      }
    }
  );

  // ============================================
  // LOGOUT
  // ============================================

  app.post(
    "/logout",
    {
      schema: {
        tags: ["Authentication"],
        summary: "Logout",
        description: "Revokes the current refresh session and clears the refresh cookie.",
      },
    },
    async (request, reply) => {
      assertTrustedOrigin(request);

      const rawToken = request.cookies[REFRESH_COOKIE];

      if (rawToken) {
        await revokeRefreshSession(rawToken);
      }

      clearRefreshCookie(reply);

      return reply.status(200).send({
        success: true,
        message: "Logged out",
      });
    }
  );

  // ============================================
  // CURRENT USER
  // ============================================

  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["Authentication"],
        summary: "Get current user",
        description: "Returns the currently authenticated user's profile.",
        security: [{ bearerAuth: [] }],
        response: meResponseSchema,
      },
    },
    async (request, reply) => {
      const user = await getCurrentUser(request.user.sub);

      if (!user) {
        throw new AppError(401, "Unauthorized");
      }

      return reply.status(200).send({
        success: true,
        data: { user },
      });
    }
  );
}
