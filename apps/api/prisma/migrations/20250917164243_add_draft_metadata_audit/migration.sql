-- Add draft metadata columns
ALTER TABLE "Draft"
  ADD COLUMN "promptVersionId" TEXT,
  ADD COLUMN "generatorRunId" TEXT,
  ADD COLUMN "generatedAt" TIMESTAMP(3);

-- Create draft audit table
CREATE TABLE "DraftAudit" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "editor" TEXT NOT NULL,
  "editedText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DraftAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "draft_audit_org_draft" ON "DraftAudit"("orgId", "draftId");

ALTER TABLE "DraftAudit"
  ADD CONSTRAINT "DraftAudit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DraftAudit"
  ADD CONSTRAINT "DraftAudit_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
