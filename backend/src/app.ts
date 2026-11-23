
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { deploymentQueue } from "./modules/deployments/deployments.queue.js";
import { redis } from "./lib/redis.js";
import { env } from "./config/env.js";
import { AppError } from "./lib/app-error.js";
import { authPlugin } from "./plugins/auth.plugin.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { projectRoutes } from "./modules/projects/projects.routes.js";
import { deploymentsRoutes } from "./modules/deployments/deployments.routes.js";
import { environmentVariableRoutes } from "./modules/environment-variables/environment-variables.routes.js";
import { githubRoutes } from "./modules/github/github.routes.js";
import { githubWebhookRoutes } from "./modules/github/github-webhooks.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "debug" : "info",

      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname",
                singleLine: false
              }
            }
          : undefined
    },

    disableRequestLogging: true
  });

  await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: false,
  runFirst: true,
});

  // Swagger configuration - MUST be registered before API routes
  await app.register(swagger, {
    openapi: {
      info: {
        title: "ForgeDeploy API",
        description: "API documentation for the ForgeDeploy hosting platform.",
        version: "1.0.0"
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Enter your access token."
          }
        }
      },
      tags: [
        { name: "Health", description: "API and database health" },
        { name: "Authentication", description: "User authentication" },
        { name: "Projects", description: "Project management" }
      ]
    }
  });

  // Swagger UI
  await app.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false
    }
  });

  // Custom request logging
  app.addHook("onRequest", async (request) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        requestId: request.id
      },
      "Incoming request"
    );
  });

  // Custom response logging
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime
      },
      "Request completed"
    );
  });

  // Central error handling
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ success: false, message: error.message });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const err = error as Error & { statusCode?: number };

    if (err.statusCode && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ success: false, message: err.message });
    }

    request.log.error(error);

    return reply
      .status(500)
      .send({ success: false, message: "Internal server error" });
  });

  // Security
  await app.register(helmet);

  // CORS
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  // Authentication plugin
  await app.register(authPlugin);

  // API routes
  await app.register(healthRoutes, {
    prefix: "/api"
  });

  await app.register(authRoutes, {
    prefix: "/api/auth"
  });

  await app.register(projectRoutes, {
    prefix: "/api/projects"
  });

  await app.register(deploymentsRoutes, { prefix: "/api" });
await app.register(environmentVariableRoutes, { prefix: "/api" });
await app.register(githubRoutes, { prefix: "/api/github" });
await app.register(githubWebhookRoutes, { prefix: "/api/github" });


  // Root endpoint
  app.get("/", async () => ({
    name: "ForgeDeploy API",
    version: "1.0.0",
    status: "running"
  }));

  // ============================================
// GRACEFUL RESOURCE CLEANUP
// ============================================

app.addHook("onClose", async () => {
  app.log.info("Closing deployment queue...");
  await deploymentQueue.close();

  app.log.info("Closing Redis connection...");
  if (redis.status !== "end") {
    await redis.quit();
  }
});

  return app;
}
