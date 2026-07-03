-- Publish-инварианты (MIGRATION_NOTES п.3): защита от bypass-писателей.
-- Repo и так enforce-ит это в app-слое; триггеры — второй забор на уровне БД.

-- 1. Assignment только для PUBLISHED-версии
CREATE OR REPLACE FUNCTION assert_assignment_published() RETURNS trigger AS $$
BEGIN
  IF (SELECT state FROM planogram_versions WHERE id = NEW."planogramVersionId") IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'planogram assignment requires PUBLISHED version';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_assignment_published
  BEFORE INSERT OR UPDATE ON planogram_assignments
  FOR EACH ROW EXECUTE FUNCTION assert_assignment_published();

-- 2. Task: планограммная задача ссылается только на PUBLISHED; согласованность с assignment
CREATE OR REPLACE FUNCTION assert_task_consistency() RETURNS trigger AS $$
DECLARE
  a_version text; a_store text; a_format text; s_format text;
BEGIN
  IF NEW."planogramVersionId" IS NOT NULL THEN
    IF (SELECT state FROM planogram_versions WHERE id = NEW."planogramVersionId") IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'task must reference PUBLISHED planogram version';
    END IF;
  END IF;
  IF NEW."assignmentId" IS NOT NULL THEN
    SELECT "planogramVersionId", "storeId", "formatId"
      INTO a_version, a_store, a_format
      FROM planogram_assignments WHERE id = NEW."assignmentId";
    IF a_version IS DISTINCT FROM NEW."planogramVersionId" THEN
      RAISE EXCEPTION 'task version does not match assignment version';
    END IF;
    IF a_store IS NOT NULL AND a_store IS DISTINCT FROM NEW."storeId" THEN
      RAISE EXCEPTION 'task store does not match assignment store';
    END IF;
    IF a_format IS NOT NULL THEN
      SELECT "formatId" INTO s_format FROM stores WHERE id = NEW."storeId";
      IF s_format IS DISTINCT FROM a_format THEN
        RAISE EXCEPTION 'task store is not in assignment format';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_task_consistency
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION assert_task_consistency();

-- 3. Версия: PUBLISHED не деградирует обратно в DRAFT
CREATE OR REPLACE FUNCTION assert_version_no_regression() RETURNS trigger AS $$
BEGIN
  IF OLD.state = 'PUBLISHED' AND NEW.state = 'DRAFT' THEN
    RAISE EXCEPTION 'PUBLISHED version cannot regress to DRAFT';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_version_no_regression
  BEFORE UPDATE ON planogram_versions
  FOR EACH ROW EXECUTE FUNCTION assert_version_no_regression();

-- 4. Контент опубликованной версии неизменяем (INSERT/UPDATE; DELETE оставлен
--    каскадам и app-слою)
CREATE OR REPLACE FUNCTION assert_parent_version_draft() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM planogram_versions WHERE id = NEW."planogramVersionId";
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'planogram version % is not DRAFT — content is immutable', NEW."planogramVersionId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_placement_draft_only
  BEFORE INSERT OR UPDATE ON planogram_placements
  FOR EACH ROW EXECUTE FUNCTION assert_parent_version_draft();
CREATE TRIGGER trg_pequipment_draft_only
  BEFORE INSERT OR UPDATE ON planogram_equipment
  FOR EACH ROW EXECUTE FUNCTION assert_parent_version_draft();
CREATE TRIGGER trg_pzone_draft_only
  BEFORE INSERT OR UPDATE ON planogram_zones
  FOR EACH ROW EXECUTE FUNCTION assert_parent_version_draft();

-- 5. Замороженная геометрия оборудования неизменяема
CREATE OR REPLACE FUNCTION assert_equipment_not_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD."isFrozen" THEN
    IF NEW."isFrozen" = false THEN
      RAISE EXCEPTION 'frozen equipment version cannot be unfrozen';
    END IF;
    IF NEW."widthMm" IS DISTINCT FROM OLD."widthMm"
       OR NEW."heightMm" IS DISTINCT FROM OLD."heightMm"
       OR NEW."depthMm" IS DISTINCT FROM OLD."depthMm" THEN
      RAISE EXCEPTION 'frozen equipment geometry is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_equipment_frozen
  BEFORE UPDATE ON equipment_versions
  FOR EACH ROW EXECUTE FUNCTION assert_equipment_not_frozen();

CREATE OR REPLACE FUNCTION assert_shelf_version_not_frozen() RETURNS trigger AS $$
DECLARE frozen boolean;
BEGIN
  SELECT "isFrozen" INTO frozen FROM equipment_versions
    WHERE id = COALESCE(NEW."equipmentVersionId", OLD."equipmentVersionId");
  IF frozen THEN
    RAISE EXCEPTION 'shelves of a frozen equipment version are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_shelf_frozen
  BEFORE INSERT OR UPDATE ON equipment_shelves
  FOR EACH ROW EXECUTE FUNCTION assert_shelf_version_not_frozen();
