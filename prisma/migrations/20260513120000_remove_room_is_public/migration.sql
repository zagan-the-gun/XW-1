-- Drop the unused isPublic column. The application no longer reads or writes
-- this field; visibility on the homepage list is now decided purely by
-- "passcode IS NULL" (locked rooms are hidden).
ALTER TABLE "Room" DROP COLUMN "isPublic";
