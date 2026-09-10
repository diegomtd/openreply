import { Worker, type Job } from "bullmq";
import {
  getDMQueue,
  getRedisConnection,
  MESSAGE_JOB_NAME,
  POSTBACK_JOB_NAME,
  FOLLOWUP_JOB_NAME,
  BROADCAST_JOB_NAME,
  type DmQueueJob,
  type ProcessCommentJob,
  type ProcessMessageJob,
  type ProcessPostbackJob,
  type ProcessFollowUpJob,
  type ProcessBroadcastRecipientJob,
} from "./client";
import { prisma } from "@/lib/db/client";
import type { DmStatus } from "@/app/generated/prisma/client";
import {
  DM_SCOPE,
  canSendAutomation,
  getOrCreateContact,
  isOptOutMessage,
  optOutContact,
  recordAutomationSend,
  type ContactRecord,
} from "@/lib/contacts/state";
import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
  getUserFollowStatus,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { reserveDMSlot } from "@/lib/utils/rate-limiter";
import {
  releaseWorkspaceDMReservation,
  reserveWorkspaceDMSend,
} from "@/lib/billing/usage";
import { recordWorkerAlert } from "@/lib/ops/worker-health";
import { isWindowOpen } from "@/lib/broadcast/window";
import { isTokenDead, markTokenInvalid } from "@/lib/meta/account-health";
import {
  buildTrackedUrl,
  renderMessageWithTracking,
  renderMessageWithoutLink,
} from "@/lib/tracking/message";

const BACKOFF_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];

function formatError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta API Error ${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

// Meta rejections that a plain-text retry cannot fix: the send was refused for
// the conversation, not for the button template. Retrying as text just burns
// the attempt and — worse — overwrites the real error with a misleading one
// ("invalid for a private reply", because the first attempt already used up the
// comment's single allowed private reply).
const NON_TEMPLATE_REJECTIONS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
];

function isTemplateRejection(error: unknown): boolean {
  if (error instanceof TokenExpiredError || error instanceof RateLimitError) {
    return false;
  }
  const message = error instanceof Error ? error.message : "";
  return !NON_TEMPLATE_REJECTIONS.some((pattern) => pattern.test(message));
}

type WorkerTrackedLink = {
  slug: string;
  label: string | null;
  destinationUrl: string;
};

/**
 * Build the tappable link buttons for a DM. The first link uses the campaign's
 * `linkButtonLabel`; each additional link uses its own stored `label`. Capped at
 * Meta's 3-button limit for a button template.
 */
function buildLinkButtons(
  trackedLinks: WorkerTrackedLink[],
  primaryLabel: string | null
): { title: string; url: string }[] {
  return trackedLinks.slice(0, 3).map((link, index) => ({
    url: buildTrackedUrl(link.slug),
    title: (index === 0 ? primaryLabel : link.label) || link.label || "Abrir link",
  }));
}

/**
 * Fallback text when Meta rejects the button template: render the primary link
 * inline, then append any extra tracked URLs on their own lines so no link is
 * lost.
 */
function buildInlineLinkFallback(
  message: string,
  commenterName: string | null | undefined,
  trackedLinks: WorkerTrackedLink[],
  bodyText: string
): string {
  const base =
    renderMessageWithTracking({ message, commenterName, trackedLinks }) ||
    bodyText;
  const extraUrls = trackedLinks.slice(1).map((link) => buildTrackedUrl(link.slug));
  return extraUrls.length > 0 ? `${base}\n${extraUrls.join("\n")}` : base;
}

type RevealAutomation = {
  dmMessage: string;
  linkButtonLabel: string | null;
  trackedLinks: WorkerTrackedLink[];
  instagramAccount: { instagramId: string };
};

/**
 * Deliver a campaign's reveal message as a direct message. Shared by the
 * button-tap (postback) path and the DM keyword-trigger path — both already
 * have an open conversation with the user, so neither uses a private reply.
 */
async function sendRevealDirectMessage(
  accessToken: string,
  automation: RevealAutomation,
  userId: string,
  commenterName: string | null,
  context: string
): Promise<void> {
  if (automation.trackedLinks.length === 0) {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithTracking({
        message: automation.dmMessage,
        commenterName,
        trackedLinks: automation.trackedLinks,
      })
    );
    return;
  }

  // Try button template first; if Meta rejects it, fall back to inline links.
  const bodyText =
    renderMessageWithoutLink({
      message: automation.dmMessage,
      commenterName,
    }) || "Aqui está seu link:";
  const buttons = buildLinkButtons(
    automation.trackedLinks,
    automation.linkButtonLabel
  );

  try {
    await sendDirectMessageWithLinkButton(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      bodyText,
      buttons
    );
  } catch (buttonError) {
    // A closed messaging window rejects the text retry too, so don't let it
    // overwrite the original error with a misleading one.
    if (!isTemplateRejection(buttonError)) throw buttonError;

    console.log(
      `[DM Worker] Button template rejected in ${context}, falling back to inline link:`,
      formatError(buttonError)
    );
    try {
      await sendDirectMessage(
        accessToken,
        automation.instagramAccount.instagramId,
        userId,
        buildInlineLinkFallback(
          automation.dmMessage,
          commenterName,
          automation.trackedLinks,
          bodyText
        )
      );
    } catch {
      throw buttonError;
    }
  }
}

async function processComment(job: Job<ProcessCommentJob>): Promise<void> {
  const {
    instagramAccountId,
    commentId,
    commentText,
    commenterId,
    commenterName,
    mediaId,
  } = job.data;
  const requeueAttempt = job.data.requeueAttempt ?? 0;

  const automations = await prisma.automation.findMany({
    where: {
      // Match campaigns bound to this specific post, plus any-post campaigns.
      OR: [{ postId: mediaId }, { matchAnyPost: true }],
      isActive: true,
      instagramAccount: {
        instagramId: instagramAccountId,
      },
    },
    include: {
      instagramAccount: true,
      workspace: {
        select: { id: true, contactCooldownHours: true, optOutKeywords: true },
      },
      trackedLinks: {
        select: {
          slug: true,
          label: true,
          destinationUrl: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // The person behind the comment, created on first sight. Resolved lazily so a
  // comment that matches nothing costs no write at all.
  let contact: ContactRecord | null = null;
  const resolveContact = async (automation: {
    workspaceId: string;
    instagramAccountId: string;
  }): Promise<ContactRecord> => {
    contact ??= await getOrCreateContact({
      workspaceId: automation.workspaceId,
      instagramAccountId: automation.instagramAccountId,
      igsid: commenterId,
      username: commenterName ?? null,
    });
    return contact;
  };

  for (const automation of automations) {
    // "Any word" campaigns fire on every comment; otherwise require a keyword hit.
    const matchResult = automation.matchAnyWord
      ? { matched: true, matchedKeyword: null }
      : matchKeywords(
          commentText,
          automation.keywords,
          automation.wholeWordMatch
        );

    if (!matchResult.matched) {
      continue;
    }

    const existingLog = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId,
        },
      },
    });

    const alreadyDmd = existingLog?.status === "SENT";
    const alreadyPublicReplied = Boolean(existingLog?.publicReplySentAt);
    const needsDm = !alreadyDmd;

    // Skip only when there is genuinely nothing left to do. A comment whose DM
    // already sent but whose public reply never posted (e.g. it hit a rate
    // limit) must still come back so the public reply can be retried.
    if (existingLog?.status === "SKIPPED_PLAN_LIMIT") continue;
    if (alreadyDmd && (alreadyPublicReplied || !automation.publicReplyEnabled)) {
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
        update: {
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        },
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
        update: {
          status: "FAILED",
          errorMessage: "Failed to decrypt Instagram access token",
        },
      });
      continue;
    }

    // Ensure a log row exists before the public reply leg (which updates it).
    // Only (re)set PENDING when the DM will actually be attempted, so a prior
    // SENT is never clobbered while we come back just to retry the public reply.
    if (!existingLog) {
      await prisma.dmLog.create({
        data: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "PENDING",
          attempts: job.attemptsMade + 1,
        },
      });
    } else if (needsDm) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "PENDING",
          attempts: job.attemptsMade + 1,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: null,
        },
      });
    }

    // Public reply leg — decoupled from the DM and posted first so a DM failure
    // (e.g. a non-follower whose messaging is restricted) never suppresses it.
    // Idempotent across retries via publicReplySentAt.
    const replyPool =
      automation.publicReplyMessages.length > 0
        ? automation.publicReplyMessages
        : automation.publicReplyMessage
          ? [automation.publicReplyMessage]
          : [];
    if (
      automation.publicReplyEnabled &&
      replyPool.length > 0 &&
      !existingLog?.publicReplySentAt
    ) {
      try {
        const chosen = replyPool[Math.floor(Math.random() * replyPool.length)];
        const publicReply = renderMessageWithTracking({
          message: chosen,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendCommentReply(accessToken, commentId, publicReply);
        await prisma.dmLog.update({
          where: {
            automationId_commentId: { automationId: automation.id, commentId },
          },
          data: { publicReplySentAt: new Date(), publicReplyError: null },
        });
      } catch (error) {
        console.error(
          "[DM Worker] Public comment reply failed:",
          formatError(error)
        );
        await prisma.dmLog
          .update({
            where: {
              automationId_commentId: { automationId: automation.id, commentId },
            },
            data: { publicReplyError: formatError(error) },
          })
          .catch(() => {});
      }
    }

    // DM already sent on an earlier pass; the public reply retry above was all
    // this run needed. Don't re-send the DM.
    if (!needsDm) continue;

    // Frequency gate, on the person rather than the comment: someone who already
    // received this automation (or opted out, or is inside a cooldown) is not
    // DM'd again just because they commented a second time. The public reply
    // above still went out — only the DM is held back, with the reason logged.
    const commentContact = await resolveContact(automation);
    const decision = await canSendAutomation({
      contact: commentContact,
      automation,
      workspaceCooldownHours: automation.workspace.contactCooldownHours,
      scopeKey: mediaId,
    });
    if (!decision.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: decision.status,
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: decision.reason,
        },
      });
      continue;
    }

    // Meta allows exactly ONE private reply per comment, ever — across every
    // campaign. When several campaigns match the same comment (duplicated
    // campaigns, or an any-post campaign overlapping a post-specific one), only
    // the first can deliver; the rest would fail with "The comment is invalid
    // for a private reply". Skip them explicitly instead of burning an API call
    // and logging a failure the user can do nothing about. The public reply
    // above still goes out per campaign — only the DM leg is deduped.
    const privateReplyUsedBy = await prisma.dmLog.findFirst({
      where: {
        commentId,
        status: "SENT",
        automationId: { not: automation.id },
      },
      select: { automation: { select: { name: true } } },
    });
    if (privateReplyUsedBy) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        data: {
          status: "SKIPPED_DEDUP",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Another campaign (${privateReplyUsedBy.automation?.name ?? "unknown"}) already sent the one private reply Instagram allows for this comment`,
        },
      });
      continue;
    }

    // Token já marcado como morto: não adianta chamar a Meta. Fica ANTES de
    // reservar a cota do mês de propósito — sair depois da reserva sem
    // devolvê-la queimava cota por um DM que nunca saiu. Sem esta trava,
    // cada comentário gastava três tentativas (5, 15 e 45 min) batendo num
    // token que ia recusar as três — queimando rate limit da conta e CPU da VPS
    // enquanto o problema real esperava alguém reconectar.
    if (automation.instagramAccount.tokenInvalidAt) {
      await prisma.dmLog.upsert({
        where: {
          automationId_commentId: { automationId: automation.id, commentId },
        },
        create: {
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          instagramAccountId: automation.instagramAccountId,
          commenterId,
          commenterName,
          commentText,
          commentId,
          matchedKeyword: matchResult.matchedKeyword,
          status: "FAILED",
          errorMessage:
            "A conta do Instagram está desconectada. Reconecte em Configurações para voltar a enviar.",
        },
        update: {
          status: "FAILED",
          errorMessage:
            "A conta do Instagram está desconectada. Reconecte em Configurações para voltar a enviar.",
        },
      });
      continue;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SKIPPED_PLAN_LIMIT",
          matchedKeyword: matchResult.matchedKeyword,
          errorMessage: `Monthly DM limit reached (${usage.limit})`,
        },
      });
      continue;
    }

    let rateLimit;
    try {
      rateLimit = await reserveDMSlot(instagramAccountId, requeueAttempt);
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );
      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }

    if (!rateLimit.allowed) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      if (rateLimit.shouldSkip) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "SKIPPED_RATE_LIMIT",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly Instagram DM rate limit reached",
          },
        });
        continue;
      }

      if (rateLimit.shouldRequeue) {
        await prisma.dmLog.update({
          where: {
            automationId_commentId: {
              automationId: automation.id,
              commentId,
            },
          },
          data: {
            status: "PENDING",
            matchedKeyword: matchResult.matchedKeyword,
            errorMessage: "Hourly rate limit hit; retry scheduled",
          },
        });

        await getDMQueue().add(
          "process-comment",
          {
            ...job.data,
            requeueAttempt: requeueAttempt + 1,
          },
          {
            delay: rateLimit.requeueDelayMs,
            jobId: `comment_${instagramAccountId}_${commentId}_retry_${requeueAttempt + 1}`,
          }
        );
        continue;
      }
    }

    // With an opening DM, the private reply is a button message; tapping it
    // fires a postback that delivers the reveal (see processPostback). Without
    // one, we send the reveal text directly as today.
    const useOpeningDm =
      automation.openingDmEnabled &&
      Boolean(automation.openingDmMessage) &&
      Boolean(automation.openingDmButtonLabel);

    // Follow-gating: the link is revealed only after a follow. When an opening
    // DM is enabled it comes FIRST, and its button routes into the follow check
    // (opening DM → follow gate → link). Without an opening DM, we check follow
    // status at comment time: confirmed followers get the link now, everyone
    // else gets the "follow me first" prompt (re-verified on tap).
    let sendFollowPrompt = false;
    if (automation.requireFollow && !useOpeningDm) {
      const alreadyFollows = await getUserFollowStatus(accessToken, commenterId);
      sendFollowPrompt = alreadyFollows !== true;
    }

    try {
      if (useOpeningDm) {
        const openingText = renderMessageWithTracking({
          message: automation.openingDmMessage as string,
          commenterName,
          trackedLinks: [],
        });
        await sendPrivateReplyWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          openingText,
          automation.openingDmButtonLabel as string,
          automation.requireFollow
            ? `followcheck:${automation.id}`
            : `reveal:${automation.id}`
        );
      } else if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "antes de eu te mandar o link, um favor: me segue aqui. é de graça, não ganho nada com isso. toca no botão quando estiver me seguindo e eu te envio na hora",
          commenterName,
        });
        await sendPrivateReplyWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          promptText,
          automation.followPromptButtonLabel || "estou te seguindo",
          `followcheck:${automation.id}`
        );
      } else if (automation.trackedLinks.length > 0) {
        // Try button template first; if Meta rejects it, fall back to inline links.
        const bodyText =
          renderMessageWithoutLink({
            message: automation.dmMessage,
            commenterName,
          }) || "Aqui está seu link:";
        const buttons = buildLinkButtons(
          automation.trackedLinks,
          automation.linkButtonLabel
        );

        try {
          await sendPrivateReplyWithLinkButton(
            accessToken,
            automation.instagramAccount.instagramId,
            commentId,
            bodyText,
            buttons
          );
        } catch (buttonError) {
          // Only a template rejection is worth retrying as text. Anything else
          // (closed window, comment already replied to) fails the same way and
          // would replace the real error with a misleading one.
          if (!isTemplateRejection(buttonError)) throw buttonError;

          console.log(
            "[DM Worker] Button template rejected, falling back to inline link:",
            formatError(buttonError)
          );
          const fallbackMessage = buildInlineLinkFallback(
            automation.dmMessage,
            commenterName,
            automation.trackedLinks,
            bodyText
          );
          try {
            await sendPrivateReply(
              accessToken,
              automation.instagramAccount.instagramId,
              commentId,
              fallbackMessage
            );
          } catch {
            // The first attempt consumed the comment's single private reply, so
            // this one reports "invalid for a private reply" no matter what the
            // underlying problem was. Surface the original rejection instead.
            throw buttonError;
          }
        }
      } else {
        const dmMessage = renderMessageWithTracking({
          message: automation.dmMessage,
          commenterName,
          trackedLinks: automation.trackedLinks,
        });
        await sendPrivateReply(
          accessToken,
          automation.instagramAccount.instagramId,
          commentId,
          dmMessage
        );
      }

      // Counts against the frequency rules from here on. Recorded only after
      // Meta accepted the send, so a rejected message never blocks a retry.
      await recordAutomationSend({
        contactId: commentContact.id,
        automationId: automation.id,
        scopeKey: mediaId,
        commenterName,
      });
      contact = { ...commentContact, lastAutomationSentAt: new Date() };

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "SENT",
          dmSentAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      // A Meta recusou o token (erro 190). Marcar a conta aqui é o que faz o
      // aviso aparecer na interface e o resto da fila desistir rápido, em vez
      // de tentar de novo por mais uma hora contra um token morto.
      if (isTokenDead(error)) {
        await markTokenInvalid(automation.instagramAccountId, formatError(error));
      }

      await prisma.dmLog.update({
        where: {
          automationId_commentId: {
            automationId: automation.id,
            commentId,
          },
        },
        data: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

/**
 * Deliver the reveal message after a user taps an opening DM's button.
 * The postback payload is `reveal:<automationId>`; the sender is the user's
 * IGSID (same id as their comment author id), which we DM directly.
 */
async function processPostback(job: Job<ProcessPostbackJob>): Promise<void> {
  const { instagramAccountId, userId, payload, fallback } = job.data;

  const isFollowCheck = payload.startsWith("followcheck:");
  if (!isFollowCheck && !payload.startsWith("reveal:")) return;
  const automationId = payload.slice(
    isFollowCheck ? "followcheck:".length : "reveal:".length
  );

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (
    !automation ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // A muted contact receives nothing, not even behind a tap — the read-fallback
  // job is speculative, and a hand-muted contact should stay silent either way.
  // Other frequency rules do NOT apply here: a tap is the person explicitly
  // asking for the link, and re-sending on a repeat tap is the intended
  // behaviour.
  const contact = await prisma.contact.findUnique({
    where: {
      instagramAccountId_igsid: {
        instagramAccountId: automation.instagramAccountId,
        igsid: userId,
      },
    },
    select: { id: true, optedOut: true },
  });
  if (contact?.optedOut) {
    console.log(
      `[DM Worker] Postback ignored, contact ${userId} opted out of automations`
    );
    return;
  }

  // Duplicate sends are enabled: every button tap re-sends the reveal
  // instead of only firing once per person.
  const dedupeId = `reveal:${userId}`;

  if (fallback) {
    const existingReveal = await prisma.dmLog.findUnique({
      where: {
        automationId_commentId: {
          automationId: automation.id,
          commentId: dedupeId,
        },
      },
    });
    if (existingReveal?.status === "SENT") return;
  }

  // Personalize {username} from the opening DM log for this user, if present.
  const openingLog = await prisma.dmLog.findFirst({
    where: { automationId: automation.id, commenterId: userId },
    select: { commenterName: true },
  });
  const commenterName = openingLog?.commenterName ?? null;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  // Follow-gate: before revealing the link, verify the user follows. On a
  // `followcheck:` tap a non-follower gets the prompt again (no quota spent);
  // on a read fallback a non-follower is silently skipped — the gate must not
  // be bypassable by just reading the DM and waiting. Following, or
  // unverifiable (null), falls through and delivers the link — fail-open so a
  // real follower is never trapped.
  if ((isFollowCheck || fallback) && automation.requireFollow) {
    const follows = await getUserFollowStatus(accessToken, userId);
    if (follows === false) {
      if (fallback) return;
      const promptText = renderMessageWithoutLink({
        message:
          automation.followPromptMessage ||
          "antes de eu te mandar o link, um favor: me segue aqui. é de graça, não ganho nada com isso. toca no botão quando estiver me seguindo e eu te envio na hora",
        commenterName,
      });
      try {
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          userId,
          promptText,
          automation.followPromptButtonLabel || "estou te seguindo",
          `followcheck:${automation.id}`
        );
      } catch (error) {
        console.log(
          "[DM Worker] Failed to re-send follow prompt:",
          formatError(error)
        );
      }
      return;
    }
  }

  const usage = await reserveWorkspaceDMSend(automation.workspaceId);
  if (!usage.allowed) {
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SKIPPED_PLAN_LIMIT",
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      },
      update: { status: "SKIPPED_PLAN_LIMIT" },
    });
    return;
  }

  try {
    await sendRevealDirectMessage(
      accessToken,
      automation,
      userId,
      commenterName,
      "postback"
    );
    // The link is out, so the sequence starts. Each step schedules the next one
    // as it lands, so nothing after an opt-out is ever sent.
    await scheduleSequenceStep({
      instagramAccountId: automation.instagramAccount.instagramId,
      userId,
      automationId: automation.id,
      commenterName,
      afterOrder: 0,
    });
    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "SENT",
        dmSentAt: new Date(),
      },
      update: { status: "SENT", dmSentAt: new Date(), errorMessage: null },
    });
  } catch (error) {
    await releaseWorkspaceDMReservation(automation.workspaceId, usage.periodStart);

    // The read fallback is speculative: it only runs when the user read the
    // opening DM and never tapped the button, which means they never messaged
    // us, which means the 24-hour window is closed and Meta rejects the send
    // ("outside of allowed window"). That is the expected outcome here, not a
    // failure the user can act on — so don't log it as FAILED and don't retry
    // it against a window that cannot reopen on its own. It still delivers in
    // the case that does work: the user replied by typing instead of tapping.
    if (fallback) {
      console.log(
        "[DM Worker] Read fallback not delivered (messaging window closed):",
        formatError(error)
      );
      return;
    }

    await prisma.dmLog.upsert({
      where: {
        automationId_commentId: { automationId: automation.id, commentId: dedupeId },
      },
      create: {
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        instagramAccountId: automation.instagramAccountId,
        commenterId: userId,
        commenterName,
        commentText: "(button tap)",
        commentId: dedupeId,
        status: "FAILED",
        errorMessage: formatError(error),
      },
      update: { status: "FAILED", errorMessage: formatError(error) },
    });
    throw error;
  }
}

/**
 * Schedule one step of an automation's message sequence.
 *
 * Called once after the link is delivered (with `afterOrder` 0) and then by each
 * step as it lands. Walking the chain forward one job at a time — rather than
 * queueing every step up front — is what lets a contact who opts out halfway
 * through stop receiving the rest.
 */
async function scheduleSequenceStep(params: {
  instagramAccountId: string;
  userId: string;
  automationId: string;
  commenterName?: string | null;
  afterOrder: number;
}): Promise<void> {
  const next = await prisma.automationStep.findFirst({
    where: {
      automationId: params.automationId,
      order: { gt: params.afterOrder },
      message: { not: "" },
    },
    orderBy: { order: "asc" },
    select: { order: true, delayMinutes: true },
  });

  if (!next) return;

  await getDMQueue().add(
    FOLLOWUP_JOB_NAME,
    {
      instagramAccountId: params.instagramAccountId,
      userId: params.userId,
      automationId: params.automationId,
      commenterName: params.commenterName ?? null,
      stepOrder: next.order,
    },
    {
      delay: Math.max(0, next.delayMinutes) * 60_000,
      // Deterministic, so a repeat button tap cannot double up one step.
      jobId: `step_${params.automationId}_${params.userId}_${next.order}`,
    }
  );
}

/**
 * Send one step of the sequence, then schedule the one after it.
 *
 * Best-effort: if a step cannot be delivered (usually because the delays pushed
 * it past Instagram's 24-hour messaging window) it is logged, not retried — and
 * the chain stops there, since every later step would hit the same closed
 * window.
 */
async function processFollowUp(job: Job<ProcessFollowUpJob>): Promise<void> {
  const { instagramAccountId, userId, automationId, commenterName } = job.data;
  // Jobs queued before sequences existed carry no order; they were the single
  // follow-up, which the migration turned into step 1.
  const stepOrder = job.data.stepOrder ?? 1;

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, isActive: true },
    include: {
      instagramAccount: true,
      steps: { where: { order: stepOrder }, take: 1 },
    },
  });

  const step = automation?.steps[0];

  if (
    !automation ||
    !step ||
    !step.message.trim() ||
    automation.instagramAccount.instagramId !== instagramAccountId ||
    !automation.instagramAccount.accessToken
  ) {
    return;
  }

  // Scheduled minutes ago; the contact may have asked to stop since. Returning
  // here also ends the chain, because the next step is only scheduled below.
  const contact = await prisma.contact.findUnique({
    where: {
      instagramAccountId_igsid: {
        instagramAccountId: automation.instagramAccountId,
        igsid: userId,
      },
    },
    select: { optedOut: true },
  });
  if (contact?.optedOut) return;

  let accessToken: string;
  try {
    accessToken = decryptToken(automation.instagramAccount.accessToken);
  } catch {
    return;
  }

  try {
    await sendDirectMessage(
      accessToken,
      automation.instagramAccount.instagramId,
      userId,
      renderMessageWithoutLink({
        message: step.message,
        commenterName: commenterName ?? null,
      })
    );
  } catch (error) {
    console.log(
      `[DM Worker] Failed to send sequence step ${stepOrder}:`,
      formatError(error)
    );
    // Don't chain past a failure: a closed messaging window rejects every later
    // step the same way.
    return;
  }

  await scheduleSequenceStep({
    instagramAccountId,
    userId,
    automationId,
    commenterName,
    afterOrder: stepOrder,
  });
}

async function processMessage(job: Job<ProcessMessageJob>): Promise<void> {
  const {
    instagramAccountId,
    messageId,
    messageText,
    senderId,
    storyId,
  } = job.data;
  // Jobs enqueued before story triggers existed carry no `trigger`; they were
  // all plain DMs.
  const trigger = job.data.trigger ?? "DM";

  // Resolve the account and its workspace rules once. Everything below needs
  // them, and loading them per automation (as an `include`) was pure waste on a
  // small VPS.
  const account = await prisma.instagramAccount.findUnique({
    where: { instagramId: instagramAccountId },
    select: {
      id: true,
      workspaceId: true,
      workspace: {
        select: { contactCooldownHours: true, optOutKeywords: true },
      },
    },
  });
  if (!account) return;

  const contact = await getOrCreateContact({
    workspaceId: account.workspaceId,
    instagramAccountId: account.id,
    igsid: senderId,
    inbound: true,
  });

  // A stop word never gets an automated answer — it silences every automation
  // for this person instead. Checked before any campaign matching so an opt-out
  // can never itself trigger a reply. A story mention carries no text, so there
  // is nothing to check.
  if (
    trigger !== "STORY_MENTION" &&
    isOptOutMessage(messageText, account.workspace.optOutKeywords)
  ) {
    if (!contact.optedOut) {
      await optOutContact(
        contact.id,
        `Contact replied "${messageText.trim().slice(0, 40)}"`
      );
      console.log(
        `[DM Worker] Contact ${senderId} opted out of automations via message`
      );
    }
    return;
  }

  // Which switch makes a campaign eligible depends on where the message came
  // from. A story reply is not a DM, even though Instagram delivers both through
  // the same webhook.
  const triggerFilter =
    trigger === "STORY_MENTION"
      ? { storyMentionTriggerEnabled: true }
      : trigger === "STORY_REPLY"
        ? { storyReplyTriggerEnabled: true }
        : { dmTriggerEnabled: true };

  const automations = await prisma.automation.findMany({
    where: {
      ...triggerFilter,
      isActive: true,
      instagramAccountId: account.id,
    },
    select: {
      id: true,
      workspaceId: true,
      instagramAccountId: true,
      keywords: true,
      matchAnyWord: true,
      wholeWordMatch: true,
      dmMessage: true,
      linkButtonLabel: true,
      requireFollow: true,
      followPromptMessage: true,
      followPromptButtonLabel: true,
      sendFrequency: true,
      resendCooldownHours: true,
      requiredTags: true,
      excludedTags: true,
      instagramAccount: {
        select: { instagramId: true, accessToken: true },
      },
      trackedLinks: {
        select: { slug: true, label: true, destinationUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Dedupe key for the log row. Per message id, so a retry of THIS job cannot
  // double-send. It is deliberately not the frequency guard — that lives in
  // canSendAutomation and is keyed on the person, because every new message
  // carries a new id and would otherwise look like a brand-new conversation.
  const dedupeId = `dm:${messageId}`;

  // Freshest view of the contact's send history, advanced locally as we go so a
  // single inbound message matching three campaigns cannot slip three DMs past
  // the workspace anti-flood cap inside one job.
  let contactState = contact;

  // Frequency scope: a story reply or mention is scoped to that story, the way a
  // comment is scoped to its post, so ONCE_PER_POST means once per story. Falls
  // back to the DM scope when Instagram does not name the story.
  const scopeKey = storyId ? `story:${storyId}` : DM_SCOPE;

  for (const automation of automations) {
    // A story mention has no text at all, so keywords cannot apply — every
    // mention matches. Anything with text goes through the normal matcher.
    const matchResult =
      automation.matchAnyWord || trigger === "STORY_MENTION"
        ? { matched: true, matchedKeyword: null }
        : matchKeywords(
            messageText,
            automation.keywords,
            automation.wholeWordMatch
          );

    if (!matchResult.matched) continue;

    const logKey = {
      automationId_commentId: {
        automationId: automation.id,
        commentId: dedupeId,
      },
    } as const;

    const existingLog = await prisma.dmLog.findUnique({
      where: logKey,
      select: { status: true },
    });

    // This exact message was already handled (sent, or deliberately skipped) —
    // a job retry must not act on it again. FAILED stays open so BullMQ's retry
    // can have another go.
    if (
      existingLog &&
      existingLog.status !== "PENDING" &&
      existingLog.status !== "FAILED"
    ) {
      continue;
    }

    const logBase = {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      commenterId: senderId,
      commenterName: contactState.username,
      commentText:
        messageText ||
        (trigger === "STORY_MENTION" ? "(menção em story)" : ""),
      commentId: dedupeId,
      matchedKeyword: matchResult.matchedKeyword,
    };

    const writeLog = (
      status: DmStatus,
      extra: { errorMessage?: string | null; dmSentAt?: Date } = {}
    ) =>
      prisma.dmLog.upsert({
        where: logKey,
        create: { ...logBase, status, ...extra },
        update: { status, ...extra },
      });

    // The frequency gate. This is what stops the same person receiving the same
    // automated message every time they write. A blocked send is logged with its
    // reason rather than silently dropped — the silence is what made this bug
    // invisible for so long.
    const decision = await canSendAutomation({
      contact: contactState,
      automation,
      workspaceCooldownHours: account.workspace.contactCooldownHours,
      scopeKey,
    });

    if (!decision.allowed) {
      await writeLog(decision.status, { errorMessage: decision.reason });
      continue;
    }

    if (!automation.instagramAccount.accessToken) {
      await writeLog("FAILED", {
        errorMessage: "No Instagram access token available",
      });
      continue;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(automation.instagramAccount.accessToken);
    } catch {
      await writeLog("FAILED", {
        errorMessage: "Failed to decrypt Instagram access token",
      });
      continue;
    }

    const commenterName = contactState.username;

    // Follow gate: anyone not confirmed as a follower gets the prompt instead of
    // the link, with the same `followcheck:` button that re-verifies on tap.
    // `null` (unverifiable) prompts too — this is first contact, exactly like a
    // comment, so it follows processComment's fail-closed rule rather than the
    // postback path's fail-open one. Fail-open is only safe after a tap, where
    // the user has already claimed to follow; here it would hand the link to
    // anyone whose status the API happens not to resolve.
    let sendFollowPrompt = false;
    if (automation.requireFollow) {
      const follows = await getUserFollowStatus(accessToken, senderId);
      sendFollowPrompt = follows !== true;
    }

    const usage = await reserveWorkspaceDMSend(automation.workspaceId);
    if (!usage.allowed) {
      await writeLog("SKIPPED_PLAN_LIMIT", {
        errorMessage: `Monthly DM limit reached (${usage.limit})`,
      });
      continue;
    }

    try {
      if (sendFollowPrompt) {
        const promptText = renderMessageWithoutLink({
          message:
            automation.followPromptMessage ||
            "Falta pouco! Me segue e toca no botão abaixo para pegar seu link 💛",
          commenterName,
        });
        await sendDirectMessageWithButton(
          accessToken,
          automation.instagramAccount.instagramId,
          senderId,
          promptText,
          automation.followPromptButtonLabel || "Estou te seguindo ✅",
          `followcheck:${automation.id}`
        );
      } else {
        await sendRevealDirectMessage(
          accessToken,
          automation,
          senderId,
          commenterName,
          trigger === "STORY_MENTION"
            ? "story mention trigger"
            : trigger === "STORY_REPLY"
              ? "story reply trigger"
              : "message trigger"
        );

        // The link has been delivered, so the sequence applies here exactly as it
        // does after a button tap. Not started behind the follow prompt — no
        // link went out yet in that branch.
        await scheduleSequenceStep({
          instagramAccountId: automation.instagramAccount.instagramId,
          userId: senderId,
          automationId: automation.id,
          commenterName,
          afterOrder: 0,
        });
      }

      // Both branches delivered an automated message to this person, so both
      // count against the frequency rules. Recorded only after Meta accepted
      // the send, so a rejected message never blocks the next attempt.
      await recordAutomationSend({
        contactId: contactState.id,
        automationId: automation.id,
        scopeKey,
      });
      contactState = { ...contactState, lastAutomationSentAt: new Date() };

      await writeLog("SENT", { dmSentAt: new Date(), errorMessage: null });
    } catch (error) {
      await releaseWorkspaceDMReservation(
        automation.workspaceId,
        usage.periodStart
      );

      // Mesma marcação do caminho de comentário: token morto vira estado da
      // conta, não só uma linha de log que ninguém vê.
      if (isTokenDead(error)) {
        await markTokenInvalid(automation.instagramAccountId, formatError(error));
      }

      await prisma.dmLog.upsert({
        where: logKey,
        create: {
          ...logBase,
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
        update: {
          status: "FAILED",
          attempts: job.attemptsMade + 1,
          errorMessage: formatError(error),
        },
      });
      throw error;
    }
  }
}

/**
 * Um destinatário de um Envio ativo.
 *
 * A janela é reconferida **aqui**, e não só na hora de montar a audiência: com
 * o espaçamento entre envios, o último da fila pode chegar bem depois do
 * primeiro, e a janela dele pode ter fechado nesse meio tempo. Enviar assim
 * tomaria recusa da Meta e contaria como tentativa fora da política.
 */
async function processBroadcastRecipient(
  job: Job<ProcessBroadcastRecipientJob>
): Promise<void> {
  const { broadcastId, recipientId } = job.data;

  const recipient = await prisma.broadcastRecipient.findUnique({
    where: { id: recipientId },
    select: {
      id: true,
      status: true,
      broadcast: {
        select: {
          id: true,
          status: true,
          message: true,
          instagramAccount: {
            select: {
              id: true,
              instagramId: true,
              accessToken: true,
              tokenInvalidAt: true,
            },
          },
        },
      },
      contact: {
        select: {
          id: true,
          igsid: true,
          username: true,
          optedOut: true,
          lastInboundAt: true,
        },
      },
    },
  });

  // Já resolvido: um retry do BullMQ depois de um envio bem-sucedido cai aqui, e
  // reenviar seria mandar a mesma mensagem duas vezes para a mesma pessoa.
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.broadcast.id !== broadcastId) return;

  const finish = async (
    status: "SENT" | "FAILED" | "SKIPPED_WINDOW_CLOSED" | "SKIPPED_OPTED_OUT" | "SKIPPED_CANCELLED",
    reason?: string
  ) => {
    const counter =
      status === "SENT"
        ? { sentCount: { increment: 1 } }
        : status === "FAILED"
          ? { failedCount: { increment: 1 } }
          : { skippedCount: { increment: 1 } };

    // `updateMany` condicionado a PENDING, e não um `update` solto: se o BullMQ
    // redistribuir um job travado, duas execuções podem chegar aqui para o mesmo
    // destinatário. Com a condição, só a primeira resolve — a segunda escreve
    // zero linhas e não incrementa o contador do envio.
    //
    // (Isto fecha a contagem dupla. O envio em si já saiu antes deste ponto, e
    // proteger contra isso exigiria um estado "enviando" que, num processo
    // morto no meio, deixaria o destinatário travado para sempre — remédio pior
    // que a doença para um caso que depende do lock do BullMQ expirar.)
    const claimed = await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, status: "PENDING" },
      data: {
        status,
        reason: reason ?? null,
        ...(status === "SENT" ? { sentAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) return;

    await prisma.broadcast.update({ where: { id: broadcastId }, data: counter });

    await closeBroadcastIfDone(broadcastId);
  };

  if (recipient.broadcast.status === "CANCELLED") {
    await finish("SKIPPED_CANCELLED", "O envio foi cancelado antes da vez desta pessoa");
    return;
  }

  // Pediu para parar depois que a audiência foi montada. O opt-out vale sempre,
  // e um envio já disparado não é exceção.
  if (recipient.contact.optedOut) {
    await finish("SKIPPED_OPTED_OUT", "A pessoa pediu para parar de receber mensagens");
    return;
  }

  if (!isWindowOpen(recipient.contact.lastInboundAt)) {
    await finish(
      "SKIPPED_WINDOW_CLOSED",
      "A janela de 24h fechou antes da vez desta pessoa"
    );
    return;
  }

  const account = recipient.broadcast.instagramAccount;

  // Token já morto: os destinatários restantes deste disparo tomariam a mesma
  // recusa. Desistir aqui é o que impede um envio de 500 pessoas virar 500
  // chamadas à Meta com um token que ela já recusou.
  if (account.tokenInvalidAt) {
    await finish(
      "FAILED",
      "A conta do Instagram está desconectada. Reconecte em Configurações para voltar a enviar."
    );
    return;
  }

  if (!account.accessToken) {
    await finish("FAILED", "A conta do Instagram está sem token");
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.accessToken);
  } catch {
    await finish("FAILED", "Não foi possível ler o token da conta");
    return;
  }

  try {
    await sendDirectMessage(
      accessToken,
      account.instagramId,
      recipient.contact.igsid,
      renderMessageWithoutLink({
        message: recipient.broadcast.message,
        commenterName: recipient.contact.username,
      })
    );
  } catch (error) {
    // Um token morto no meio de um disparo recusaria todos os destinatários
    // seguintes igual. Marcar aqui faz os jobs restantes desistirem na hora.
    if (isTokenDead(error)) {
      await markTokenInvalid(account.id, formatError(error));
    }
    await finish("FAILED", formatError(error));
    return;
  }

  await finish("SENT");
}

/**
 * Fecha o envio quando não sobra ninguém pendente.
 *
 * Um `updateMany` condicionado a `status: "SENDING"`, e não um `update` solto:
 * dois destinatários terminando ao mesmo tempo chamam isto em paralelo, e sem a
 * condição os dois escreveriam `finishedAt`.
 */
async function closeBroadcastIfDone(broadcastId: string): Promise<void> {
  const pending = await prisma.broadcastRecipient.count({
    where: { broadcastId, status: "PENDING" },
  });
  if (pending > 0) return;

  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: "SENDING" },
    data: { status: "DONE", finishedAt: new Date() },
  });
}

async function processJob(job: Job<DmQueueJob>): Promise<void> {
  if (job.name === POSTBACK_JOB_NAME) {
    return processPostback(job as Job<ProcessPostbackJob>);
  }
  if (job.name === FOLLOWUP_JOB_NAME) {
    return processFollowUp(job as Job<ProcessFollowUpJob>);
  }
  if (job.name === MESSAGE_JOB_NAME) {
    return processMessage(job as Job<ProcessMessageJob>);
  }
  if (job.name === BROADCAST_JOB_NAME) {
    return processBroadcastRecipient(job as Job<ProcessBroadcastRecipientJob>);
  }
  return processComment(job as Job<ProcessCommentJob>);
}

async function recordWorkerFailure(
  job: Job<DmQueueJob> | undefined,
  error: Error
) {
  try {
    // Um job de Envio ativo é endereçado por destinatário, não por conta, então
    // não carrega `instagramAccountId` — mesmo estreitamento usado no commentId.
    const instagramAccountId =
      job && "instagramAccountId" in job.data
        ? job.data.instagramAccountId
        : undefined;
    const commentId =
      job && "commentId" in job.data ? job.data.commentId : null;
    const account = instagramAccountId
      ? await prisma.instagramAccount.findUnique({
          where: { instagramId: instagramAccountId },
          select: { workspaceId: true },
        })
      : null;

    await prisma.operationalEvent.create({
      data: {
        workspaceId: account?.workspaceId ?? null,
        source: "WORKER",
        level: "ERROR",
        message: `DM worker job ${job?.id ?? "unknown"} failed: ${error.message}`,
        payload: {
          jobId: job?.id ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          instagramAccountId: instagramAccountId ?? null,
          commentId,
        },
      },
    });

    await recordWorkerAlert({
      level: "error",
      message: error.message,
      jobId: job?.id,
      instagramAccountId,
      commentId: commentId ?? undefined,
    });
  } catch (recordError) {
    console.error(
      "[DM Worker] Failed to record worker failure:",
      formatError(recordError)
    );
  }
}

export function createDMWorker(): Worker<DmQueueJob> {
  const worker = new Worker<DmQueueJob>(
    "dm-processing",
    processJob,
    {
      connection: getRedisConnection(),
      // Kept low by default: this runs on a small VPS beside the web app, and the
      // work is almost entirely waiting on Meta, not CPU. Raise WORKER_CONCURRENCY
      // only if the queue visibly backs up.
      concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2)),
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          BACKOFF_DELAYS[Math.min(attemptsMade - 1, BACKOFF_DELAYS.length - 1)],
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[DM Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[DM Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message
    );
    void recordWorkerFailure(job, err);
  });

  worker.on("error", (err) => {
    console.error("[DM Worker] Worker error:", err.message);
    void prisma.operationalEvent
      .create({
        data: {
          source: "WORKER",
          level: "ERROR",
          message: `DM worker process error: ${err.message}`,
          payload: { name: err.name },
        },
      })
      .catch((recordError) => {
        console.error(
          "[DM Worker] Failed to record worker process error:",
          formatError(recordError)
        );
      });
  });

  return worker;
}

