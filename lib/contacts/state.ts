/**
 * Contact-level frequency control.
 *
 * The one rule this module exists to enforce: **a person only receives an
 * automated message when they have not already had it.** Before this, dedupe
 * keyed off the *event* (a comment id, a message id), so every new inbound DM
 * looked brand new and re-triggered the same automation — the same person got
 * the same message on every message they sent, forever.
 *
 * Three layers decide a send, cheapest first:
 *   1. Opt-out. A contact who said stop, or was muted by hand, never receives
 *      an automated message again.
 *   2. Per-automation frequency (`Automation.sendFrequency`): once per person,
 *      once per person per post, after a cooldown, or always.
 *   3. Workspace anti-flood (`Workspace.contactCooldownHours`): a ceiling across
 *      *every* automation, so three matching campaigns cannot mean three DMs.
 *
 * The decision itself (`decideAutomationSend`) is pure so it can be tested
 * without a database; the exported helpers around it do the IO.
 */

import { prisma } from "@/lib/db/client";
import type { DmStatus, SendFrequency } from "@/app/generated/prisma/client";

/** Scope used by triggers that have no post attached (the DM trigger). */
export const DM_SCOPE = "dm";
/** Scope used when the trigger has a post but the id is unknown. */
export const UNKNOWN_SCOPE = "unknown";

/** Words that opt a contact out of everything, in Portuguese and English. */
const BUILT_IN_OPT_OUT_KEYWORDS = [
  "parar",
  "pare",
  "para",
  "sair",
  "stop",
  "cancelar",
  "cancela",
  "descadastrar",
  "desinscrever",
  "remover",
  "unsubscribe",
  "chega",
];

export type SkipStatus = Extract<
  DmStatus,
  "SKIPPED_OPTED_OUT" | "SKIPPED_ALREADY_SENT" | "SKIPPED_COOLDOWN"
>;

export type SendDecision =
  | { allowed: true }
  | { allowed: false; status: SkipStatus; reason: string };

export interface AutomationStateRow {
  scopeKey: string;
  sentCount: number;
  lastSentAt: Date;
}

export interface FrequencyInput {
  now: Date;
  /** Contact is muted or opted out. */
  optedOut: boolean;
  sendFrequency: SendFrequency;
  /** Only read when sendFrequency is COOLDOWN. */
  resendCooldownHours: number;
  /** Workspace-wide ceiling; 0 disables it. */
  workspaceCooldownHours: number;
  /** Last automated send to this contact from ANY automation. */
  lastAutomationSentAt: Date | null;
  /** Delivery history of THIS automation to THIS contact. */
  automationState: AutomationStateRow[];
  /** Media id for a post trigger, `DM_SCOPE` for the DM trigger. */
  scopeKey: string;
}

const HOUR_MS = 60 * 60 * 1000;

function hoursSince(now: Date, then: Date): number {
  return (now.getTime() - then.getTime()) / HOUR_MS;
}

function formatWhen(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * Decide whether one automation may send to one contact right now. Pure.
 */
export function decideAutomationSend(input: FrequencyInput): SendDecision {
  if (input.optedOut) {
    return {
      allowed: false,
      status: "SKIPPED_OPTED_OUT",
      reason: "Contact opted out of automated messages",
    };
  }

  // Most recent first, so every branch below reports the latest send rather
  // than whichever row the database happened to return first.
  const delivered = input.automationState
    .filter((row) => row.sentCount > 0)
    .sort((a, b) => b.lastSentAt.getTime() - a.lastSentAt.getTime());

  switch (input.sendFrequency) {
    case "ONCE_PER_CONTACT": {
      const previous = delivered[0];
      if (previous) {
        return {
          allowed: false,
          status: "SKIPPED_ALREADY_SENT",
          reason: `Already sent to this contact on ${formatWhen(
            previous.lastSentAt
          )} (set to send once per person)`,
        };
      }
      break;
    }
    case "ONCE_PER_POST": {
      const previous = delivered.find((row) => row.scopeKey === input.scopeKey);
      if (previous) {
        return {
          allowed: false,
          status: "SKIPPED_ALREADY_SENT",
          reason: `Already sent to this contact for this post on ${formatWhen(
            previous.lastSentAt
          )}`,
        };
      }
      break;
    }
    case "COOLDOWN": {
      const cooldown = Math.max(0, input.resendCooldownHours);
      const last = delivered.reduce<Date | null>(
        (latest, row) =>
          !latest || row.lastSentAt > latest ? row.lastSentAt : latest,
        null
      );
      if (last && cooldown > 0 && hoursSince(input.now, last) < cooldown) {
        return {
          allowed: false,
          status: "SKIPPED_COOLDOWN",
          reason: `Sent ${formatWhen(
            last
          )}; this automation waits ${cooldown}h between sends to the same person`,
        };
      }
      break;
    }
    case "ALWAYS":
      break;
  }

  // Workspace ceiling, applied after the per-automation rule so its message wins
  // when both would block — the per-automation reason is the more specific one.
  const globalCooldown = Math.max(0, input.workspaceCooldownHours);
  if (
    globalCooldown > 0 &&
    input.lastAutomationSentAt &&
    hoursSince(input.now, input.lastAutomationSentAt) < globalCooldown
  ) {
    return {
      allowed: false,
      status: "SKIPPED_COOLDOWN",
      reason: `Another automation already messaged this contact on ${formatWhen(
        input.lastAutomationSentAt
      )} (workspace limit: 1 automated DM per ${globalCooldown}h)`,
    };
  }

  return { allowed: true };
}

/**
 * True when an inbound message is the contact asking to be left alone.
 * Matched on the whole normalized message, not as a substring — "não quero
 * perder isso" is not an opt-out, "parar" is.
 */
export function isOptOutMessage(
  text: string,
  extraKeywords: string[] = []
): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return false;

  const keywords = [
    ...BUILT_IN_OPT_OUT_KEYWORDS,
    ...extraKeywords.map((k) =>
      k
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
    ),
  ].filter(Boolean);

  return keywords.includes(normalized);
}

export interface ContactRecord {
  id: string;
  optedOut: boolean;
  lastAutomationSentAt: Date | null;
  username: string | null;
}

/**
 * Find or create the contact row for one IGSID on one connected account.
 * `username` only overwrites a stored value when we actually have one — the
 * messages webhook carries no username, so it must not blank out a name the
 * comments webhook captured earlier.
 */
export async function getOrCreateContact(params: {
  workspaceId: string;
  instagramAccountId: string;
  igsid: string;
  username?: string | null;
  inbound?: boolean;
}): Promise<ContactRecord> {
  const { workspaceId, instagramAccountId, igsid, username, inbound } = params;

  return prisma.contact.upsert({
    where: { instagramAccountId_igsid: { instagramAccountId, igsid } },
    create: {
      workspaceId,
      instagramAccountId,
      igsid,
      username: username ?? null,
      lastInboundAt: inbound ? new Date() : null,
    },
    update: {
      ...(username ? { username } : {}),
      ...(inbound ? { lastInboundAt: new Date() } : {}),
    },
    select: {
      id: true,
      optedOut: true,
      lastAutomationSentAt: true,
      username: true,
    },
  });
}

/** Load this automation's delivery history for one contact. */
export async function loadAutomationState(
  contactId: string,
  automationId: string
): Promise<AutomationStateRow[]> {
  return prisma.contactAutomationState.findMany({
    where: { contactId, automationId },
    select: { scopeKey: true, sentCount: true, lastSentAt: true },
    orderBy: { lastSentAt: "desc" },
  });
}

/**
 * The full check, in one call: load the history and decide.
 * Callers that already hold a contact row pass it in to save a query.
 */
export async function canSendAutomation(params: {
  contact: ContactRecord;
  automation: {
    id: string;
    sendFrequency: SendFrequency;
    resendCooldownHours: number;
  };
  workspaceCooldownHours: number;
  scopeKey: string;
  now?: Date;
}): Promise<SendDecision> {
  const { contact, automation, workspaceCooldownHours, scopeKey } = params;

  // Opting out short-circuits before any query — the common cheap case.
  if (contact.optedOut) {
    return decideAutomationSend({
      now: params.now ?? new Date(),
      optedOut: true,
      sendFrequency: automation.sendFrequency,
      resendCooldownHours: automation.resendCooldownHours,
      workspaceCooldownHours,
      lastAutomationSentAt: contact.lastAutomationSentAt,
      automationState: [],
      scopeKey,
    });
  }

  const automationState =
    automation.sendFrequency === "ALWAYS"
      ? []
      : await loadAutomationState(contact.id, automation.id);

  return decideAutomationSend({
    now: params.now ?? new Date(),
    optedOut: false,
    sendFrequency: automation.sendFrequency,
    resendCooldownHours: automation.resendCooldownHours,
    workspaceCooldownHours,
    lastAutomationSentAt: contact.lastAutomationSentAt,
    automationState,
    scopeKey,
  });
}

/**
 * Record a delivered automated message. Called only after Meta accepted the
 * send, so the guard can never block on a message that never arrived.
 */
export async function recordAutomationSend(params: {
  contactId: string;
  automationId: string;
  scopeKey: string;
  commenterName?: string | null;
}): Promise<void> {
  const { contactId, automationId, scopeKey, commenterName } = params;
  const now = new Date();

  await prisma.$transaction([
    prisma.contactAutomationState.upsert({
      where: {
        contactId_automationId_scopeKey: { contactId, automationId, scopeKey },
      },
      create: {
        contactId,
        automationId,
        scopeKey,
        sentCount: 1,
        firstSentAt: now,
        lastSentAt: now,
      },
      update: { sentCount: { increment: 1 }, lastSentAt: now },
    }),
    prisma.contact.update({
      where: { id: contactId },
      data: {
        lastAutomationSentAt: now,
        automationSentCount: { increment: 1 },
        ...(commenterName ? { username: commenterName } : {}),
      },
    }),
  ]);
}

/** Mute a contact: stop-word, or the toggle on the Contacts screen. */
export async function optOutContact(
  contactId: string,
  reason: string
): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { optedOut: true, optedOutAt: new Date(), optedOutReason: reason },
  });
}

/** Undo a mute. */
export async function optInContact(contactId: string): Promise<void> {
  await prisma.contact.update({
    where: { id: contactId },
    data: { optedOut: false, optedOutAt: null, optedOutReason: null },
  });
}
