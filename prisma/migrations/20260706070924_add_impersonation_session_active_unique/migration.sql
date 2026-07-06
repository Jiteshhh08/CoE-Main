-- MySQL-compatible partial unique index: at most one ACTIVE session per admin.
-- Uses a virtual generated column that is NULL when status != 'ACTIVE'.
-- MySQL unique indexes treat NULLs as non-duplicate, so only ACTIVE rows are constrained.
ALTER TABLE impersonation_sessions
  ADD COLUMN active_admin_unique INT GENERATED ALWAYS AS (IF(status = 'ACTIVE', adminId, NULL)) VIRTUAL,
  ADD UNIQUE INDEX idx_impersonation_sessions_admin_active (active_admin_unique);