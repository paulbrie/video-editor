import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");

// Reuse one connection pool across hot reloads in dev.
const g = globalThis as unknown as { __cutroomSql?: ReturnType<typeof postgres> };
const sql = g.__cutroomSql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") g.__cutroomSql = sql;

export const db = drizzle(sql, { schema });
export * from "./schema";
