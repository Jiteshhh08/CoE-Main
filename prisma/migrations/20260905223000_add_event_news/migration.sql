-- CreateTable EventNews for admin-managed per-event news (mirrors Notice)
CREATE TABLE `event_news` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `eventId` INT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `caption` TEXT NOT NULL,
    `imageKey` VARCHAR(191) NOT NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    CONSTRAINT `event_news_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `hackathon_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `event_news_eventId_idx` ON `event_news`(`eventId`);
