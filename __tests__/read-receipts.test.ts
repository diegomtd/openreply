import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findUnique: vi.fn() },
    dmLog: { updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { markDmLogsRead } from "@/lib/contacts/read-receipts";

const WATERMARK = Date.UTC(2026, 8, 9, 12, 0, 0);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findUnique.mockResolvedValue({
    id: "ig_account_row_1",
  });
  mockPrisma.dmLog.updateMany.mockResolvedValue({ count: 2 });
});

describe("markDmLogsRead", () => {
  it("marks every send older than the watermark as read", async () => {
    // The receipt is a watermark, not a per-message ack: Instagram says "read
    // everything up to here", so this is a sweep.
    const count = await markDmLogsRead({
      instagramAccountId: "ig_456",
      igsid: "commenter_999",
      watermark: WATERMARK,
    });

    expect(count).toBe(2);
    expect(mockPrisma.dmLog.updateMany).toHaveBeenCalledWith({
      where: {
        instagramAccountId: "ig_account_row_1",
        commenterId: "commenter_999",
        status: "SENT",
        readAt: null,
        dmSentAt: { not: null, lte: new Date(WATERMARK) },
      },
      data: { readAt: new Date(WATERMARK) },
    });
  });

  it("only touches rows that are not already marked", async () => {
    // Someone reopening a conversation ten times must not cost ten writes, and
    // must not overwrite the first read time with a later one.
    await markDmLogsRead({
      instagramAccountId: "ig_456",
      igsid: "commenter_999",
      watermark: WATERMARK,
    });

    const call = mockPrisma.dmLog.updateMany.mock.calls[0][0];
    expect(call.where.readAt).toBeNull();
  });

  it("does nothing without a watermark", async () => {
    const count = await markDmLogsRead({
      instagramAccountId: "ig_456",
      igsid: "commenter_999",
    });

    expect(count).toBe(0);
    expect(mockPrisma.instagramAccount.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.updateMany).not.toHaveBeenCalled();
  });

  it("ignores an unusable watermark instead of writing an invalid date", async () => {
    const count = await markDmLogsRead({
      instagramAccountId: "ig_456",
      igsid: "commenter_999",
      watermark: Number.NaN,
    });

    expect(count).toBe(0);
    expect(mockPrisma.dmLog.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing for an account that is not connected here", async () => {
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(null);

    const count = await markDmLogsRead({
      instagramAccountId: "ig_unknown",
      igsid: "commenter_999",
      watermark: WATERMARK,
    });

    expect(count).toBe(0);
    expect(mockPrisma.dmLog.updateMany).not.toHaveBeenCalled();
  });
});
