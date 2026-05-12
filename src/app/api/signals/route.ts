import { NextResponse } from "next/server";
import { asc, desc, or, isNull, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

export async function GET() {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Return built-in signals + signals owned by this user
  const signals = await sdb.raw
    .select()
    .from(schema.signals)
    .where(
      or(
        eq(schema.signals.isBuiltin, true),
        isNull(schema.signals.clerkUserId),
        eq(schema.signals.clerkUserId, sdb.userId),
      ),
    )
    .orderBy(desc(schema.signals.isBuiltin), asc(schema.signals.name));

  const mapped = signals.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    long_description: s.longDescription,
    category: s.category,
    icon: s.icon,
    execution_type: s.executionType,
    tool_key: s.toolKey,
    config: s.config,
    is_builtin: s.isBuiltin,
    is_public: s.isPublic,
    created_by: s.createdBy ?? null,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  }));

  return NextResponse.json(mapped);
}

export async function PATCH(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { id: string; is_public: boolean };
  if (!body.id || body.is_public === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await sdb.raw
    .update(schema.signals)
    .set({ isPublic: body.is_public })
    .where(eq(schema.signals.id, body.id));

  return NextResponse.json({ ok: true });
}
