import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  // `?c=` diz de quem é o clique (o link saiu numa DM para esse contato). Só é
  // aceito se o contato for da mesma conta do link: um id trocado na URL não
  // pode marcar clique em contato de outra conta.
  const contactRef = new URL(request.url).searchParams.get("c");
  let contactId: string | null = null;
  if (contactRef && contactRef.length <= 64) {
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactRef,
        instagramAccountId: trackedLink.automation.instagramAccountId,
      },
      select: { id: true },
    });
    contactId = contact?.id ?? null;
  }

  await prisma.linkClick.create({
    data: {
      contactId,
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}
