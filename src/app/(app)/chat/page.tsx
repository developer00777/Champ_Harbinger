"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  MessageCircle,
  PencilLine,
  Search,
  Activity,
  Trash2,
} from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { SafeLink } from "@/components/safe-link";
import { Button } from "@/components/ui/button";
import type { ChatSummary } from "@/lib/services/chat-history";

const STARTERS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  prefill: string;
}[] = [
  {
    icon: Search,
    title: "Research a company",
    body: "Find signals, contacts, and recent news.",
    prefill: "Research ",
  },
  {
    icon: PencilLine,
    title: "Draft an email",
    body: "Write a personalized cold outreach.",
    prefill: "Draft a cold email to ",
  },
  {
    icon: MessageCircle,
    title: "Find contacts",
    body: "Who should I reach out to at…",
    prefill: "Find the right contacts at ",
  },
  {
    icon: Activity,
    title: "Summarize signals",
    body: "What's changed at my tracked accounts?",
    prefill: "What are the latest signals across my campaigns?",
  },
];

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ChatPage() {
  const router = useRouter();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetch("/api/chats")
      .then((res) => res.json())
      .then((data: { chats: ChatSummary[] }) => {
        if (mountedRef.current) {
          setChats(data.chats ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onSubmit = () => {
    if (!input.trim()) return;
    // Create a new chat and navigate to it — the text is passed via search param
    // so the new page can auto-send it.
    const id = crypto.randomUUID();
    const params = new URLSearchParams({ q: input });
    router.push(`/chat/${id}?${params.toString()}`);
  };

  const handleDelete = (chatId: string) => {
    fetch("/api/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
    })
      .then(() => setChats((prev) => prev.filter((c) => c.id !== chatId)))
      .catch(() => {});
  };

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 pt-12 pb-4">
          {/* Hero */}
          <div className="mb-8 text-center">
            <div className="bg-peach text-peach-foreground mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl">
              <MessageCircle className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              How can I help?
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Research a company, draft a message, or ask anything about your
              pipeline.
            </p>
          </div>

          {/* Starter prompts */}
          <div className="mb-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s.title}
                type="button"
                onClick={() => setInput(s.prefill)}
                className="bg-card shadow-card hover:border-primary group rounded-xl border border-border p-3.5 text-left transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span className="bg-peach text-peach-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <s.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold">{s.title}</span>
                </div>
                <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
                  {s.body}
                </p>
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && chats.length === 0 && (
            <div className="text-center">
              <p className="text-muted-foreground text-sm">
                No chats yet. Start one using the box below.
              </p>
            </div>
          )}

          {!loading && chats.length > 0 && (
            <div className="space-y-0.5">
              <h3 className="eyebrow mb-2.5">Recent chats</h3>
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className="hover:bg-muted group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                >
                  <SafeLink
                    href={`/chat/${chat.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <MessageCircle className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {chat.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                      {timeAgo(chat.updated_at)}
                    </span>
                  </SafeLink>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete chat "${chat.title}"`}
                    className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0 opacity-60 transition-opacity hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      handleDelete(chat.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ChatInput
        input={input}
        isLoading={false}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onStop={() => {}}
      />
    </div>
  );
}
