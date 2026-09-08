/**
 * Contacts API.
 *
 * GET  — paginated list of people who have interacted with the connected
 *        accounts, with what each of them has already received.
 * PATCH — mute (opt out) or unmute one contact.
 *
 * Deliberately paginated and `select`-ed rather than loading whole rows: this
 * table grows with every new person and the app runs on a small VPS.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { optInContact, optOutContact } from "@/lib/contacts/state";
import type { Prisma } from "@/app/generated/prisma/client";

const FILTERS = ["all", "muted", "messaged", "never_messaged"] as const;
type Filter = (typeof FILTERS)[number];

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(params.get("limit") ?? "20", 10) || 20)
  );
  const search = (params.get("search") ?? "").trim();
  const rawFilter = params.get("filter") ?? "all";
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter)
    ? (rawFilter as Filter)
    : "all";
  const instagramAccountId = params.get("instagramAccountId");

  const where: Prisma.ContactWhereInput = {
    workspaceId,
    ...(instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {}),
    ...(filter === "muted" ? { optedOut: true } : {}),
    ...(filter === "messaged" ? { lastAutomationSentAt: { not: null } } : {}),
    ...(filter === "never_messaged" ? { lastAutomationSentAt: null } : {}),
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { igsid: { contains: search } },
          ],
        }
      : {}),
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ lastInboundAt: "desc" }, { firstSeenAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        igsid: true,
        username: true,
        firstSeenAt: true,
        lastInboundAt: true,
        lastAutomationSentAt: true,
        automationSentCount: true,
        optedOut: true,
        optedOutReason: true,
        tags: true,
        instagramAccount: { select: { username: true } },
        automationStates: {
          orderBy: { lastSentAt: "desc" },
          take: 5,
          select: {
            sentCount: true,
            lastSentAt: true,
            automation: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      contacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
}

const patchSchema = z.object({
  id: z.string().min(1),
  optedOut: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "id and optedOut are required" },
      { status: 400 }
    );
  }

  // Scope the lookup to the caller's workspace so an id from another workspace
  // reads as not found rather than being muted.
  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.id, workspaceId },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json(
      { success: false, error: "Contact not found" },
      { status: 404 }
    );
  }

  if (parsed.data.optedOut) {
    await optOutContact(contact.id, "Muted from the Contacts screen");
  } else {
    await optInContact(contact.id);
  }

  return NextResponse.json({ success: true, data: { id: contact.id } });
}
