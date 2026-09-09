/**
 * Workspace automation rules: the anti-flood ceiling and the extra opt-out
 * words. Both change how every automation behaves, so they are workspace-level
 * settings rather than per-campaign ones, and only an owner or admin may edit.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: context.workspaceId },
    select: { contactCooldownHours: true, optOutKeywords: true },
  });

  if (!workspace) {
    return NextResponse.json(
      { success: false, error: "Workspace not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: workspace });
}

const patchSchema = z.object({
  // 0 disables the ceiling; a year is a generous upper bound that still stops a
  // typo from muting the workspace forever.
  contactCooldownHours: z.number().int().min(0).max(8760).optional(),
  optOutKeywords: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional(),
});

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
      { success: false, error: "Only an owner or admin can change these rules" },
      { status: 403 }
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
      { success: false, error: "Invalid settings" },
      { status: 400 }
    );
  }

  const workspace = await prisma.workspace.update({
    where: { id: context.workspaceId },
    data: {
      ...(parsed.data.contactCooldownHours !== undefined
        ? { contactCooldownHours: parsed.data.contactCooldownHours }
        : {}),
      ...(parsed.data.optOutKeywords !== undefined
        ? {
            // Deduplicated and lower-cased: the matcher normalizes the inbound
            // message the same way, so storing variants of one word is noise.
            optOutKeywords: Array.from(
              new Set(
                parsed.data.optOutKeywords
                  .map((word) => word.toLowerCase().trim())
                  .filter(Boolean)
              )
            ),
          }
        : {}),
    },
    select: { contactCooldownHours: true, optOutKeywords: true },
  });

  return NextResponse.json({ success: true, data: workspace });
}
