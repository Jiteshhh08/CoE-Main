-- DropForeignKey
ALTER TABLE `claims` DROP FOREIGN KEY `claims_round2VenueId_fkey`;

-- DropForeignKey
ALTER TABLE `claims` DROP FOREIGN KEY `claims_venueId_fkey`;

-- DropForeignKey
ALTER TABLE `hackathon_events` DROP FOREIGN KEY `hackathon_events_coordinatorId_fkey`;

-- DropForeignKey
ALTER TABLE `hackathon_events` DROP FOREIGN KEY `hackathon_events_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `hackathon_session_upload_locks` DROP FOREIGN KEY `hackathon_session_upload_locks_updatedByUserId_fkey`;

-- DropForeignKey
ALTER TABLE `hosting_requests` DROP FOREIGN KEY `hosting_requests_reviewedById_fkey`;

-- DropForeignKey
ALTER TABLE `judge_assignments` DROP FOREIGN KEY `judge_assignments_venueId_fkey`;

-- DropForeignKey
ALTER TABLE `problems` DROP FOREIGN KEY `problems_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `problems` DROP FOREIGN KEY `problems_eventId_fkey`;

-- DropForeignKey
ALTER TABLE `problems` DROP FOREIGN KEY `problems_industryId_fkey`;

-- DropForeignKey
ALTER TABLE `rubric_categories` DROP FOREIGN KEY `rubric_categories_parentCategoryId_fkey`;

-- DropForeignKey
ALTER TABLE `ticket_attendance` DROP FOREIGN KEY `ticket_attendance_checkedInByUserId_fkey`;

-- DropForeignKey
ALTER TABLE `tickets` DROP FOREIGN KEY `tickets_bookingId_fkey`;

-- DropForeignKey
ALTER TABLE `tickets` DROP FOREIGN KEY `tickets_claimId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_departmentId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_industryId_fkey`;

-- AlterTable
ALTER TABLE `opportunities` ADD COLUMN `country` VARCHAR(191) NULL,
    ADD COLUMN `hubScore` INTEGER NULL,
    ADD COLUMN `popularity` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_industryId_fkey` FOREIGN KEY (`industryId`) REFERENCES `industries`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `problems` ADD CONSTRAINT `problems_industryId_fkey` FOREIGN KEY (`industryId`) REFERENCES `industries`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `problems` ADD CONSTRAINT `problems_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `hackathon_events`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `problems` ADD CONSTRAINT `problems_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_venueId_fkey` FOREIGN KEY (`venueId`) REFERENCES `venues`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claims` ADD CONSTRAINT `claims_round2VenueId_fkey` FOREIGN KEY (`round2VenueId`) REFERENCES `venues`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hackathon_session_upload_locks` ADD CONSTRAINT `hackathon_session_upload_locks_updatedByUserId_fkey` FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hosting_requests` ADD CONSTRAINT `hosting_requests_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hackathon_events` ADD CONSTRAINT `hackathon_events_coordinatorId_fkey` FOREIGN KEY (`coordinatorId`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hackathon_events` ADD CONSTRAINT `hackathon_events_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `claims`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_attendance` ADD CONSTRAINT `ticket_attendance_checkedInByUserId_fkey` FOREIGN KEY (`checkedInByUserId`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rubric_categories` ADD CONSTRAINT `rubric_categories_parentCategoryId_fkey` FOREIGN KEY (`parentCategoryId`) REFERENCES `rubric_categories`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rubric_scores` ADD CONSTRAINT `rubric_scores_judgeId_fkey` FOREIGN KEY (`judgeId`) REFERENCES `users`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `judge_assignments` ADD CONSTRAINT `judge_assignments_venueId_fkey` FOREIGN KEY (`venueId`) REFERENCES `venues`(`id`) ON DELETE NO ACTION ON UPDATE CASCADE;
