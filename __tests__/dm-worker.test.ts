import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  mockSendPrivateReply,
  mockSendPrivateReplyWithLinkButton,
  mockSendPrivateReplyWithButton,
  mockGetUserFollowStatus,
  mockSendDirectMessageWithButton,
  mockSendDirectMessage,
  mockSendDirectMessageWithLinkButton,
  mockDecryptToken,
  mockMatchKeywords,
  mockReserveDMSlot,
  mockQueueAdd,
  mockReserveWorkspaceDMSend,
  mockReleaseWorkspaceDMReservation,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    dmLog: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    instagramAccount: {
      findUnique: vi.fn(),
    },
    contact: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    contactAutomationState: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    automationStep: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    operationalEvent: {
      create: vi.fn(),
    },
  },
  mockSendPrivateReply: vi.fn(),
  mockSendPrivateReplyWithLinkButton: vi.fn(),
  mockSendPrivateReplyWithButton: vi.fn(),
  mockGetUserFollowStatus: vi.fn(),
  mockSendDirectMessageWithButton: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockReserveDMSlot: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockReserveWorkspaceDMSend: vi.fn(),
  mockReleaseWorkspaceDMReservation: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  sendPrivateReplyWithLinkButton: mockSendPrivateReplyWithLinkButton,
  sendPrivateReplyWithButton: mockSendPrivateReplyWithButton,
  getUserFollowStatus: mockGetUserFollowStatus,
  sendDirectMessageWithButton: mockSendDirectMessageWithButton,
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendCommentReply: vi.fn(),
  MetaApiError: class MetaApiError extends Error {
    code: number;
    constructor(
      code: number,
      _subcode: number | undefined,
      _fbTraceId: string | undefined,
      message: string
    ) {
      super(message);
      this.code = code;
      this.name = "MetaApiError";
    }
  },
  TokenExpiredError: class TokenExpiredError extends Error {
    name = "TokenExpiredError";
  },
  RateLimitError: class RateLimitError extends Error {
    name = "RateLimitError";
  },
}));

vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
}));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: mockReserveDMSlot,
}));

vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: mockReserveWorkspaceDMSend,
  releaseWorkspaceDMReservation: mockReleaseWorkspaceDMReservation,
}));

vi.mock("@/lib/ops/worker-health", () => ({
  recordWorkerAlert: vi.fn(),
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({
    add: mockQueueAdd,
  }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
  BROADCAST_JOB_NAME: "process-broadcast-recipient",
}));

vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (global as Record<string, unknown>).__dmWorkerProcessor = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }
  return {
    Worker: MockWorker,
  };
});

import { createDMWorker } from "../lib/queue/dm-worker";

const usagePeriodStart = new Date("2026-05-01T00:00:00.000Z");

const mockAutomation = {
  id: "auto_789",
  workspaceId: "workspace_123",
  instagramAccountId: "ig_account_row_1",
  postId: "media_101",
  keywords: ["LINK", "PRICE"],
  dmMessage: "Hey {username}! Here is the link: https://example.com",
  isActive: true,
  wholeWordMatch: true,
  matchAnyPost: false,
  matchAnyWord: false,
  openingDmEnabled: false,
  openingDmMessage: null,
  openingDmButtonLabel: null,
  linkButtonLabel: null,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
  instagramAccount: {
    id: "ig_account_row_1",
    instagramId: "ig_456",
    accessToken: "encrypted_token_abc",
  },
  workspace: {
    id: "workspace_123",
    // Off by default so the per-automation rule is what each test exercises.
    contactCooldownHours: 0,
    optOutKeywords: [],
  },
  sendFrequency: "ONCE_PER_CONTACT",
  resendCooldownHours: 24,
  requiredTags: [],
  excludedTags: [],
  storyReplyTriggerEnabled: false,
  storyMentionTriggerEnabled: false,
  trackedLinks: [],
};

const mockJobData = {
  instagramAccountId: "ig_456",
  commentId: "comment_555",
  commentText: "I want the LINK!",
  commenterId: "commenter_999",
  commenterName: "commenter_user",
  mediaId: "media_101",
};

function getProcessor(): (job: {
  name?: string;
  data: typeof mockJobData | Record<string, unknown>;
  id: string;
  attemptsMade: number;
}) => Promise<void> {
  createDMWorker();
  return (global as Record<string, unknown>).__dmWorkerProcessor as (job: {
    name?: string;
    data: typeof mockJobData | Record<string, unknown>;
    id: string;
    attemptsMade: number;
  }) => Promise<void>;
}

function createMockJob(data = mockJobData) {
  return {
    data,
    id: "job_001",
    attemptsMade: 0,
  };
}

function createMockPostbackJob(
  data: Record<string, unknown> = {
    instagramAccountId: "ig_456",
    userId: "commenter_999",
    payload: "reveal:auto_789",
  }
) {
  return {
    name: "process-postback",
    data,
    id: "postback_job_001",
    attemptsMade: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockPrisma.automation.findMany.mockResolvedValue([mockAutomation]);
  mockPrisma.automation.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.create.mockResolvedValue({});
  // Two different lookups share findFirst: the cross-campaign private-reply
  // check (keyed on status SENT) and the postback's name lookup. Only the
  // latter should resolve by default, or every comment would look like a
  // duplicate of an already-answered one.
  mockPrisma.dmLog.findFirst.mockImplementation(
    async (args: { where?: { status?: string } } = {}) =>
      args.where?.status === "SENT" ? null : { commenterName: "commenter_user" }
  );
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    id: "ig_account_row_1",
    workspaceId: "workspace_123",
    workspace: { contactCooldownHours: 0, optOutKeywords: [] },
  });
  // A contact nobody has messaged yet: no history, not opted out.
  mockPrisma.contact.upsert.mockResolvedValue({
    id: "contact_1",
    optedOut: false,
    lastAutomationSentAt: null,
    username: "commenter_user",
    tags: [],
  });
  mockPrisma.contact.findUnique.mockResolvedValue(null);
  mockPrisma.contact.update.mockResolvedValue({});
  mockPrisma.contactAutomationState.findMany.mockResolvedValue([]);
  mockPrisma.contactAutomationState.upsert.mockResolvedValue({});
  // Sem sequência configurada, por padrão: nada é agendado depois do link.
  mockPrisma.automationStep.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (ops: unknown) =>
    Array.isArray(ops) ? Promise.all(ops) : ops
  );
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("decrypted_token");
  mockMatchKeywords.mockReturnValue({ matched: true, matchedKeyword: "LINK" });
  mockReserveWorkspaceDMSend.mockResolvedValue({
    allowed: true,
    reserved: true,
    remaining: 100,
    limit: 2000,
    periodStart: usagePeriodStart,
  });
  mockReserveDMSlot.mockResolvedValue({
    allowed: true,
    currentCount: 11,
    remainingDMs: 179,
    shouldRequeue: false,
    requeueDelayMs: 0,
    shouldSkip: false,
    reserved: true,
  });
  mockReleaseWorkspaceDMReservation.mockResolvedValue({ count: 1 });
  mockSendPrivateReply.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_001",
  });
  mockSendPrivateReplyWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_002",
  });
  mockSendPrivateReplyWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_003",
  });
  mockSendDirectMessageWithButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_004",
  });
  mockSendDirectMessage.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_005",
  });
  mockSendDirectMessageWithLinkButton.mockResolvedValue({
    recipient_id: "commenter_999",
    message_id: "msg_006",
  });
  mockGetUserFollowStatus.mockResolvedValue(true);
});

describe("DM Worker — Full Pipeline", () => {
  it("should send a private reply for a matching comment", async () => {
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ postId: "media_101" }, { matchAnyPost: true }],
        isActive: true,
        instagramAccount: { instagramId: "ig_456" },
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
    expect(mockMatchKeywords).toHaveBeenCalledWith(
      "I want the LINK!",
      ["LINK", "PRICE"],
      true
    );
    expect(mockReserveWorkspaceDMSend).toHaveBeenCalledWith("workspace_123");
    expect(mockReserveDMSlot).toHaveBeenCalledWith("ig_456", 0);
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted_token_abc");
    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    expect(mockReleaseWorkspaceDMReservation).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({ status: "SENT" }),
    });
  });

  it("should skip when no automations match the media", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
  });

  it("should skip when keywords do not match", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip duplicate comments already sent", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_log",
      status: "SENT",
    });
    const processor = getProcessor();

    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should skip when monthly plan limit is reached", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 100,
      periodStart: usagePeriodStart,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReserveDMSlot).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });

  it("should requeue and release monthly usage when rate limited", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: true,
      requeueDelayMs: 1800000,
      shouldSkip: false,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        commentId: "comment_555",
        requeueAttempt: 1,
      }),
      expect.objectContaining({
        delay: 1800000,
        jobId: "comment_ig_456_comment_555_retry_1",
      })
    );
  });

  it("should skip with SKIPPED_RATE_LIMIT after max requeue attempts", async () => {
    mockReserveDMSlot.mockResolvedValue({
      allowed: false,
      currentCount: 190,
      remainingDMs: 0,
      shouldRequeue: false,
      requeueDelayMs: 0,
      shouldSkip: true,
      reserved: false,
    });

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SKIPPED_RATE_LIMIT" }),
      })
    );
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should log FAILED, release usage, and re-throw when private reply sending fails", async () => {
    const error = new Error("API Error");
    mockSendPrivateReply.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(processor(createMockJob())).rejects.toThrow("API Error");
    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "comment_555",
        },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "API Error",
      }),
    });
  });

  it("should handle missing access token", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        instagramAccount: {
          ...mockAutomation.instagramAccount,
          accessToken: null,
        },
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No Instagram access token available",
        }),
      })
    );
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("drops the {username} placeholder when the person has no name", async () => {
    const processor = getProcessor();
    const jobDataWithoutName = {
      instagramAccountId: mockJobData.instagramAccountId,
      commentId: mockJobData.commentId,
      commentText: mockJobData.commentText,
      commenterId: mockJobData.commenterId,
      mediaId: mockJobData.mediaId,
    };

    await processor(createMockJob(jobDataWithoutName as typeof mockJobData));

    expect(mockSendPrivateReply).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      // Sem nome, o placeholder sai junto com o espaco anterior. O fallback
      // antigo era a palavra "there", que num app em portugues virava "Oi there".
      "Hey! Here is the link: https://example.com"
    );
  });

  it("should deliver tracked links as web_url buttons (one or two)", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        dmMessage: "Hey {username}! Here is the offer: {link}",
        linkButtonLabel: "Get offer",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
          {
            slug: "def456",
            label: "Book a call",
            destinationUrl: "https://example.com/book",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Primary button title comes from linkButtonLabel; the second from its
    // own stored label. Both point at their tracked /r/<slug> URLs.
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the offer:",
      [
        { title: "Get offer", url: "http://localhost:3000/r/abc123" },
        { title: "Book a call", url: "http://localhost:3000/r/def456" },
      ]
    );
  });

  it("should send a follow-gate prompt when a non-follower comments", async () => {
    mockGetUserFollowStatus.mockResolvedValue(false); // not following yet
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        requireFollow: true,
        followPromptMessage: "Follow me first {username}, then tap 👇",
        followPromptButtonLabel: "Estou te seguindo ✅",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // The follow prompt goes out with a `followcheck:` postback button; the
    // link is NOT delivered yet.
    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Follow me first commenter_user, then tap 👇",
      "Estou te seguindo ✅",
      "followcheck:auto_789"
    );
    expect(mockSendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should skip the prompt and send the link when the commenter already follows", async () => {
    mockGetUserFollowStatus.mockResolvedValue(true); // already following
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        requireFollow: true,
        followPromptMessage: "Follow me first, then tap 👇",
        followPromptButtonLabel: "Estou te seguindo ✅",
        dmMessage: "Hey {username}! Here is the offer: {link}",
        linkButtonLabel: "Get offer",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Confirmed follower: no prompt, link delivered right away.
    expect(mockSendPrivateReplyWithButton).not.toHaveBeenCalled();
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user! Here is the offer:",
      [{ title: "Get offer", url: "http://localhost:3000/r/abc123" }]
    );
  });

  it("should send the opening DM first (routing to the follow check) when both opening DM and follow-gate are on", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        openingDmEnabled: true,
        openingDmMessage: "Hey {username}, welcome!",
        openingDmButtonLabel: "Get the link",
        requireFollow: true,
        followPromptButtonLabel: "Estou te seguindo ✅",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Primary campaign link",
            destinationUrl: "https://example.com",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockJob());

    // Opening DM goes out first; its button routes into the follow check.
    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "comment_555",
      "Hey commenter_user, welcome!",
      "Get the link",
      "followcheck:auto_789"
    );
    // Follow status is verified on the tap, not at comment time.
    expect(mockGetUserFollowStatus).not.toHaveBeenCalled();
    expect(mockSendPrivateReplyWithLinkButton).not.toHaveBeenCalled();
  });

  it("should deliver the next DM from a read fallback when no button tap has sent it yet", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockPrisma.dmLog.findUnique).toHaveBeenCalledWith({
      where: {
        automationId_commentId: {
          automationId: "auto_789",
          commentId: "reveal:commenter_999",
        },
      },
    });
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
  });

  it("should not deliver a read fallback when the button tap already sent the reveal", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockPrisma.dmLog.findUnique.mockResolvedValue({
      id: "existing_reveal",
      status: "SENT",
    });

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should not let a read fallback bypass the follow gate", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      trackedLinks: [],
    });
    mockGetUserFollowStatus.mockResolvedValue(false); // still not following

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    // Non-follower on a read fallback: no link, and no re-prompt spam either.
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendDirectMessageWithButton).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should deliver a follow-gated read fallback once the user follows", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      requireFollow: true,
      trackedLinks: [],
    });
    mockGetUserFollowStatus.mockResolvedValue(true);

    const processor = getProcessor();
    await processor(
      createMockPostbackJob({
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        payload: "reveal:auto_789",
        fallback: true,
      })
    );

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
  });

  it("should not log a failure when a read fallback hits a closed messaging window", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockSendDirectMessage.mockRejectedValue(
      new Error("This message is sent outside of allowed window.")
    );

    const processor = getProcessor();
    // The window cannot reopen on its own, so this must not throw (no retries)
    // and must not leave a FAILED row the user can do nothing about.
    await expect(
      processor(
        createMockPostbackJob({
          instagramAccountId: "ig_456",
          userId: "commenter_999",
          payload: "reveal:auto_789",
          fallback: true,
        })
      )
    ).resolves.toBeUndefined();

    expect(mockPrisma.dmLog.upsert).not.toHaveBeenCalled();
    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalled();
  });

  it("should still log a failure for a real button tap that fails", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...mockAutomation,
      trackedLinks: [],
    });
    mockSendDirectMessage.mockRejectedValue(new Error("boom"));

    const processor = getProcessor();
    await expect(
      processor(
        createMockPostbackJob({
          instagramAccountId: "ig_456",
          userId: "commenter_999",
          payload: "reveal:auto_789",
        })
      )
    ).rejects.toThrow("boom");

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});

describe("DM Worker — message sequence after the link", () => {
  function createMockStepJob(data: Record<string, unknown> = {}) {
    return {
      name: "process-followup",
      data: {
        instagramAccountId: "ig_456",
        userId: "commenter_999",
        automationId: "auto_789",
        commenterName: "commenter_user",
        stepOrder: 1,
        ...data,
      },
      id: "step_job_001",
      attemptsMade: 0,
    };
  }

  /** An automation carrying one step of the sequence, as the worker loads it. */
  function automationWithStep(
    step: { order: number; message: string; delayMinutes?: number } | null
  ) {
    return {
      ...mockAutomation,
      steps: step
        ? [{ ...step, delayMinutes: step.delayMinutes ?? 0 }]
        : [],
    };
  }

  it("should start the sequence once the link is delivered", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(mockAutomation);
    mockPrisma.automationStep.findFirst.mockResolvedValue({
      order: 1,
      delayMinutes: 10,
    });

    const processor = getProcessor();
    await processor(createMockPostbackJob());

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ automationId: "auto_789", stepOrder: 1 }),
      expect.objectContaining({
        delay: 10 * 60_000,
        jobId: "step_auto_789_commenter_999_1",
      })
    );
  });

  it("should send a step and then queue the one after it", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(
      automationWithStep({ order: 1, message: "e aí, funcionou?" })
    );
    mockPrisma.automationStep.findFirst.mockResolvedValue({
      order: 2,
      delayMinutes: 60,
    });

    const processor = getProcessor();
    await processor(createMockStepJob());

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "e aí, funcionou?"
    );
    // The chain walks forward one job at a time rather than being queued up
    // front, which is what lets an opt-out midway stop the rest.
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "process-followup",
      expect.objectContaining({ stepOrder: 2 }),
      expect.objectContaining({ delay: 60 * 60_000 })
    );
  });

  it("should send nothing and stop the chain for a contact who opted out", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(
      automationWithStep({ order: 1, message: "e aí, funcionou?" })
    );
    mockPrisma.contact.findUnique.mockResolvedValue({ optedOut: true });

    const processor = getProcessor();
    await processor(createMockStepJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("should not queue the next step when this one failed to send", async () => {
    // Usually a closed 24-hour window, which rejects every later step too.
    mockPrisma.automation.findFirst.mockResolvedValue(
      automationWithStep({ order: 1, message: "e aí, funcionou?" })
    );
    mockPrisma.automationStep.findFirst.mockResolvedValue({
      order: 2,
      delayMinutes: 60,
    });
    mockSendDirectMessage.mockRejectedValue(
      new Error("outside of allowed window")
    );

    const processor = getProcessor();
    await processor(createMockStepJob());

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("should treat a job with no step order as step 1", async () => {
    // Jobs already queued when sequences shipped were the single follow-up,
    // which the migration turned into step 1.
    mockPrisma.automation.findFirst.mockResolvedValue(
      automationWithStep({ order: 1, message: "obrigado por seguir" })
    );

    const processor = getProcessor();
    await processor(createMockStepJob({ stepOrder: undefined }));

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "obrigado por seguir"
    );
  });

  it("should do nothing when the step no longer exists", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(automationWithStep(null));

    const processor = getProcessor();
    await processor(createMockStepJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("should queue nothing after the link when there is no sequence", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(mockAutomation);
    mockPrisma.automationStep.findFirst.mockResolvedValue(null);

    const processor = getProcessor();
    await processor(createMockPostbackJob());

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe("DM Worker — story triggers", () => {
  const storyAutomation = {
    ...mockAutomation,
    dmTriggerEnabled: false,
    storyReplyTriggerEnabled: true,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
  };

  function createMockStoryJob(data: Record<string, unknown> = {}) {
    return {
      name: "process-message",
      data: {
        instagramAccountId: "ig_456",
        messageId: "mid_story",
        messageText: "quero o LINK",
        senderId: "commenter_999",
        trigger: "STORY_REPLY",
        storyId: "story_1",
        ...data,
      },
      id: "story_job_001",
      attemptsMade: 0,
    };
  }

  beforeEach(() => {
    mockPrisma.automation.findMany.mockResolvedValue([storyAutomation]);
  });

  it("should look for story-reply campaigns, not DM campaigns", async () => {
    const processor = getProcessor();
    await processor(createMockStoryJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ storyReplyTriggerEnabled: true }),
      })
    );
    expect(mockSendDirectMessage).toHaveBeenCalled();
  });

  it("should scope frequency to the story it replies to", async () => {
    const processor = getProcessor();
    await processor(createMockStoryJob());

    // Scoped like a comment is scoped to its post, so ONCE_PER_POST means once
    // per story rather than once ever.
    expect(mockPrisma.contactAutomationState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contactId_automationId_scopeKey: {
            contactId: "contact_1",
            automationId: "auto_789",
            scopeKey: "story:story_1",
          },
        },
      })
    );
  });

  it("should answer a story mention even though it carries no text", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...storyAutomation,
        storyReplyTriggerEnabled: false,
        storyMentionTriggerEnabled: true,
        // Keywords are set and matchAnyWord is off: a mention still matches,
        // because there is no text for a keyword to be found in.
        matchAnyWord: false,
      },
    ]);
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });

    const processor = getProcessor();
    await processor(
      createMockStoryJob({
        trigger: "STORY_MENTION",
        messageText: "",
        storyId: undefined,
      })
    );

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ storyMentionTriggerEnabled: true }),
      })
    );
    expect(mockSendDirectMessage).toHaveBeenCalled();
  });

  it("should not read a stop word out of a text-less story mention", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...storyAutomation,
        storyReplyTriggerEnabled: false,
        storyMentionTriggerEnabled: true,
      },
    ]);

    const processor = getProcessor();
    await processor(
      createMockStoryJob({ trigger: "STORY_MENTION", messageText: "" })
    );

    expect(mockPrisma.contact.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ optedOut: true }),
      })
    );
  });

  it("should still mute someone who replies to a story with a stop word", async () => {
    const processor = getProcessor();
    await processor(createMockStoryJob({ messageText: "parar" }));

    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ optedOut: true }),
      })
    );
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("should treat a job with no trigger as a plain DM", async () => {
    // Jobs already queued when this shipped carry no trigger field.
    const processor = getProcessor();
    await processor(createMockStoryJob({ trigger: undefined }));

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dmTriggerEnabled: true }),
      })
    );
  });
});

describe("DM Worker — one private reply per comment", () => {
  it("should skip a campaign when another already used the comment's private reply", async () => {
    mockPrisma.dmLog.findFirst.mockImplementation(
      async (args: { where?: { status?: string } } = {}) =>
        args.where?.status === "SENT"
          ? { automation: { name: "openreply 1" } }
          : { commenterName: "commenter_user" }
    );

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED_DEDUP",
          errorMessage: expect.stringContaining("openreply 1"),
        }),
      })
    );
  });

  it("should not fall back to a plain-text private reply when the window is the problem", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        trackedLinks: [
          { slug: "abc123", label: null, destinationUrl: "https://example.com" },
        ],
      },
    ]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(
      new Error("The comment is invalid for a private reply")
    );

    const processor = getProcessor();
    await expect(processor(createMockJob())).rejects.toThrow(
      "The comment is invalid for a private reply"
    );

    // A text retry on the same comment would fail identically and overwrite the
    // real reason, so it must not be attempted.
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "The comment is invalid for a private reply",
        }),
      })
    );
  });

  it("should still fall back to plain text when the button template itself is rejected", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...mockAutomation,
        trackedLinks: [
          { slug: "abc123", label: null, destinationUrl: "https://example.com" },
        ],
      },
    ]);
    mockSendPrivateReplyWithLinkButton.mockRejectedValue(
      new Error("Unsupported message template")
    );

    const processor = getProcessor();
    await processor(createMockJob());

    expect(mockSendPrivateReply).toHaveBeenCalled();
    expect(mockPrisma.dmLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      })
    );
  });
});

describe("DM Worker — DM keyword trigger", () => {
  const dmTriggerAutomation = {
    ...mockAutomation,
    dmTriggerEnabled: true,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
  };

  function createMockMessageJob(data: Record<string, unknown> = {}) {
    return {
      name: "process-message",
      data: {
        instagramAccountId: "ig_456",
        messageId: "mid_abc",
        messageText: "can I get the LINK?",
        senderId: "commenter_999",
        ...data,
      },
      id: "message_job_001",
      attemptsMade: 0,
    };
  }

  beforeEach(() => {
    mockPrisma.automation.findMany.mockResolvedValue([dmTriggerAutomation]);
  });

  it("should reply to a DM whose text matches the campaign keywords", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dmTriggerEnabled: true,
          isActive: true,
        }),
      })
    );
    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      "Hey commenter_user! Here is the link: https://example.com"
    );
    // Never a private reply — there is no comment to reply to.
    expect(mockSendPrivateReply).not.toHaveBeenCalled();
  });

  it("should not reply when the DM text matches no keyword", async () => {
    mockMatchKeywords.mockReturnValue({ matched: false, matchedKeyword: null });

    const processor = getProcessor();
    await processor(createMockMessageJob({ messageText: "hello there" }));

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("should log the reply against the inbound message id for dedup", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          automationId_commentId: {
            automationId: "auto_789",
            commentId: "dm:mid_abc",
          },
        },
        create: expect.objectContaining({
          commenterId: "commenter_999",
          commentText: "can I get the LINK?",
          matchedKeyword: "LINK",
          status: "SENT",
        }),
      })
    );
  });

  it("should not re-send when this message was already answered", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT" });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
  });

  it("should send the link as buttons when the campaign has tracked links", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...dmTriggerAutomation,
        linkButtonLabel: "Get it",
        trackedLinks: [
          {
            slug: "abc123",
            label: "Get it",
            destinationUrl: "https://example.com/offer",
          },
        ],
      },
    ]);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithLinkButton).toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("should send the follow prompt instead of the link to a non-follower", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, requireFollow: true },
    ]);
    mockGetUserFollowStatus.mockResolvedValue(false);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithButton).toHaveBeenCalledWith(
      "decrypted_token",
      "ig_456",
      "commenter_999",
      expect.any(String),
      "Estou te seguindo ✅",
      "followcheck:auto_789"
    );
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  // First contact, so the gate is fail-closed like processComment: an
  // unverifiable status must not hand out the link.
  it("should send the follow prompt when follow status cannot be verified", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, requireFollow: true },
    ]);
    mockGetUserFollowStatus.mockResolvedValue(null);

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessageWithButton).toHaveBeenCalled();
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it("should skip and log when the workspace is over its monthly limit", async () => {
    mockReserveWorkspaceDMSend.mockResolvedValue({
      allowed: false,
      reserved: false,
      remaining: 0,
      limit: 2000,
      periodStart: usagePeriodStart,
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SKIPPED_PLAN_LIMIT" }),
      })
    );
  });

  // The reported bug: every inbound message carried a new mid, so the per-message
  // dedupe never matched and the same person was answered again and again.
  it("should not re-send to someone who already received this automation", async () => {
    mockPrisma.contactAutomationState.findMany.mockResolvedValue([
      {
        scopeKey: "dm",
        sentCount: 1,
        lastSentAt: new Date("2026-09-01T10:00:00.000Z"),
      },
    ]);

    const processor = getProcessor();
    await processor(createMockMessageJob({ messageId: "mid_second" }));

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockReserveWorkspaceDMSend).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "SKIPPED_ALREADY_SENT",
          errorMessage: expect.stringContaining("Já enviada para esta pessoa"),
        }),
      })
    );
  });

  it("should re-send after the cooldown when the campaign allows it", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      {
        ...dmTriggerAutomation,
        sendFrequency: "COOLDOWN",
        resendCooldownHours: 24,
      },
    ]);
    mockPrisma.contactAutomationState.findMany.mockResolvedValue([
      {
        scopeKey: "dm",
        sentCount: 1,
        lastSentAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    ]);

    const processor = getProcessor();
    await processor(createMockMessageJob({ messageId: "mid_later" }));

    expect(mockSendDirectMessage).toHaveBeenCalled();
  });

  it("should record the delivery against the contact so the next message is blocked", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockPrisma.contactAutomationState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contactId_automationId_scopeKey: {
            contactId: "contact_1",
            automationId: "auto_789",
            scopeKey: "dm",
          },
        },
      })
    );
  });

  it("should not record a delivery when Meta rejected the send", async () => {
    mockSendDirectMessage.mockRejectedValue(new Error("Meta is down"));

    const processor = getProcessor();
    await expect(processor(createMockMessageJob())).rejects.toThrow(
      "Meta is down"
    );

    expect(mockPrisma.contactAutomationState.upsert).not.toHaveBeenCalled();
  });

  it("should mute the contact and stay silent when they ask to stop", async () => {
    const processor = getProcessor();
    await processor(createMockMessageJob({ messageText: "parar" }));

    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact_1" },
        data: expect.objectContaining({ optedOut: true }),
      })
    );
    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    // No campaign is even looked up — an opt-out can never trigger a reply.
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("should send nothing to an already muted contact", async () => {
    mockPrisma.contact.upsert.mockResolvedValue({
      id: "contact_1",
      optedOut: true,
      lastAutomationSentAt: null,
      username: "commenter_user",
      tags: [],
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "SKIPPED_OPTED_OUT" }),
      })
    );
  });

  it("should skip an automation whose tag condition the contact fails", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, excludedTags: ["cliente"] },
    ]);
    mockPrisma.contact.upsert.mockResolvedValue({
      id: "contact_1",
      optedOut: false,
      lastAutomationSentAt: null,
      username: "commenter_user",
      tags: ["cliente"],
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    // Decided without touching the history table: a blocked automation costs no
    // query.
    expect(mockPrisma.contactAutomationState.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "SKIPPED_TAG_RULE",
          errorMessage: expect.stringContaining("cliente"),
        }),
      })
    );
  });

  it("should send when the contact carries the required tag", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...dmTriggerAutomation, requiredTags: ["lead"] },
    ]);
    mockPrisma.contact.upsert.mockResolvedValue({
      id: "contact_1",
      optedOut: false,
      lastAutomationSentAt: null,
      username: "commenter_user",
      tags: ["lead"],
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).toHaveBeenCalled();
  });

  it("should hold back a second automation inside the workspace anti-flood window", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue({
      id: "ig_account_row_1",
      workspaceId: "workspace_123",
      workspace: { contactCooldownHours: 12, optOutKeywords: [] },
    });
    mockPrisma.contact.upsert.mockResolvedValue({
      id: "contact_1",
      optedOut: false,
      lastAutomationSentAt: new Date(Date.now() - 60 * 60 * 1000),
      username: "commenter_user",
      tags: [],
    });

    const processor = getProcessor();
    await processor(createMockMessageJob());

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "SKIPPED_COOLDOWN",
          errorMessage: expect.stringContaining("Outra automação já falou"),
        }),
      })
    );
  });

  it("should release the usage reservation and rethrow when the send fails", async () => {
    mockSendDirectMessage.mockRejectedValue(new Error("Meta is down"));

    const processor = getProcessor();
    await expect(processor(createMockMessageJob())).rejects.toThrow(
      "Meta is down"
    );

    expect(mockReleaseWorkspaceDMReservation).toHaveBeenCalledWith(
      "workspace_123",
      usagePeriodStart
    );
    expect(mockPrisma.dmLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });
});
