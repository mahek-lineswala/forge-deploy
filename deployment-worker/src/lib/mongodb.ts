/**
 * MongoDB client shared by the worker.
 */
import { MongoClient, Db } from "mongodb";
import { env } from "../config/env.js";

const client = new MongoClient(env.DATABASE_URL, {
  maxPoolSize: 10,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 10000,
});

let database: Db | null = null;

export async function connectMongoDB(): Promise<Db> {
  if (database) return database;

  await client.connect();

  database = client.db(env.MONGODB_DATABASE);

  await database.command({ ping: 1 });

  console.log("Worker MongoDB connected.");

  return database;
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error("MongoDB is not connected.");
  }

  return database;
}

export async function disconnectMongoDB(): Promise<void> {
  await client.close();
  database = null;
  console.log("Worker MongoDB disconnected.");
}