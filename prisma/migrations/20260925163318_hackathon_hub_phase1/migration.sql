-- AlterTable: Hub Phase 1 columns on opportunities (all nullable/defaulted,
-- zero-backfill safe). Recreated under its original applied name so migration
-- history stays consistent with databases that already applied it.
ALTER TABLE `opportunities` ADD COLUMN `mode` VARCHAR(191) NULL,
    ADD COLUMN `venue` VARCHAR(191) NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `state` VARCHAR(191) NULL,
    ADD COLUMN `startDate` DATETIME(3) NULL,
    ADD COLUMN `endDate` DATETIME(3) NULL,
    ADD COLUMN `teamMin` INTEGER NULL,
    ADD COLUMN `teamMax` INTEGER NULL,
    ADD COLUMN `sourceUrl` TEXT NULL,
    ADD COLUMN `sourceType` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    ADD COLUMN `verificationStatus` VARCHAR(191) NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN `lastVerifiedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `opportunities_mode_idx` ON `opportunities`(`mode`);

-- CreateIndex
CREATE INDEX `opportunities_city_idx` ON `opportunities`(`city`);

-- CreateIndex
CREATE INDEX `opportunities_verificationStatus_idx` ON `opportunities`(`verificationStatus`);

-- CreateIndex
CREATE INDEX `opportunities_startDate_idx` ON `opportunities`(`startDate`);
