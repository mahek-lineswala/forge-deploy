
import { prisma } from "../../lib/prisma.js";

export async function checkDatabaseConnection(): Promise<boolean> {
  await prisma.$runCommandRaw({ ping: 1 });

  return true;
}
