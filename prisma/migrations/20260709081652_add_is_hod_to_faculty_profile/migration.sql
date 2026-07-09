/*
  Warnings:

  - You are about to drop the column `active_admin_unique` on the `impersonation_sessions` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `idx_impersonation_sessions_admin_active` ON `impersonation_sessions`;

-- AlterTable
ALTER TABLE `faculty_profiles` ADD COLUMN `isHod` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `impersonation_sessions` DROP COLUMN `active_admin_unique`;
