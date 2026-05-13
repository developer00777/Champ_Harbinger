import { NextResponse } from "next/server";
import { asc, desc, or, isNull, eq, and } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";
import { adminDb } from "@/lib/db/admin";
import { getCurrentUser } from "@/lib/auth";

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

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name: string;
    description?: string;
    category?: string;
    executionType?: string;
    recipe?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Generate a URL-safe slug from the name + timestamp suffix to avoid collisions
  const baseSlug = body.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${baseSlug}-${Date.now()}`;

  const [signal] = await adminDb
    .insert(schema.signals)
    .values({
      clerkUserId: userId,
      name: body.name.trim(),
      slug,
      description: body.description ?? "",
      category: body.category ?? "custom",
      executionType: body.executionType ?? "exa_search",
      config: {
        ...(body.recipe ? { recipe: body.recipe } : {}),
        ...(body.config ?? {}),
      },
      isBuiltin: false,
      isPublic: false,
    })
    .returning();

  return NextResponse.json(signal, { status: 201 });
}

export async function PATCH(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { id: string; is_public: boolean };
  if (!body.id || body.is_public === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const [updated] = await adminDb
    .update(schema.signals)
    .set({ isPublic: body.is_public })
    .where(
      and(
        eq(schema.signals.id, body.id),
        or(
          eq(schema.signals.clerkUserId, userId),
          eq(schema.signals.isBuiltin, true), // built-ins can have is_public toggled
        ),
      ),
    )
    .returning({ id: schema.signals.id });

  if (!updated) {
    return NextResponse.json(
      { error: "not found or not yours" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Only allow deleting user-owned non-builtin signals
  const deleted = await adminDb
    .delete(schema.signals)
    .where(
      and(
        eq(schema.signals.id, id),
        eq(schema.signals.clerkUserId, userId),
        eq(schema.signals.isBuiltin, false),
      ),
    )
    .returning({ id: schema.signals.id });

  if (!deleted.length) {
    return NextResponse.json(
      { error: "not found or not yours" },
      { status: 404 },
    );
  }

  return NextResponse.json({ deleted: true });
}
