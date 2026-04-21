-- AlterTable: add new boolean column with default, then backfill from existing playbackMode.
ALTER TABLE "Room" ADD COLUMN "syncPlayback" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Room" SET "syncPlayback" = true WHERE "playbackMode" = 'SYNC';

ALTER TABLE "Room" DROP COLUMN "playbackMode";

-- DropEnum
DROP TYPE "PlaybackMode";
