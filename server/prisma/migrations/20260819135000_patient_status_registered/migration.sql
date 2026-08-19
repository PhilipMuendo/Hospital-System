-- Split out from the outpatient-queue migration.
--
-- PostgreSQL refuses to use a newly added enum value inside the same
-- transaction that adds it ("unsafe use of new value"). Prisma runs each
-- migration in its own transaction, so the value is added and committed here
-- and only then used as a column default in the migration that follows.
ALTER TYPE "PatientStatus" ADD VALUE IF NOT EXISTS 'REGISTERED';
