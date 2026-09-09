import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { calculateCtr, normalizeTopKeywords } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// This list is read-your-writes (created/imported campaigns must show up
// immediately), so never cache it at the route or CDN layer.
export const dynamic = "force-dynamic";

const createAutomationSchema = z
  .object({
    name: z.string().min(1).max(100),
    goal: z.string().min(1).max(120).optional().nullable(),
    instagramAccountId: z.string().min(1).optional().nullable(),
    postId: z.string().min(1).optional().nullable(),
    postUrl: z.string().url().optional().nullable(),
    pendingNextReel: z.boolean().optional().default(false),
    matchAnyPost: z.boolean().optional().default(false),
    keywords: z.array(z.string().min(1).max(50)).max(10).optional().default([]),
    matchAnyWord: z.boolean().optional().default(false),
    dmTriggerEnabled: z.boolean().optional().default(false),
    storyReplyTriggerEnabled: z.boolean().optional().default(false),
    storyMentionTriggerEnabled: z.boolean().optional().default(false),
    dmMessage: z.string().min(1).max(1000),
    openingDmEnabled: z.boolean().optional().default(false),
    openingDmMessage: z.string().max(1000).optional().nullable(),
    openingDmButtonLabel: z.string().max(64).optional().nullable(),
    linkButtonLabel: z.string().max(20).optional().nullable(),
    requireFollow: z.boolean().optional().default(false),
    followPromptMessage: z.string().max(1000).optional().nullable(),
    followPromptButtonLabel: z.string().max(20).optional().nullable(),
    // A sequência que sai depois do link. Até 3 passos: acima disso a soma dos
    // atrasos quase nunca cabe na janela de 24h, e a conversa vira spam.
    steps: z
      .array(
        z.object({
          message: z.string().min(1).max(1000),
          delayMinutes: z.number().int().min(0).max(1440).optional().default(0),
        })
      )
      .max(3)
      .optional()
      .default([]),
    publicReplyEnabled: z.boolean().optional().default(false),
    publicReplyMessage: z.string().max(1000).optional().nullable(),
    publicReplyMessages: z
      .array(z.string().max(1000))
      .max(10)
      .optional()
      .default([]),
    // Empty string means "no tracked link"; a URL sets one.
    trackedDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    // Optional second tracked link, rendered as a second DM button.
    secondaryDestinationUrl: z
      .union([z.string().url(), z.literal("")])
      .optional()
      .nullable(),
    secondaryButtonLabel: z.string().max(20).optional().nullable(),
    isActive: z.boolean().optional().default(true),
    wholeWordMatch: z.boolean().optional().default(true),
    // How often the same person may receive this automation. Defaults to once,
    // because the alternative is re-sending the same message to someone who
    // already has it.
    sendFrequency: z
      .enum(["ONCE_PER_CONTACT", "ONCE_PER_POST", "COOLDOWN", "ALWAYS"])
      .optional()
      .default("ONCE_PER_CONTACT"),
    resendCooldownHours: z.number().int().min(1).max(8760).optional().default(24),
  })
  // A campaign needs at least one trigger. A post target is only required when
  // nothing else fires it: an automation that answers DMs, story replies or
  // story mentions has no post to point at.
  .refine(
    (d) =>
      d.matchAnyPost ||
      d.pendingNextReel ||
      Boolean(d.postId) ||
      d.dmTriggerEnabled ||
      d.storyReplyTriggerEnabled ||
      d.storyMentionTriggerEnabled,
    {
      message:
        "Escolha um post/reel, ou ligue um gatilho de DM, resposta de story ou menção",
      path: ["postId"],
    }
  )
  // And it must match either specific words or any word.
  .refine((d) => d.matchAnyWord || d.keywords.length >= 1, {
    message: "Add at least one keyword, or match any word",
    path: ["keywords"],
  })
  // Instagram fecha a janela de mensagens 24h depois da última mensagem da
  // pessoa. A soma dos atrasos da sequência tem que caber nela, senão os últimos
  // passos são recusados pela Meta sem nada que o usuário possa fazer.
  .refine(
    (d) =>
      d.steps.reduce((total, step) => total + (step.delayMinutes ?? 0), 0) <=
      1440,
    {
      message:
        "A soma dos atrasos da sequência passa de 24h, que é a janela de mensagens do Instagram",
      path: ["steps"],
    }
  )
  // An opening DM needs both a message and a button label.
  .refine(
    (d) =>
      !d.openingDmEnabled ||
      (Boolean(d.openingDmMessage?.trim()) &&
        Boolean(d.openingDmButtonLabel?.trim())),
    { message: "Opening DM needs a message and a button label", path: ["openingDmMessage"] }
  );

const updateAutomationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  goal: z.string().min(1).max(120).optional().nullable(),
  postId: z.string().min(1).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  pendingNextReel: z.boolean().optional(),
  matchAnyPost: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(50)).max(10).optional(),
  matchAnyWord: z.boolean().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  storyReplyTriggerEnabled: z.boolean().optional(),
  storyMentionTriggerEnabled: z.boolean().optional(),
  dmMessage: z.string().min(1).max(1000).optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: z.string().max(1000).optional().nullable(),
  openingDmButtonLabel: z.string().max(64).optional().nullable(),
  linkButtonLabel: z.string().max(20).optional().nullable(),
  requireFollow: z.boolean().optional(),
  followPromptMessage: z.string().max(1000).optional().nullable(),
  followPromptButtonLabel: z.string().max(20).optional().nullable(),
  steps: z
    .array(
      z.object({
        message: z.string().min(1).max(1000),
        delayMinutes: z.number().int().min(0).max(1440).optional().default(0),
      })
    )
    .max(3)
    .optional(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessage: z.string().max(1000).optional().nullable(),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  sendFrequency: z
    .enum(["ONCE_PER_CONTACT", "ONCE_PER_POST", "COOLDOWN", "ALWAYS"])
    .optional(),
  resendCooldownHours: z.number().int().min(1).max(8760).optional(),
  reportShareEnabled: z.boolean().optional(),
  // Empty string clears the tracked link; a URL updates/creates it; undefined
  // leaves it unchanged.
  trackedDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  // Same semantics for the optional second tracked link / DM button.
  secondaryDestinationUrl: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .nullable(),
  secondaryButtonLabel: z.string().max(20).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const instagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  const accountFilter =
    instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {};

  const automations = await prisma.automation.findMany({
    where: { workspaceId, ...accountFilter },
    include: {
      instagramAccount: {
        select: { username: true, instagramId: true },
      },
      _count: {
        select: { dmLogs: true },
      },
      trackedLinks: {
        select: {
          id: true,
          slug: true,
          label: true,
          destinationUrl: true,
          _count: { select: { clicks: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      steps: {
        select: { order: true, message: true, delayMinutes: true },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const automationsWithReports = await Promise.all(
    automations.map(async (automation) => {
      if (automation.reportShareSlug) return automation;

      const updated = await prisma.automation.update({
        where: { id: automation.id },
        data: { reportShareSlug: generateReportShareSlug() },
        select: { reportShareSlug: true },
      });

      return {
        ...automation,
        reportShareSlug: updated.reportShareSlug,
      };
    })
  );

  const [statusCounts, clickCounts, keywordCounts] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["automationId", "status"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({
      by: ["automationId"],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.dmLog.groupBy({
      by: ["automationId", "matchedKeyword"],
      where: { workspaceId, matchedKeyword: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const analytics = new Map<
    string,
    {
      sent: number;
      skipped: number;
      failed: number;
      clicks: number;
      topKeywords: { keyword: string; count: number }[];
    }
  >();

  for (const automation of automationsWithReports) {
    analytics.set(automation.id, {
      sent: 0,
      skipped: 0,
      failed: 0,
      clicks: 0,
      topKeywords: [],
    });
  }

  for (const row of statusCounts) {
    const item = analytics.get(row.automationId);
    if (!item) continue;
    const count = row._count._all;
    if (row.status === "SENT") item.sent += count;
    if (row.status === "FAILED") item.failed += count;
    if (row.status.startsWith("SKIPPED_")) item.skipped += count;
  }

  for (const row of clickCounts) {
    const item = analytics.get(row.automationId);
    if (item) item.clicks = row._count._all;
  }

  for (const automation of automationsWithReports) {
    const item = analytics.get(automation.id);
    if (!item) continue;
    item.topKeywords = normalizeTopKeywords(
      keywordCounts
        .filter((row) => row.automationId === automation.id)
        .map((row) => ({
          matchedKeyword: row.matchedKeyword,
          _count: row._count._all,
        })),
      3
    );
  }

  return NextResponse.json(
    {
    success: true,
    data: automationsWithReports.map((automation) => {
      const item = analytics.get(automation.id) ?? {
        sent: 0,
        skipped: 0,
        failed: 0,
        clicks: 0,
        topKeywords: [],
      };

      return {
        ...automation,
        trackedLinks: automation.trackedLinks.map((link) => ({
          ...link,
          trackedUrl: buildTrackedUrl(link.slug),
        })),
        reportUrl: automation.reportShareSlug
          ? buildReportUrl(automation.reportShareSlug)
          : null,
        analytics: {
          ...item,
          ctr: calculateCtr(item.clicks, item.sent),
        },
      };
    }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can create campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const body = await request.json();
  const parsed = createAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const requestedInstagramAccountId =
    parsed.data.instagramAccountId && parsed.data.instagramAccountId !== "all"
      ? parsed.data.instagramAccountId
      : null;

  const [workspace, instagramAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    }),
    requestedInstagramAccountId
      ? prisma.instagramAccount.findFirst({
          where: { id: requestedInstagramAccountId, workspaceId },
        })
      : prisma.instagramAccount.findFirst({
          where: { workspaceId },
          orderBy: { connectedAt: "desc" },
        }),
  ]);

  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Workspace not found" },
      { status: 404 }
    );
  }

  if (!instagramAccount) {
    return NextResponse.json(
      { success: false, error: "Connect Instagram before creating campaigns" },
      { status: 400 }
    );
  }

  const { trackedDestinationUrl, secondaryDestinationUrl, secondaryButtonLabel } =
    parsed.data;

  // The primary link's button title comes from `linkButtonLabel`; the second
  // link stores its own button title in the tracked link's `label` field.
  const linkCreates: {
    workspaceId: string;
    slug: string;
    label: string;
    destinationUrl: string;
  }[] = [];
  if (trackedDestinationUrl) {
    linkCreates.push({
      workspaceId,
      slug: generateTrackedLinkSlug(),
      label: "Primary campaign link",
      destinationUrl: trackedDestinationUrl,
    });
  }
  if (secondaryDestinationUrl) {
    linkCreates.push({
      workspaceId,
      slug: generateTrackedLinkSlug(),
      label: secondaryButtonLabel?.trim() || "Abrir link",
      destinationUrl: secondaryDestinationUrl,
    });
  }

  const { pendingNextReel, matchAnyPost, matchAnyWord, openingDmEnabled } =
    parsed.data;
  // A post is only stored for the "specific post" trigger.
  const isSpecificPost = !pendingNextReel && !matchAnyPost;
  const publicReplyList = (
    parsed.data.publicReplyMessages.length > 0
      ? parsed.data.publicReplyMessages
      : parsed.data.publicReplyMessage
        ? [parsed.data.publicReplyMessage]
        : []
  )
    .map((m) => m.trim())
    .filter(Boolean);

  // Ordem 1..n vem da posição no array; mensagens vazias são descartadas para
  // um passo em branco no construtor não virar uma mensagem vazia enviada.
  const stepCreates = parsed.data.steps
    .map((step) => ({
      message: step.message.trim(),
      delayMinutes: Math.max(0, Math.min(1440, step.delayMinutes ?? 0)),
    }))
    .filter((step) => step.message)
    .map((step, index) => ({ ...step, order: index + 1 }));

  const automation = await prisma.automation.create({
    data: {
      name: parsed.data.name,
      goal: parsed.data.goal,
      // A next-reel campaign has no post yet; the cron binds it once a reel is posted.
      postId: isSpecificPost ? parsed.data.postId : null,
      postUrl: isSpecificPost ? parsed.data.postUrl : null,
      pendingNextReel,
      matchAnyPost,
      keywords: matchAnyWord ? [] : parsed.data.keywords,
      matchAnyWord,
      dmTriggerEnabled: parsed.data.dmTriggerEnabled,
      storyReplyTriggerEnabled: parsed.data.storyReplyTriggerEnabled,
      storyMentionTriggerEnabled: parsed.data.storyMentionTriggerEnabled,
      dmMessage: parsed.data.dmMessage,
      openingDmEnabled,
      openingDmMessage: openingDmEnabled
        ? parsed.data.openingDmMessage || null
        : null,
      openingDmButtonLabel: openingDmEnabled
        ? parsed.data.openingDmButtonLabel || null
        : null,
      linkButtonLabel: parsed.data.linkButtonLabel || null,
      requireFollow: parsed.data.requireFollow,
      followPromptMessage: parsed.data.requireFollow
        ? parsed.data.followPromptMessage || null
        : null,
      followPromptButtonLabel: parsed.data.requireFollow
        ? parsed.data.followPromptButtonLabel || null
        : null,
      publicReplyEnabled: parsed.data.publicReplyEnabled,
      publicReplyMessages: parsed.data.publicReplyEnabled
        ? publicReplyList
        : [],
      publicReplyMessage: parsed.data.publicReplyEnabled
        ? publicReplyList[0] ?? parsed.data.publicReplyMessage ?? null
        : null,
      isActive: parsed.data.isActive,
      wholeWordMatch: parsed.data.wholeWordMatch,
      sendFrequency: parsed.data.sendFrequency,
      resendCooldownHours: parsed.data.resendCooldownHours,
      workspaceId,
      instagramAccountId: instagramAccount.id,
      reportShareSlug: generateReportShareSlug(),
      ...(linkCreates.length > 0
        ? { trackedLinks: { create: linkCreates } }
        : {}),
      ...(stepCreates.length > 0 ? { steps: { create: stepCreates } } : {}),
    },
    include: {
      trackedLinks: true,
      steps: { orderBy: { order: "asc" } },
    },
  });

  return NextResponse.json(
    { success: true, data: automation },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = updateAutomationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid input",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const {
    trackedDestinationUrl,
    secondaryDestinationUrl,
    secondaryButtonLabel,
    steps,
    ...automationData
  } = parsed.data;

  // Keep dependent fields consistent: any-word clears keywords; a disabled
  // opening DM clears its message and button.
  if (automationData.matchAnyWord === true) automationData.keywords = [];
  if (automationData.openingDmEnabled === false) {
    automationData.openingDmMessage = null;
    automationData.openingDmButtonLabel = null;
  }
  if (automationData.requireFollow === false) {
    automationData.followPromptMessage = null;
    automationData.followPromptButtonLabel = null;
  }
  // Any-post / next-reel campaigns carry no specific post.
  if (automationData.matchAnyPost === true || automationData.pendingNextReel === true) {
    automationData.postId = null;
    automationData.postUrl = null;
  }
  // Keep the public-reply variations list and the legacy single field in sync.
  if (automationData.publicReplyMessages !== undefined) {
    const list = automationData.publicReplyMessages
      .map((m) => m.trim())
      .filter(Boolean);
    automationData.publicReplyMessages = list;
    automationData.publicReplyMessage = list[0] ?? null;
  }
  if (automationData.publicReplyEnabled === false) {
    automationData.publicReplyMessages = [];
    automationData.publicReplyMessage = null;
  }

  const updated = await prisma.automation.update({
    where: { id: automationId },
    data: automationData,
  });

  // A sequência é substituída inteira quando vem no corpo: reordenar ou remover
  // um passo do meio não tem representação incremental honesta, e o número de
  // passos é pequeno. `undefined` significa "não mexe".
  if (steps !== undefined) {
    const stepRows = steps
      .map((step) => ({
        message: step.message.trim(),
        delayMinutes: Math.max(0, Math.min(1440, step.delayMinutes ?? 0)),
      }))
      .filter((step) => step.message)
      .map((step, index) => ({ ...step, order: index + 1 }));

    await prisma.$transaction([
      prisma.automationStep.deleteMany({ where: { automationId } }),
      ...(stepRows.length > 0
        ? [
            prisma.automationStep.createMany({
              data: stepRows.map((step) => ({ ...step, automationId })),
            }),
          ]
        : []),
    ]);
  }

  // Update, create, or clear the campaign's primary tracked link when a
  // destination URL was supplied. `undefined` means "leave it alone".
  if (trackedDestinationUrl !== undefined && trackedDestinationUrl !== null) {
    const primaryLink = await prisma.trackedLink.findFirst({
      where: { automationId },
      orderBy: { createdAt: "asc" },
    });

    if (trackedDestinationUrl === "") {
      if (primaryLink) {
        await prisma.trackedLink.delete({ where: { id: primaryLink.id } });
      }
    } else if (primaryLink) {
      await prisma.trackedLink.update({
        where: { id: primaryLink.id },
        data: { destinationUrl: trackedDestinationUrl },
      });
    } else {
      await prisma.trackedLink.create({
        data: {
          workspaceId,
          automationId,
          slug: generateTrackedLinkSlug(),
          label: "Primary campaign link",
          destinationUrl: trackedDestinationUrl,
        },
      });
    }
  }

  // Update, create, or clear the campaign's second tracked link. It is always
  // the link at index [1] (ordered by createdAt), and its `label` holds the
  // second button's title.
  if (secondaryDestinationUrl !== undefined && secondaryDestinationUrl !== null) {
    const links = await prisma.trackedLink.findMany({
      where: { automationId },
      orderBy: { createdAt: "asc" },
    });
    const secondaryLink = links[1];
    const secondaryLabel = secondaryButtonLabel?.trim() || "Abrir link";

    if (secondaryDestinationUrl === "") {
      if (secondaryLink) {
        await prisma.trackedLink.delete({ where: { id: secondaryLink.id } });
      }
    } else if (secondaryLink) {
      await prisma.trackedLink.update({
        where: { id: secondaryLink.id },
        data: { destinationUrl: secondaryDestinationUrl, label: secondaryLabel },
      });
    } else {
      await prisma.trackedLink.create({
        data: {
          workspaceId,
          automationId,
          slug: generateTrackedLinkSlug(),
          label: secondaryLabel,
          destinationUrl: secondaryDestinationUrl,
        },
      });
    }
  }

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can delete campaigns" },
      { status: 403 }
    );
  }

  const workspaceId = context.workspaceId;

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  await prisma.automation.delete({ where: { id: automationId } });

  return NextResponse.json({ success: true, data: { deleted: true } });
}
