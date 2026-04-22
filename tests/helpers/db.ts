import { prisma } from "@/lib/prisma";

function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\bjukebox_test\b/.test(url)) {
    throw new Error(
      `resetDatabase() refused to TRUNCATE: DATABASE_URL=${url || "(unset)"} does not target jukebox_test`,
    );
  }
}

export async function resetDatabase() {
  assertTestDatabase();
  // Track -> Room -> User の順に CASCADE で消す。RESTART IDENTITY で autoincrement を初期化。
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Track", "Room", "User" RESTART IDENTITY CASCADE',
  );
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
