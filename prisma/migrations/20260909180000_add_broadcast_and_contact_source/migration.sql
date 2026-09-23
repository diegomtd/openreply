-- Envio ativo (janela de 24h) e origem do contato.
--
-- No Instagram só dá para enviar dentro de 24h da última mensagem que a pessoa
-- mandou. Não existe One-Time Notification nem message tag de marketing na IG
-- Messaging API, e HUMAN_AGENT é para humano respondendo à mão. Então isto não
-- é "disparo para a base": é um envio para a audiência que está alcançável
-- agora. Ver lib/broadcast/window.ts.

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SENDING', 'DONE', 'CANCELLED');
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_WINDOW_CLOSED', 'SKIPPED_OPTED_OUT', 'SKIPPED_CANCELLED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "sourceAutomationId" TEXT;

-- AddForeignKey
-- SET NULL, e não CASCADE: apagar uma automação não pode apagar as pessoas que
-- ela trouxe. Perde-se a origem, não o contato.
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_sourceAutomationId_fkey"
  FOREIGN KEY ("sourceAutomationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Contact_sourceAutomationId_idx" ON "Contact"("sourceAutomationId");
-- O índice do Envio ativo: a audiência é sempre "deste workspace, não
-- silenciado, dentro da janela".
CREATE INDEX "Contact_workspaceId_optedOut_lastInboundAt_idx"
  ON "Contact"("workspaceId", "optedOut", "lastInboundAt");

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "filterTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filterExcludedTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filterSourceAutomationId" TEXT,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "windowClosesAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_workspaceId_createdAt_idx" ON "Broadcast"("workspaceId", "createdAt");
CREATE INDEX "Broadcast_filterSourceAutomationId_idx" ON "Broadcast"("filterSourceAutomationId");

-- Uma pessoa entra uma vez por envio. É isto que torna o job idempotente: um
-- retry do BullMQ não manda a mesma mensagem duas vezes.
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_contactId_key" ON "BroadcastRecipient"("broadcastId", "contactId");
CREATE INDEX "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");
CREATE INDEX "BroadcastRecipient_contactId_idx" ON "BroadcastRecipient"("contactId");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_filterSourceAutomationId_fkey" FOREIGN KEY ("filterSourceAutomationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill da origem: a primeira automação que falou com cada pessoa.
--
-- DISTINCT ON pega uma linha por contato, e o ORDER BY decide qual: a mais
-- antiga. Só conta envio que de fato saiu (SENT) — uma automação que tentou e
-- falhou não "trouxe" ninguém.
UPDATE "Contact" c
SET "sourceAutomationId" = origem."automationId"
FROM (
    SELECT DISTINCT ON (l."instagramAccountId", l."commenterId")
        l."instagramAccountId",
        l."commenterId",
        l."automationId"
    FROM "DmLog" l
    WHERE l."status" = 'SENT'
    ORDER BY l."instagramAccountId", l."commenterId", l."createdAt" ASC
) AS origem
WHERE c."instagramAccountId" = origem."instagramAccountId"
  AND c."igsid" = origem."commenterId"
  AND c."sourceAutomationId" IS NULL;
