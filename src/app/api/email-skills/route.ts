import { NextResponse } from "next/server";
import { asc, desc, eq, or, isNull } from "drizzle-orm";
import { getScopedDb, schema } from "@/lib/db/scoped";

function mapSkill(s: typeof schema.emailSkills.$inferSelect) {
  return {
    id: s.id,
    user_id: s.clerkUserId,
    name: s.name,
    slug: s.slug,
    description: s.description,
    instructions: s.instructions,
    is_builtin: s.isBuiltin,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

// GET /api/email-skills — list built-in skills + skills owned by current user
export async function GET() {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const skills = await sdb.raw
    .select()
    .from(schema.emailSkills)
    .where(
      or(
        isNull(schema.emailSkills.clerkUserId),
        eq(schema.emailSkills.clerkUserId, sdb.userId),
      ),
    )
    .orderBy(desc(schema.emailSkills.isBuiltin), asc(schema.emailSkills.name));

  return NextResponse.json(skills.map(mapSkill));
}

// POST /api/email-skills — create a new skill
export async function POST(request: Request) {
  let sdb: Awaited<ReturnType<typeof getScopedDb>>;
  try {
    sdb = await getScopedDb();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name: string;
    slug: string;
    description?: string | null;
    instructions: string;
  };

  if (!body.name || !body.instructions) {
    return NextResponse.json(
      { error: "name and instructions are required" },
      { status: 400 },
    );
  }

  const [inserted] = await sdb.raw
    .insert(schema.emailSkills)
    .values({
      clerkUserId: sdb.userId,
      name: body.name,
      slug:
        body.slug ||
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 64),
      description: body.description ?? null,
      instructions: body.instructions,
      isBuiltin: false,
    })
    .returning();

  if (!inserted) {
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }

  return NextResponse.json(mapSkill(inserted), { status: 201 });
}
