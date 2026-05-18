import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { validateApiKey } from "@/lib/api/validate-api-key";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const body = (await request.json()) as {
    status?: "ingested" | "failed";
    iq_prospect_id?: string;
  };

  const [item] = await adminDb
    .select({ id: schema.champiqQueue.id })
    .from(schema.champiqQueue)
    .where(eq(schema.champiqQueue.id, id))
    .limit(1);

  if (!item) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  }

  await adminDb
    .update(schema.champiqQueue)
    .set({
      status: body.status === "failed" ? "failed" : "delivered",
      updatedAt: new Date(),
    })
    .where(eq(schema.champiqQueue.id, id));

  return NextResponse.json({
    ok: true,
    id,
    status: body.status ?? "ingested",
    iq_prospect_id: body.iq_prospect_id ?? null,
  });
}
