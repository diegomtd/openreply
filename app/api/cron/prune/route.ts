import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

/**
 * Data retention sweep.
 *
 * Three tables grow with traffic and are never read after the fact:
 * `WebhookEvent` (the raw payload of every Meta delivery), `OperationalEvent`
 * (INFO-level chatter, mostly poll summaries), and `ProcessedComment` (the
 * webhook/polling dedup set). On a VPS with a fixed disk they eventually cost
 * real space, and every unbounded table makes the queries over it slower.
 *
 * What is kept:
 * - `DmLog` — never pruned. It is the record of what was actually sent.
 * - `Contact` / `ContactAutomationState` — never pruned. Deleting these would
 *   make an automation forget it already messaged someone, which is the exact
 *   bug the frequency rules exist to prevent.
 * - Warnings and errors in `OperationalEvent` — kept longer than INFO, since
 *   those are what you go looking for after something breaks.
 * - `ProcessedComment` rows younger than the private-reply window, so a pruned
 *   row can never let the reconciler re-DM an old comment. DmLog is a second
 *   guard on that anyway.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function envDays(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const webhookDays = envDays("DATA_RETENTION_WEBHOOK_DAYS", 7);
  const eventDays = envDays("DATA_RETENTION_EVENT_DAYS", 14);
  const commentDays = envDays("DATA_RETENTION_COMMENT_DAYS", 30);

  // Sequential on purpose: three concurrent bulk DELETEs on a one-core VPS is
  // how a cron job takes the web app down with it.
  const webhookEvents = await prisma.webhookEvent.deleteMany({
    where: { createdAt: { lt: daysAgo(webhookDays) } },
  });

  const operationalEvents = await prisma.operationalEvent.deleteMany({
    where: { level: "INFO", createdAt: { lt: daysAgo(eventDays) } },
  });

  // Warnings and errors get a longer window rather than immunity.
  const staleAlerts = await prisma.operationalEvent.deleteMany({
    where: { createdAt: { lt: daysAgo(eventDays * 6) } },
  });

  const processedComments = await prisma.processedComment.deleteMany({
    where: { seenAt: { lt: daysAgo(commentDays) } },
  });

  const pruned = {
    webhookEvents: webhookEvents.count,
    operationalEvents: operationalEvents.count + staleAlerts.count,
    processedComments: processedComments.count,
  };

  console.log("[Cron] Pruned old rows:", pruned);

  return NextResponse.json({
    success: true,
    data: {
      pruned,
      retentionDays: {
        webhookEvents: webhookDays,
        operationalEventsInfo: eventDays,
        operationalEventsAll: eventDays * 6,
        processedComments: commentDays,
      },
    },
  });
}
