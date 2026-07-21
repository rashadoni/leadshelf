-- Authentication normalizes organization slugs, office emails and employee
-- codes case-insensitively. Enforce that semantic in PostgreSQL so two rows
-- cannot become the same login principal after normalization.
BEGIN;

LOCK TABLE "organizations", "users" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "organizations" GROUP BY LOWER("slug") HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'case-insensitive organization slug collision exists; run approved identity remediation before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "email" IS NOT NULL
    GROUP BY "organizationId", LOWER("email")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'case-insensitive office email collision exists; run approved identity remediation before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "employeeCode" IS NOT NULL
    GROUP BY "organizationId", LOWER("employeeCode")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'case-insensitive employee code collision exists; run approved identity remediation before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "organizations_slug_ci_unique"
  ON "organizations" (LOWER("slug"));

CREATE UNIQUE INDEX "users_organization_email_ci_unique"
  ON "users" ("organizationId", LOWER("email"))
  WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "users_organization_employee_code_ci_unique"
  ON "users" ("organizationId", LOWER("employeeCode"))
  WHERE "employeeCode" IS NOT NULL;

COMMIT;
