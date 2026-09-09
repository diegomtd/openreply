-- Story triggers.
--
-- A story reply and a story mention both arrive through the same messages
-- webhook as a plain DM. Until now a story reply was indistinguishable from a
-- DM, so `dmTriggerEnabled` fired on both.

-- AlterTable
ALTER TABLE "Automation"
  ADD COLUMN "storyReplyTriggerEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "storyMentionTriggerEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Preserve today's behaviour exactly: an automation that answered DMs was also
-- answering story replies, because nothing told them apart. Carrying that over
-- means no live automation changes what it responds to on deploy — the new
-- switch only makes the two separable from here on.
UPDATE "Automation"
SET "storyReplyTriggerEnabled" = true
WHERE "dmTriggerEnabled" = true;
