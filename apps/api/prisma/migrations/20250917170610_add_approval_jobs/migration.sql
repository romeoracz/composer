-- Add approval job table
CREATE TABLE "ApprovalJob" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_job_org_draft_unique" ON "ApprovalJob"("orgId", "draftId");
CREATE INDEX "approval_job_org_draft" ON "ApprovalJob"("orgId", "draftId");

ALTER TABLE "ApprovalJob"
  ADD CONSTRAINT "ApprovalJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovalJob"
  ADD CONSTRAINT "ApprovalJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend history records with status and error
ALTER TABLE "History"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN "error" TEXT;
