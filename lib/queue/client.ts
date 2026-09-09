/**
 * BullMQ Queue Client
 *
 * Provides the DM processing queue and Redis connection for BullMQ.
 */

import { Queue } from "bullmq";
import Redis from "ioredis";
import type { MessageTrigger } from "@/lib/meta/webhook";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return connection;
}

// ─── DM Queue ───────────────────────────────────────────────────────────────────

export type CommentSource = "WEBHOOK" | "POLLING";

export interface ProcessCommentJob {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  requeueAttempt?: number;
  // Which path enqueued this comment. Recorded in the shared ProcessedComment
  // dedup store so the reconciler can tell webhook- from polling-caught comments.
  source?: CommentSource;
}

// Delivered when a user taps an opening DM's button — carries the reveal target.
export interface ProcessPostbackJob {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
  fallback?: boolean;
}

// One step of the message sequence that runs after the link is delivered. Each
// step schedules the next one when it lands, so the chain walks itself forward
// instead of every step being queued up front — a contact who opts out midway
// stops receiving the rest.
//
// `stepOrder` is absent on jobs enqueued before sequences existed; those were
// the single follow-up, which the migration turned into step 1.
export interface ProcessFollowUpJob {
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
  stepOrder?: number;
}

// An inbound message from a user — a plain DM, a reply to one of the account's
// stories, or a story mention. Which one decides WHICH campaigns are eligible
// (dmTriggerEnabled / storyReplyTriggerEnabled / storyMentionTriggerEnabled),
// so the trigger has to travel with the job.
export interface ProcessMessageJob {
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
  trigger?: MessageTrigger;
  storyId?: string;
}

// One person inside one Envio ativo. Deliberately one job per recipient rather
// than one job for the whole send: on a 1-core VPS a loop over hundreds of
// contacts inside a single job holds the worker hostage and dies whole on the
// first Meta hiccup, taking the rest of the send with it.
//
// Each job re-checks the 24h window at its own turn, because the window can
// close between building the audience and reaching this person.
export interface ProcessBroadcastRecipientJob {
  broadcastId: string;
  recipientId: string;
}

export type DmQueueJob =
  | ProcessCommentJob
  | ProcessPostbackJob
  | ProcessFollowUpJob
  | ProcessMessageJob
  | ProcessBroadcastRecipientJob;

export const POSTBACK_JOB_NAME = "process-postback";
export const FOLLOWUP_JOB_NAME = "process-followup";
export const MESSAGE_JOB_NAME = "process-message";
export const BROADCAST_JOB_NAME = "process-broadcast-recipient";

/**
 * Espaçamento entre envios de um mesmo disparo, em milissegundos.
 *
 * A Meta tem rate limit e esta VPS tem um core. Mandar 200 mensagens de uma vez
 * é a forma mais rápida de tomar bloqueio e derrubar o app junto. Configurável
 * porque o número certo depende do tamanho da conta.
 */
export const BROADCAST_SPACING_MS = Math.max(
  200,
  Number(process.env.BROADCAST_SPACING_MS ?? 1500)
);

let dmQueue: Queue<DmQueueJob> | null = null;

export function getDMQueue(): Queue<DmQueueJob> {
  if (!dmQueue) {
    dmQueue = new Queue<DmQueueJob>("dm-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
        // Clear failed jobs shortly after they exhaust retries. Job ids are
        // deterministic (comment_<acct>_<id>), so a retained failed job would
        // block the polling reconciler from ever retrying that comment. Clearing
        // them lets a later sweep re-enqueue and try again once a transient
        // failure (e.g. an Instagram rate-limit window) has passed. Failure
        // detail is still preserved in DmLog.
        removeOnFail: { age: 300, count: 2000 },
        attempts: 3,
        backoff: {
          type: "custom",
        },
      },
    });
  }
  return dmQueue;
}
