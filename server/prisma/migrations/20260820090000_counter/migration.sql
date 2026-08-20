-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);


-- Seed the counters from data that already exists, otherwise the first
-- allocation after this migration hands out 1 and collides with the rows
-- created before the sequence existed.

-- Visit numbers look like OPD/2026/08/0007; key on "visit:YYYY-MM".
INSERT INTO "Counter" ("key", "value")
SELECT
  'visit:' || split_part("visitNumber", '/', 2) || '-' || split_part("visitNumber", '/', 3),
  MAX(split_part("visitNumber", '/', 4)::int)
FROM "Visit"
WHERE "visitNumber" LIKE 'OPD/%/%/%'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", EXCLUDED."value");

-- Ticket numbers are per station per service day.
INSERT INTO "Counter" ("key", "value")
SELECT 'ticket:' || "stationId" || ':' || "serviceDate", MAX("number")
FROM "QueueTicket"
GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", EXCLUDED."value");

-- Outpatient numbers look like OP/2026/00042; key on "patient:YYYY".
INSERT INTO "Counter" ("key", "value")
SELECT 'patient:' || split_part("opNumber", '/', 2),
       MAX(split_part("opNumber", '/', 3)::int)
FROM "Patient"
WHERE "opNumber" LIKE 'OP/%/%'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", EXCLUDED."value");
