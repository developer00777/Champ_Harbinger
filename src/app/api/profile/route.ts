import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

function mapProfile(p: typeof schema.userProfile.$inferSelect) {
  return {
    id: p.id,
    label: p.label,
    name: p.name,
    email: p.email,
    company_name: p.companyName,
    company_url: p.companyUrl,
    personal_url: p.personalUrl,
    linkedin_url: p.linkedinUrl,
    twitter_url: p.twitterUrl,
    role_title: p.roleTitle,
    offering_summary: p.offeringSummary,
    notes: p.notes,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

// GET /api/profile — list all profiles for current user
export async function GET() {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profiles = await sdb.raw
    .select()
    .from(schema.userProfile)
    .where(sdb.scope(schema.userProfile))
    .orderBy(desc(schema.userProfile.createdAt));

  return NextResponse.json(profiles.map(mapProfile));
}

// POST /api/profile — create a new profile
export async function POST(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, string | null>;

  const inserted = await sdb.raw
    .insert(schema.userProfile)
    .values({
      clerkUserId: sdb.userId,
      clerkOrgId: sdb.orgId,
      label: (body.label as string | null) ?? null,
      name: (body.name as string | null) ?? null,
      email: (body.email as string | null) ?? null,
      companyName: (body.company_name as string | null) ?? null,
      companyUrl: (body.company_url as string | null) ?? null,
      personalUrl: (body.personal_url as string | null) ?? null,
      linkedinUrl: (body.linkedin_url as string | null) ?? null,
      twitterUrl: (body.twitter_url as string | null) ?? null,
      roleTitle: (body.role_title as string | null) ?? null,
      offeringSummary: (body.offering_summary as string | null) ?? null,
      notes: (body.notes as string | null) ?? null,
    })
    .returning();

  return NextResponse.json(mapProfile(inserted[0]), { status: 201 });
}

// PATCH /api/profile?id=<id> — update a profile
export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, string | null>;

  const updated = await sdb.raw
    .update(schema.userProfile)
    .set({
      label: (body.label as string | null) ?? null,
      name: (body.name as string | null) ?? null,
      email: (body.email as string | null) ?? null,
      companyName: (body.company_name as string | null) ?? null,
      companyUrl: (body.company_url as string | null) ?? null,
      personalUrl: (body.personal_url as string | null) ?? null,
      linkedinUrl: (body.linkedin_url as string | null) ?? null,
      twitterUrl: (body.twitter_url as string | null) ?? null,
      roleTitle: (body.role_title as string | null) ?? null,
      offeringSummary: (body.offering_summary as string | null) ?? null,
      notes: (body.notes as string | null) ?? null,
    })
    .where(and(eq(schema.userProfile.id, id), sdb.scope(schema.userProfile)))
    .returning();

  if (!updated[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(mapProfile(updated[0]));
}

// DELETE /api/profile?id=<id>
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await sdb.raw
    .delete(schema.userProfile)
    .where(and(eq(schema.userProfile.id, id), sdb.scope(schema.userProfile)));

  return NextResponse.json({ ok: true });
}
