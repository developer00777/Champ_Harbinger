import { NextResponse } from "next/server";
import { getCurrentUserOrNull } from "@/lib/auth";
import { db } from "@/db";
import { loadChat, saveChat } from "@/lib/services/chat-history";
import type { UIMessage } from "ai";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId } = await params;
  const chat = await loadChat(db, chatId);
  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(chat);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId } = await params;
  const { messages, campaignId } = (await request.json()) as {
    messages: UIMessage[];
    campaignId?: string;
  };
  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  await saveChat(db, user.userId, chatId, messages, campaignId);
  return NextResponse.json({ ok: true });
}
