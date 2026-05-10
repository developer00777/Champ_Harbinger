import { eq, desc } from "drizzle-orm";
import type { UIMessage } from "ai";
import type { Db } from "@/db";
import { schema } from "@/db";

// ---------------------------------------------------------------------------
// Title generation (pure function, no LLM call)
// ---------------------------------------------------------------------------

function generateTitle(messages: UIMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New chat";

  const text = firstUserMsg.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();

  if (!text) return "New chat";
  if (text.length <= 80) return text;
  const truncated = text.slice(0, 77).replace(/\s+\S*$/, "");
  return truncated ? `${truncated}...` : `${text.slice(0, 77)}...`;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export interface ChatSummary {
  id: string;
  title: string;
  campaign_id: string | null;
  updated_at: string;
}

export async function saveChat(
  db: Db,
  userId: string,
  chatId: string,
  messages: UIMessage[],
  campaignId?: string,
): Promise<void> {
  const title = generateTitle(messages);
  const now = new Date();

  try {
    await db
      .insert(schema.chats)
      .values({
        id: chatId as unknown as undefined,
        clerkUserId: userId,
        title,
        campaignId: campaignId ?? null,
        messages: JSON.parse(JSON.stringify(messages)),
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: schema.chats.id,
        set: {
          title,
          messages: JSON.parse(JSON.stringify(messages)),
          updatedAt: now,
        },
      });
  } catch (err) {
    console.error("[chat-history] save failed:", err);
  }
}

export async function loadChat(
  db: Db,
  chatId: string,
): Promise<{
  id: string;
  title: string;
  campaign_id: string | null;
  messages: UIMessage[];
} | null> {
  const [data] = await db
    .select({
      id: schema.chats.id,
      title: schema.chats.title,
      campaign_id: schema.chats.campaignId,
      messages: schema.chats.messages,
    })
    .from(schema.chats)
    .where(eq(schema.chats.id, chatId))
    .limit(1);

  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    campaign_id: data.campaign_id ?? null,
    messages: (data.messages as UIMessage[]) ?? [],
  };
}

export async function loadCampaignChat(
  db: Db,
  campaignId: string,
): Promise<{ id: string; messages: UIMessage[] } | null> {
  const [data] = await db
    .select({
      id: schema.chats.id,
      messages: schema.chats.messages,
    })
    .from(schema.chats)
    .where(eq(schema.chats.campaignId, campaignId))
    .orderBy(desc(schema.chats.updatedAt))
    .limit(1);

  if (!data) return null;
  return { id: data.id, messages: (data.messages as UIMessage[]) ?? [] };
}

export async function listChats(
  db: Db,
  userId: string,
  limit = 30,
): Promise<ChatSummary[]> {
  const rows = await db
    .select({
      id: schema.chats.id,
      title: schema.chats.title,
      campaign_id: schema.chats.campaignId,
      updated_at: schema.chats.updatedAt,
    })
    .from(schema.chats)
    .where(eq(schema.chats.clerkUserId, userId))
    .orderBy(desc(schema.chats.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    campaign_id: r.campaign_id ?? null,
    updated_at: r.updated_at.toISOString(),
  }));
}

export async function deleteChat(db: Db, chatId: string): Promise<void> {
  await db.delete(schema.chats).where(eq(schema.chats.id, chatId));
}
