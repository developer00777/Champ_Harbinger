import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";

import { schema } from "@/db";
import { adminDb } from "@/lib/db/admin";
import { requireSuperAdminApi } from "@/lib/admin/guard";
import { inviteSchema } from "@/lib/admin/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const parsed = inviteSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, teamId } = parsed.data; // email already lowercased by schema

  // Team must exist (FK would reject anyway, but give a clean 404).
  const [team] = await adminDb
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .limit(1);
  if (!team) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }

  // One membership per email (unique constraint). Surface a clean 409.
  const [existing] = await adminDb
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.email, email))
    .limit(1);
  if (existing) {
    return Response.json(
      { error: "A member with that email already exists" },
      { status: 409 },
    );
  }

  // Send the Clerk invitation when configured. In dev keyless mode
  // (no CLERK_SECRET_KEY) we skip the call but still create the member row so
  // the team is provisioned; the user gets linked on first login by email.
  let clerkInviteSent = false;
  let note: string | undefined;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (secretKey) {
    try {
      const clerk = createClerkClient({ secretKey });
      await clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { teamId },
        ignoreExisting: true,
      });
      clerkInviteSent = true;
    } catch (err) {
      console.error("[admin/invite] clerk invitation failed:", err);
      note =
        "Clerk invitation failed; member row created. User will be linked on first login.";
    }
  } else {
    note =
      "CLERK_SECRET_KEY not set (dev keyless); skipped Clerk invitation. User will be linked on first login.";
  }

  const [member] = await adminDb
    .insert(schema.teamMembers)
    .values({
      teamId,
      email,
      status: "invited",
      invitedBy: userId,
    })
    .returning();

  return Response.json({ member, clerkInviteSent, note }, { status: 201 });
}
