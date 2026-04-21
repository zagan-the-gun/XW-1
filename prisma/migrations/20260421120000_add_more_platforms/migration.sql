-- AlterEnum
-- PostgreSQL 12+ supports `ALTER TYPE ... ADD VALUE` inside a migration
-- transaction, so no special handling is required here.
ALTER TYPE "Platform" ADD VALUE 'VIMEO';
ALTER TYPE "Platform" ADD VALUE 'WISTIA';
