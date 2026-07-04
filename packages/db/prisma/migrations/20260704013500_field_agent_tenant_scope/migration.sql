ALTER TABLE "field_agents" ADD COLUMN "organizationId" TEXT;

UPDATE "field_agents" AS fa
SET "organizationId" = u."organizationId"
FROM "users" AS u
WHERE fa."userId" = u."id";

ALTER TABLE "field_agents" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "field_agents_organizationId_teamId_idx"
  ON "field_agents"("organizationId", "teamId");

ALTER TABLE "field_agents"
  ADD CONSTRAINT "field_agents_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
