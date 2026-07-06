-- CreateTable
CREATE TABLE `impersonation_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` INTEGER NOT NULL,
    `targetUserId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'ENDED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `durationSeconds` INTEGER NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` TEXT NULL,
    `metadata` JSON NULL,

    INDEX `impersonation_sessions_adminId_status_idx`(`adminId`, `status`),
    INDEX `impersonation_sessions_adminId_startedAt_idx`(`adminId`, `startedAt`),
    INDEX `impersonation_sessions_targetUserId_startedAt_idx`(`targetUserId`, `startedAt`),
    INDEX `impersonation_sessions_status_startedAt_idx`(`status`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
