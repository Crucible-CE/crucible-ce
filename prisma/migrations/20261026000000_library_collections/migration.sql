-- Library documents and library collections. Additive only.
--
-- SourceDocument.scope marks documents shipped with CE ('library', read-only,
-- duplicated to edit) apart from the organization's own ('local').
-- SourceDocument.libraryKey is the stable key the boot seed upserts by.
-- collection groups library documents and templates in the UI.

-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "SourceDocument" ADD COLUMN "libraryKey" TEXT;
ALTER TABLE "SourceDocument" ADD COLUMN "collection" TEXT;

-- AlterTable
ALTER TABLE "ExerciseTemplate" ADD COLUMN "collection" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_organizationId_libraryKey_key" ON "SourceDocument"("organizationId", "libraryKey");
