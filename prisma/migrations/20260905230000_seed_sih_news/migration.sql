-- Seed SIH 2026 News for event 3 (prod SIH) so /hackathons/3 shows News Article above Notices
-- This insert is idempotent via NOT EXISTS; imageKey will be overwritten by scripts/seed_sih_news.ts upload in prod
INSERT INTO `event_news` (`eventId`, `title`, `caption`, `imageKey`, `pinned`, `createdAt`, `updatedAt`)
SELECT 3,
       'TCET Internal Hackathon – SIH 2026: From Complex Engineering Problems to Innovative Solutions',
       'A fully digital, collaborative and experiential innovation journey bringing together 254 students across 14 departments. Held from 17th to 22nd across all 14 departments, 254 participants, 2 rounds, 50 teams shortlisted for SIH 2026 journey. As an initiative of MIC, Government of India.',
       'events/3/news/sih-2026-hero.jpg',
       true,
       NOW(3),
       NOW(3)
FROM `hackathon_events`
WHERE EXISTS (SELECT 1 FROM `hackathon_events` WHERE `id` = 3)
  AND NOT EXISTS (SELECT 1 FROM `event_news` WHERE `eventId` = 3 AND `title` LIKE '%SIH 2026%');
