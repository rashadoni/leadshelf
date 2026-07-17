-- Explicit LeadDrive-agent -> LeadShelf-user mapping for the unified Field BFF.
-- Mobile devices keep one LeadDrive session; LeadShelf is reached only through
-- authenticated server-to-server requests.
CREATE TABLE "federated_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalSubject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "federated_identities_organizationId_provider_externalSubject_key"
ON "federated_identities"("organizationId", "provider", "externalSubject");

CREATE UNIQUE INDEX "federated_identities_userId_provider_key"
ON "federated_identities"("userId", "provider");

CREATE INDEX "federated_identities_organizationId_userId_idx"
ON "federated_identities"("organizationId", "userId");

ALTER TABLE "federated_identities"
ADD CONSTRAINT "federated_identities_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "federated_identities"
ADD CONSTRAINT "federated_identities_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
