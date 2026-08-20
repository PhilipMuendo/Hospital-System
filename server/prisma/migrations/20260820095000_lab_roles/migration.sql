-- Split from the lab/eMAR migration: PostgreSQL will not use a newly added
-- enum value inside the transaction that adds it, and Prisma runs each
-- migration in its own transaction.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LAB_TECH';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'RADIOGRAPHER';
