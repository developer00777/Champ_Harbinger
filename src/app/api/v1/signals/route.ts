import { NextResponse } from "next/server";
import { or, isNull, eq, asc, desc } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";

export async function GET(request: Request) {
  let ctx: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    ctx = await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const signals = await adminDb
    .select()
    .from(schema.signals)
    .where(
      or(
        eq(schema.signals.isBuiltin, true),
        isNull(schema.signals.clerkUserId),
        eq(schema.signals.clerkUserId, ctx.userId),
      ),
    )
    .orderBy(desc(schema.signals.isBuiltin), asc(schema.signals.name));

  return NextResponse.json(
    signals.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      execution_type: s.executionType,
      tool_key: s.toolKey,
      config: s.config,
      is_builtin: s.isBuiltin,
    })),
  );
}
