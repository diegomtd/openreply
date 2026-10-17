import { NextRequest, NextResponse } from "next/server";
import { checkAgentAuth } from "@/lib/agent/auth";
import { handleAgentRequest } from "@/lib/agent/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ path: string[] }> };

// API de agentes. Contrato e regras em docs/agent-api.md.
async function handle(request: NextRequest, { params }: RouteProps) {
  const auth = checkAgentAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown = undefined;
  if (request.method === "POST") {
    body = await request.json().catch(() => undefined);
  }

  const { path } = await params;
  const result = await handleAgentRequest({
    method: request.method,
    path,
    query: request.nextUrl.searchParams,
    body,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const GET = handle;
export const POST = handle;
