import { getModelSync as getModel } from "@/lib/ai/provider";
import { Models } from "@/lib/ai/models";
import { generateText } from "ai";

import {
  estimateClaudeCostFromUsage,
  trackUsage,
} from "@/lib/services/cost-tracker";
import { getCurrentUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";
import { eq, and } from "drizzle-orm";

export async function POST(request: Request) {
  let userId: string;
  try {
    ({ userId } = await getCurrentUser());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { chatId } = (await request.json()) as { chatId: string };
  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  // Fetch the chat scoped to the signed-in user (defense in depth).
  const [chat] = await adminDb
    .select()
    .from(schema.chats)
    .where(
      and(eq(schema.chats.id, chatId), eq(schema.chats.clerkUserId, userId)),
    )
    .limit(1);

  if (!chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const messages = chat.messages as Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;

  if (!messages || messages.length === 0) {
    return Response.json({ title: chat.title });
  }

  // Build a compact transcript (text parts only, truncated)
  const lines: string[] = [];
  let charCount = 0;
  const MAX_CHARS = 2000;

  for (const msg of messages) {
    if (charCount >= MAX_CHARS) break;
    const textParts = (msg.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!);
    if (textParts.length === 0) continue;
    const text = textParts.join(" ").slice(0, MAX_CHARS - charCount);
    lines.push(`${msg.role}: ${text}`);
    charCount += text.length;
  }

  const { text: title, usage } = await generateText({
    model: getModel(Models.classification),
    system:
      "Summarize this conversation in 6-10 words as a short title. No quotes, no punctuation at the end. Be specific about the topic, not generic.",
    prompt: lines.join("\n"),
  });

  trackUsage({
    service: "claude",
    operation: "chat-summarize",
    tokens_input: usage.inputTokens ?? 0,
    tokens_output: usage.outputTokens ?? 0,
    estimated_cost_usd: estimateClaudeCostFromUsage("haiku", usage),
    metadata: { model: "claude-haiku-4.5", chatId },
    user_id: userId,
  });

  // Update the title
  const trimmed = title.trim().slice(0, 120);
  await adminDb
    .update(schema.chats)
    .set({ title: trimmed })
    .where(eq(schema.chats.id, chatId));

  return Response.json({ title: trimmed });
}
