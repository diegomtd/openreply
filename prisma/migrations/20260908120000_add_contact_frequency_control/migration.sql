-- Contact-level frequency control.
--
-- Fixes the repeat-send bug: dedupe used to be per message id, so every new
-- inbound DM re-triggered the same automation. Delivery is now decided against
-- the person (Contact + ContactAutomationState) instead.

-- CreateEnum
CREATE TYPE "SendFrequency" AS ENUM ('ONCE_PER_CONTACT', 'ONCE_PER_POST', 'COOLDOWN', 'ALWAYS');

-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'SKIPPED_ALREADY_SENT';
ALTER TYPE "DmStatus" ADD VALUE 'SKIPPED_COOLDOWN';
ALTER TYPE "DmStatus" ADD VALUE 'SKIPPED_OPTED_OUT';

-- AlterTable
ALTER TABLE "Workspace"
  ADD COLUMN "contactCooldownHours" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "optOutKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
-- Existing automations adopt the safe default too: once per person. That is the
-- point of the fix, so it applies to the campaigns already running.
ALTER TABLE "Automation"
  ADD COLUMN "sendFrequency" "SendFrequency" NOT NULL DEFAULT 'ONCE_PER_CONTACT',
  ADD COLUMN "resendCooldownHours" INTEGER NOT NULL DEFAULT 24;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastAutomationSentAt" TIMESTAMP(3),
    "automationSentCount" INTEGER NOT NULL DEFAULT 0,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "optedOutReason" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAutomationState" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "firstSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAutomationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_instagramAccountId_igsid_key" ON "Contact"("instagramAccountId", "igsid");
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");
CREATE INDEX "Contact_workspaceId_lastAutomationSentAt_idx" ON "Contact"("workspaceId", "lastAutomationSentAt");
CREATE INDEX "Contact_workspaceId_optedOut_idx" ON "Contact"("workspaceId", "optedOut");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAutomationState_contactId_automationId_scopeKey_key" ON "ContactAutomationState"("contactId", "automationId", "scopeKey");
CREATE INDEX "ContactAutomationState_automationId_idx" ON "ContactAutomationState"("automationId");
CREATE INDEX "ContactAutomationState_contactId_lastSentAt_idx" ON "ContactAutomationState"("contactId", "lastSentAt");

-- CreateIndex
-- Looking a person up across logs (Contacts screen, worker frequency checks) and
-- sweeping WebhookEvent by age (retention cron) both had to scan without these.
CREATE INDEX "DmLog_commenterId_idx" ON "DmLog"("commenterId");
CREATE INDEX "DmLog_automationId_commenterId_idx" ON "DmLog"("automationId", "commenterId");
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactAutomationState" ADD CONSTRAINT "ContactAutomationState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactAutomationState" ADD CONSTRAINT "ContactAutomationState_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the existing send history.
--
-- Without this, everyone who already received an automation would receive it one
-- more time after deploy (the new guard would only see them on the send after).
-- The backfill is what makes "people I already talked to stop getting the
-- message" true immediately.
INSERT INTO "Contact" (
    "id", "workspaceId", "instagramAccountId", "igsid", "username",
    "firstSeenAt", "lastAutomationSentAt", "automationSentCount",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    MIN(l."workspaceId"),
    l."instagramAccountId",
    l."commenterId",
    MAX(l."commenterName"),
    MIN(l."createdAt"),
    MAX(COALESCE(l."dmSentAt", l."createdAt")),
    COUNT(*)::int,
    NOW(),
    NOW()
FROM "DmLog" l
WHERE l."status" = 'SENT'
GROUP BY l."instagramAccountId", l."commenterId"
ON CONFLICT ("instagramAccountId", "igsid") DO NOTHING;

-- Legacy scope: DmLog never stored the media id, so historical sends land under
-- a single "legacy" scope. ONCE_PER_CONTACT (the new default) ignores scope, so
-- the guard is exact for it; ONCE_PER_POST simply has no post history to go on.
INSERT INTO "ContactAutomationState" (
    "id", "contactId", "automationId", "scopeKey",
    "sentCount", "firstSentAt", "lastSentAt"
)
SELECT
    gen_random_uuid()::text,
    c."id",
    l."automationId",
    'legacy',
    COUNT(*)::int,
    MIN(l."createdAt"),
    MAX(COALESCE(l."dmSentAt", l."createdAt"))
FROM "DmLog" l
JOIN "Contact" c
  ON c."instagramAccountId" = l."instagramAccountId"
 AND c."igsid" = l."commenterId"
WHERE l."status" = 'SENT'
GROUP BY c."id", l."automationId"
ON CONFLICT ("contactId", "automationId", "scopeKey") DO NOTHING;
