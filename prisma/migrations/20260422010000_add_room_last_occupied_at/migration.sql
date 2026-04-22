-- AlterTable
ALTER TABLE "Room" ADD COLUMN "lastOccupiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Room_lastOccupiedAt_idx" ON "Room"("lastOccupiedAt");
