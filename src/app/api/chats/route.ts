import { NextResponse } from "next/server";
import { getCurrentUserOrNull } from "@/lib/auth";
import { db } from "@/db";
import { listChats, deleteChat } from "@/lib/services/chat-history";

export async function GET() {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chats = await listChats(db, user.userId, 50);
  return NextResponse.json({ chats });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUserOrNull();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { chatId } = (await request.json()) as { chatId: string };
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }
  await deleteChat(db, chatId);
  return NextResponse.json({ ok: true });
}
