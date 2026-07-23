import { describe, expect, it, vi, beforeEach } from "vitest";

const generateObjectMock = vi.fn();

vi.mock("@/lib/ai/generate", () => ({
  generateObjectLimited: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@/lib/ai/provider", () => ({
  getClassificationModelSync: vi.fn(() => "mock-model"),
}));

import { classifyReply } from "./classify";

describe("classifyReply", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it("classifies unsubscribe requests deterministically without calling the LLM", async () => {
    const result = await classifyReply({
      subject: "Re: intro",
      body: "Please unsubscribe me from this list, thanks.",
    });
    expect(result).toEqual({ intent: "unsubscribe", confidence: 1 });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("classifies opt-out phrasing as unsubscribe without calling the LLM", async () => {
    const result = await classifyReply({
      subject: "Stop",
      body: "I'd like to opt-out of future emails.",
    });
    expect(result.intent).toBe("unsubscribe");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("classifies out-of-office autoreplies deterministically without calling the LLM", async () => {
    const result = await classifyReply({
      subject: "Automatic reply: Out of Office",
      body: "I am currently out of the office and will return on Monday.",
    });
    expect(result.intent).toBe("out_of_office");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("falls through to the LLM for everything else", async () => {
    generateObjectMock.mockResolvedValue({
      object: { intent: "interested", confidence: 0.85 },
    });

    const result = await classifyReply({
      subject: "Re: intro",
      body: "This looks interesting, tell me more.",
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ intent: "interested", confidence: 0.85 });
  });

  it("propagates LLM errors to the caller (respond.ts is responsible for the fallback)", async () => {
    generateObjectMock.mockRejectedValue(new Error("model unavailable"));

    await expect(
      classifyReply({ subject: "Re: intro", body: "What does this cost?" }),
    ).rejects.toThrow("model unavailable");
  });
});
