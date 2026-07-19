CREATE OR REPLACE FUNCTION lock_product_tenant_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_id text;
BEGIN
  tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."organizationId" ELSE NEW."organizationId" END;
  PERFORM pg_advisory_xact_lock(hashtextextended(tenant_id, 5));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER products_tenant_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON "products"
FOR EACH ROW EXECUTE FUNCTION lock_product_tenant_write();
