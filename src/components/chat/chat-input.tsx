"use client";

import { useEffect, useRef } from "react";

import { ArrowUp, Paperclip, Square } from "lucide-react";
import posthog from "posthog-js";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onCsvUpload?: (content: string, fileName: string) => void;
  disabled?: boolean;
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop,
  onCsvUpload,
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasLoadingRef = useRef(false);

  // Auto-focus after streaming ends
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      textareaRef.current?.focus();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading && !disabled) {
        handleSubmit();
      }
    }
  };

  const handleSubmit = () => {
    posthog.capture("chat_message_sent", {
      message_length: input.trim().length,
    });
    onSubmit();
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // Re-focus after submit
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCsvUpload) return;
    posthog.capture("csv_uploaded", {
      file_name: file.name,
      file_size_bytes: file.size,
    });
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onCsvUpload(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  };

  return (
    <div className="bg-card border-border border-t px-4 pt-4 pb-5 md:px-6">
      <div className="mx-auto max-w-3xl">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="bg-background border-border shadow-card overflow-hidden rounded-xl border focus-within:border-primary">
          <Textarea
            ref={textareaRef}
            placeholder="Ask anything about your pipeline…"
            className="max-h-[120px] min-h-[52px] resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 pt-3.5 pb-0 text-sm shadow-none transition-[height] duration-100 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
            rows={1}
            value={input}
            disabled={disabled}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-2">
            <div className="flex items-center gap-1.5">
              {onCsvUpload && (
                <button
                  type="button"
                  aria-label="Upload CSV"
                  title="Upload CSV"
                  disabled={disabled || isLoading}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground hover:border-primary inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach
                </button>
              )}
            </div>
            {isLoading ? (
              <Button
                size="icon"
                variant="outline"
                aria-label="Stop generating"
                className="h-8 w-8 shrink-0 rounded-lg"
                onClick={onStop}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                aria-label="Send message"
                className="h-8 w-8 shrink-0 rounded-lg"
                disabled={disabled || !input.trim()}
                onClick={handleSubmit}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-center text-[11px]">
          Shift+Enter for new line · Enter to send
        </p>
      </div>
    </div>
  );
}
