
import { FastifyInstance } from "fastify";

import { checkDatabaseConnection } from "./health.service.js";
import { healthResponseSchema } from "./health.schema.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        response: healthResponseSchema
      }
    },
    async (_request, reply) => {
      try {
        await checkDatabaseConnection();

        return reply.status(200).send({
          success: true,
          message: "ForgeDeploy API is running",
          database: "connected",
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        app.log.error(error);

        return reply.status(503).send({
          success: false,
          message: "Database connection failed",
          database: "disconnected"
        });
      }
    }
  );
}
