import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";

import { env } from "../config/env.js";

export const authPlugin = fp(async (app) => {
  await app.register(cookie);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply
        .status(401)
        .send({ success: false, message: "Unauthorized" });
    }
  });
});