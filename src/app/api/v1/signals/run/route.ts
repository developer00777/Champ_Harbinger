import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";
import { executeSignal } from "@/lib/signals/executor";
import type { Signal } from "@/lib/types/signal";

export const maxDuration = 60;

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  void ctx; // userId available for future scoping

  const body = (await request.json()) as {
    signal_id?: string;
    domain?: string;
  };

  if (!body.signal_id || !body.domain) {
    return NextResponse.json(
      { error: "signal_id and domain are required" },
      { status: 400 },
    );
  }

  const [signal] = await adminDb
    .select()
    .from(schema.signals)
    .where(eq(schema.signals.id, body.signal_id))
    .limit(1);

  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }

  const mappedSignal: Signal = {
    id: signal.id,
    name: signal.name,
    slug: signal.slug ?? signal.name.toLowerCase().replace(/\s+/g, "-"),
    description: signal.description ?? "",
    long_description: signal.longDescription ?? null,
    category: signal.category as Signal["category"],
    icon: signal.icon ?? null,
    execution_type: signal.executionType as Signal["execution_type"],
    tool_key: signal.toolKey ?? null,
    config: (signal.config as Record<string, unknown>) ?? {},
    is_builtin: signal.isBuiltin,
    is_public: signal.isPublic,
    created_by: signal.createdBy ?? null,
    created_at: signal.createdAt.toISOString(),
    updated_at: signal.updatedAt.toISOString(),
  };

  const output = await executeSignal(mappedSignal, {
    domain: body.domain,
    useAdmin: true,
  });

  return NextResponse.json({
    fired: output.found,
    reasoning: output.summary,
    data: output.data,
    fired_at: output.found ? new Date().toISOString() : null,
  });
}
