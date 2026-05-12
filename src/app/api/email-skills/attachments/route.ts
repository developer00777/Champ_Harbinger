import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

// GET /api/email-skills/attachments?scopeType=user|profile|campaign&scopeId=<id>
export async function GET(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scopeType = searchParams.get("scopeType");
  const scopeId = searchParams.get("scopeId");

  if (!scopeType || !scopeId) {
    return NextResponse.json(
      { error: "scopeType and scopeId are required" },
      { status: 400 },
    );
  }

  const attachments = await sdb.raw
    .select({
      skill_id: schema.emailSkillAttachments.skillId,
      enabled: schema.emailSkillAttachments.enabled,
    })
    .from(schema.emailSkillAttachments)
    .where(
      and(
        eq(schema.emailSkillAttachments.scopeType, scopeType),
        eq(schema.emailSkillAttachments.scopeId, scopeId),
        eq(schema.emailSkillAttachments.enabled, true),
      ),
    );

  return NextResponse.json(attachments);
}

// POST /api/email-skills/attachments — upsert (attach) a skill
export async function POST(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    skillId: string;
    scopeType: string;
    scopeId: string;
  };

  if (!body.skillId || !body.scopeType || !body.scopeId) {
    return NextResponse.json(
      { error: "skillId, scopeType, and scopeId are required" },
      { status: 400 },
    );
  }

  await sdb.raw
    .insert(schema.emailSkillAttachments)
    .values({
      skillId: body.skillId,
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.emailSkillAttachments.skillId,
        schema.emailSkillAttachments.scopeType,
        schema.emailSkillAttachments.scopeId,
      ],
      set: { enabled: true },
    });

  return NextResponse.json({ ok: true });
}

// DELETE /api/email-skills/attachments?skillId=<id>&scopeType=<type>&scopeId=<id>
export async function DELETE(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const skillId = searchParams.get("skillId");
  const scopeType = searchParams.get("scopeType");
  const scopeId = searchParams.get("scopeId");

  if (!skillId || !scopeType || !scopeId) {
    return NextResponse.json(
      { error: "skillId, scopeType, and scopeId are required" },
      { status: 400 },
    );
  }

  await sdb.raw
    .delete(schema.emailSkillAttachments)
    .where(
      and(
        eq(schema.emailSkillAttachments.skillId, skillId),
        eq(schema.emailSkillAttachments.scopeType, scopeType),
        eq(schema.emailSkillAttachments.scopeId, scopeId),
      ),
    );

  return NextResponse.json({ ok: true });
}
