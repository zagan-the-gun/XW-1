import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

// override:true で docker compose の environment (DATABASE_URL) を上書きする。
loadEnv({ path: ".env.test", override: true });

const testUrl = process.env.DATABASE_URL;
if (!testUrl) {
  throw new Error("DATABASE_URL is not set. Check .env.test");
}

// jukebox_test DB を作るために、まず管理用の既存 DB (jukebox) に接続する。
// postgres の CREATE DATABASE は DATABASE_URL の pathname を差し替えるだけで届く。
const adminUrl = new URL(testUrl);
const targetDbName = adminUrl.pathname.replace(/^\//, "");
adminUrl.pathname = `/${process.env.POSTGRES_USER ?? "jukebox"}`;

const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });

async function ensureDatabase() {
  try {
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = '${targetDbName}'`,
    );
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${targetDbName}"`);
      console.log(`Created test database: ${targetDbName}`);
    } else {
      console.log(`Test database already exists: ${targetDbName}`);
    }
  } finally {
    await admin.$disconnect();
  }
}

function runMigrations() {
  // dotenv-cli では既存 env を上書きできないので、明示的に子プロセスの DATABASE_URL を差し替える。
  const result = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl },
    },
  );
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy exited with ${result.status}`);
  }
}

async function main() {
  await ensureDatabase();
  runMigrations();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
