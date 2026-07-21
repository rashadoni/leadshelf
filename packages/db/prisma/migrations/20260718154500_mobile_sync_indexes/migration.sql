CREATE INDEX "tasks_organizationId_assigneeId_updatedAt_id_idx"
  ON "tasks"("organizationId", "assigneeId", "updatedAt", "id");

CREATE INDEX "photo_submissions_organizationId_taskId_createdAt_id_idx"
  ON "photo_submissions"("organizationId", "taskId", "createdAt", "id");

CREATE INDEX "routes_organizationId_agentId_isActive_updatedAt_id_idx"
  ON "routes"("organizationId", "agentId", "isActive", "updatedAt", "id");

CREATE INDEX "visits_organizationId_agentId_updatedAt_id_idx"
  ON "visits"("organizationId", "agentId", "updatedAt", "id");
