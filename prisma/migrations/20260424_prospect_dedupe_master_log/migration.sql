-- Master log for prospect dedupe keys (prevents new duplicates without requiring cleanup first).

DO $$
BEGIN
  CREATE TYPE "ProspectDedupKeyType" AS ENUM ('CLINIC', 'PHONE', 'WEBSITE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "ProspectDedupEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "keyType" "ProspectDedupKeyType" NOT NULL,
  "keyValue" TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectDedupEntry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "ProspectDedupEntry"
    ADD CONSTRAINT "ProspectDedupEntry_prospectId_fkey"
    FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProspectDedupEntry_companyId_keyType_keyValue_key"
  ON "ProspectDedupEntry"("companyId", "keyType", "keyValue");

CREATE INDEX IF NOT EXISTS "ProspectDedupEntry_prospectId_idx"
  ON "ProspectDedupEntry"("prospectId");

CREATE INDEX IF NOT EXISTS "ProspectDedupEntry_companyId_keyType_idx"
  ON "ProspectDedupEntry"("companyId", "keyType");

-- Backfill from existing prospects. Any duplicates will be ignored (first write wins),
-- which lets us enforce "no new duplicates" without blocking deploys.

INSERT INTO "ProspectDedupEntry" ("id", "companyId", "keyType", "keyValue", "prospectId")
SELECT
  CONCAT('pde_', p."id", '_CLINIC'),
  p."companyId",
  'CLINIC'::"ProspectDedupKeyType",
  LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p."name", ''), '^\\[demo\\]\\s*', '', 'i'), '[^a-z0-9]+', '', 'g')),
  p."id"
FROM "Prospect" p
WHERE COALESCE(p."name", '') <> ''
ON CONFLICT ("companyId", "keyType", "keyValue") DO NOTHING;

WITH normalized_phones AS (
  SELECT
    p."id" AS "prospectId",
    p."companyId" AS "companyId",
    CASE
      WHEN p."phone" IS NULL OR BTRIM(p."phone") = '' THEN NULL
      ELSE (
        CASE
          WHEN LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g')) < 10
            OR LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g')) > 15
            THEN NULL
          WHEN LEFT(BTRIM(p."phone"), 1) = '+'
            THEN CONCAT('+', REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'))
          WHEN LEFT(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'), 2) = '00'
            AND LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g')) > 10
            THEN CONCAT('+', SUBSTRING(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g') FROM 3))
          WHEN LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g')) = 10
            THEN CONCAT('+1', REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'))
          WHEN LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g')) = 11
            AND LEFT(REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'), 1) = '1'
            THEN CONCAT('+', REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'))
          ELSE CONCAT('+', REGEXP_REPLACE(REGEXP_REPLACE(p."phone", '\\s*(?:ext\\.?|extension|x)\\s*\\d+.*$', '', 'i'), '\\D', '', 'g'))
        END
      )
    END AS "phoneKey"
  FROM "Prospect" p
)
INSERT INTO "ProspectDedupEntry" ("id", "companyId", "keyType", "keyValue", "prospectId")
SELECT
  CONCAT('pde_', np."prospectId", '_PHONE'),
  np."companyId",
  'PHONE'::"ProspectDedupKeyType",
  np."phoneKey",
  np."prospectId"
FROM normalized_phones np
WHERE np."phoneKey" IS NOT NULL AND np."phoneKey" <> ''
ON CONFLICT ("companyId", "keyType", "keyValue") DO NOTHING;

WITH normalized_websites AS (
  SELECT
    p."id" AS "prospectId",
    p."companyId" AS "companyId",
    NULLIF(
      REGEXP_REPLACE(
        SPLIT_PART(
          SPLIT_PART(
            SPLIT_PART(REGEXP_REPLACE(LOWER(BTRIM(COALESCE(p."website", ''))), '^https?://', ''), '/', 1),
            '?',
            1
          ),
          '#',
          1
        ),
        '^www\\.',
        ''
      ),
      ''
    ) AS "websiteKey"
  FROM "Prospect" p
)
INSERT INTO "ProspectDedupEntry" ("id", "companyId", "keyType", "keyValue", "prospectId")
SELECT
  CONCAT('pde_', nw."prospectId", '_WEBSITE'),
  nw."companyId",
  'WEBSITE'::"ProspectDedupKeyType",
  nw."websiteKey",
  nw."prospectId"
FROM normalized_websites nw
WHERE nw."websiteKey" IS NOT NULL AND nw."websiteKey" <> ''
ON CONFLICT ("companyId", "keyType", "keyValue") DO NOTHING;

