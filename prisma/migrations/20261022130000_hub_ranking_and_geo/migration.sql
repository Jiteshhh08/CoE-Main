-- Hub curation + ranking columns.
--
-- Purely additive: four nullable columns, no backfill, no constraint changes.
-- Rows written before this migration keep NULL and are handled as "unscored"
-- (see src/lib/hub/ranking.ts and scripts/hub-rescore.ts).
--
-- NOTE: `prisma migrate dev` will try to append ~16 foreign-key DROP/ADD pairs
-- here, rewriting ON DELETE SET NULL to ON DELETE NO ACTION. That is pre-existing
-- drift between schema.prisma and the real database, NOT part of this change —
-- applying it would make deletes of a venue/department/user start failing with
-- constraint errors. It has been deliberately left out; see the handoff doc.
ALTER TABLE `opportunities` ADD COLUMN `country` VARCHAR(191) NULL,
    ADD COLUMN `hubScore` INTEGER NULL,
    ADD COLUMN `popularity` INTEGER NULL,
    ADD COLUMN `registrations` INTEGER NULL;
