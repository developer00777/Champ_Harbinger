import { describe, expect, it, vi } from "vitest";

import { researchSignal, type ResearchContext } from "./researcher";

/**
 * Acceptance gate for Port A's core constraint: researchSignal() must return
 * exactly one short, grounded fact — or null, never a fabricated one.
 *
 * All DB access is bypassed via dependency injection (loadContext,
 * persistHook); only the LLM call is mocked, per fixture, to simulate real
 * model behavior including bad/fabricated responses the mechanical grounding
 * check must still reject.
 */

function ctx(
  personId: string,
  sources: ResearchContext["sources"],
  signalName?: string,
): ResearchContext {
  return {
    signalResultId: `sr-${personId}`,
    personId,
    signalName,
    sources,
  };
}

function llm(object: Record<string, unknown>) {
  return vi.fn(async () => ({ object }));
}

const persistHook = vi.fn(async () => {});

function run(context: ResearchContext, object: Record<string, unknown>) {
  persistHook.mockClear();
  return researchSignal(context.signalResultId, {
    loadContext: async () => context,
    generateObject: llm(object),
    persistHook,
  });
}

describe("researchSignal — the single-fact constraint", () => {
  it("new exec hire: returns one concrete, grounded fact", async () => {
    const text =
      "Jane Doe was named CFO of Acme Corp on 2026-06-01, replacing outgoing CFO Tom Reed.";
    const context = ctx(
      "p1",
      [
        {
          label: "signal_result_output",
          text,
          url: "https://news.example.com/a",
        },
      ],
      "Executive Hire",
    );
    const result = await run(context, {
      fact: "Jane Doe was named CFO of Acme Corp on 2026-06-01.",
      sourceIndex: 0,
      evidenceQuote: "Jane Doe was named CFO of Acme Corp on 2026-06-01",
    });
    expect(result).not.toBeNull();
    expect(result!.primaryHook.fact.length).toBeLessThan(200);
    expect(result!.primaryHook.fact).toContain("Jane Doe");
    expect(result!.primaryHook.sourceUrl).toBe("https://news.example.com/a");
    expect(result!.personId).toBe("p1");
    expect(persistHook).toHaveBeenCalledOnce();
  });

  it("funding round: returns one concrete, grounded fact", async () => {
    const text =
      "Acme Corp raised $40M in a Series C round led by XYZ Ventures.";
    const context = ctx(
      "p2",
      [{ label: "signal_result_output", text }],
      "Funding",
    );
    const result = await run(context, {
      fact: "Acme Corp raised $40M in a Series C round led by XYZ Ventures.",
      sourceIndex: 0,
      evidenceQuote:
        "Acme Corp raised $40M in a Series C round led by XYZ Ventures",
    });
    expect(result).not.toBeNull();
    expect(result!.primaryHook.fact.length).toBeLessThan(200);
  });

  it("ESG milestone: returns one concrete, grounded fact", async () => {
    const text =
      "Acme Corp achieved carbon-neutral certification for its EU plants in Q2 2026.";
    const context = ctx(
      "p3",
      [{ label: "signal_result_output", text }],
      "ESG Milestone",
    );
    const result = await run(context, {
      fact: "Acme Corp achieved carbon-neutral certification for its EU plants in Q2 2026.",
      sourceIndex: 0,
      evidenceQuote:
        "carbon-neutral certification for its EU plants in Q2 2026",
    });
    expect(result).not.toBeNull();
    expect(result!.primaryHook.fact.length).toBeLessThan(200);
  });

  it("product launch: returns one concrete, grounded fact", async () => {
    const text =
      "Acme Corp launched Widget Pro, its new AI-powered SKU, on 2026-05-15.";
    const context = ctx(
      "p4",
      [{ label: "signal_result_output", text }],
      "Product Launch",
    );
    const result = await run(context, {
      fact: "Acme Corp launched Widget Pro, its new AI-powered SKU, on 2026-05-15.",
      sourceIndex: 0,
      evidenceQuote:
        "launched Widget Pro, its new AI-powered SKU, on 2026-05-15",
    });
    expect(result).not.toBeNull();
    expect(result!.primaryHook.fact.length).toBeLessThan(200);
  });

  it("industry award: returns one concrete, grounded fact", async () => {
    const text = "Acme Corp was named to the Forbes Cloud 100 list for 2026.";
    const context = ctx(
      "p5",
      [{ label: "signal_result_output", text }],
      "Award",
    );
    const result = await run(context, {
      fact: "Acme Corp was named to the Forbes Cloud 100 list for 2026.",
      sourceIndex: 0,
      evidenceQuote: "named to the Forbes Cloud 100 list for 2026",
    });
    expect(result).not.toBeNull();
  });

  it("conference speaking slot: returns one concrete, grounded fact from an enrichment source", async () => {
    const context = ctx(
      "p6",
      [
        {
          label: "enrichment_field_provenance:recent_activity",
          text: "recent_activity: Speaking at SaaStr Annual 2026 on scaling RevOps (source: owned_scrape)",
        },
      ],
      "LinkedIn Activity",
    );
    const result = await run(context, {
      fact: "They are speaking at SaaStr Annual 2026 on scaling RevOps.",
      sourceIndex: 0,
      evidenceQuote: "Speaking at SaaStr Annual 2026 on scaling RevOps",
    });
    expect(result).not.toBeNull();
  });

  it("generic/noisy filler: model correctly declines and returns null, not a fabricated fact", async () => {
    const text =
      "Acme Corp is a growing company in the industry focused on innovation and customer success.";
    const context = ctx(
      "p7",
      [{ label: "signal_result_output", text }],
      "Generic Noise",
    );
    const result = await run(context, {
      fact: null,
      sourceIndex: null,
      evidenceQuote: null,
    });
    expect(result).toBeNull();
    expect(persistHook).not.toHaveBeenCalled();
  });

  it("empty/boilerplate press-release filler: returns null", async () => {
    const text =
      "We are excited to share some updates about our journey and our amazing team.";
    const context = ctx(
      "p8",
      [{ label: "signal_result_output", text }],
      "Newsletter",
    );
    const result = await run(context, {
      fact: null,
      sourceIndex: null,
      evidenceQuote: null,
    });
    expect(result).toBeNull();
  });

  it("rejects a fact when the model fabricates a quote not present in the cited source", async () => {
    const text = "Acme Corp updated its privacy policy.";
    const context = ctx(
      "p9",
      [{ label: "signal_result_output", text }],
      "Policy Update",
    );
    const result = await run(context, {
      fact: "Acme Corp raised $100M Series D.", // not supported by the source at all
      sourceIndex: 0,
      evidenceQuote: "raised $100M Series D", // fabricated — not in source text
    });
    expect(result).toBeNull();
    expect(persistHook).not.toHaveBeenCalled();
  });

  it("rejects a fact with an out-of-range sourceIndex", async () => {
    const text = "Acme Corp hired a new VP of Sales.";
    const context = ctx(
      "p10",
      [{ label: "signal_result_output", text }],
      "Hire",
    );
    const result = await run(context, {
      fact: "Acme Corp hired a new VP of Sales.",
      sourceIndex: 5, // only source 0 exists
      evidenceQuote: "hired a new VP of Sales",
    });
    expect(result).toBeNull();
  });

  it("rejects a fact that reads like a paragraph (over the length guard)", async () => {
    const longFact =
      "Acme Corp, a fast-growing SaaS company headquartered in Austin, Texas, recently announced " +
      "the completion of a $40M Series C financing round led by XYZ Ventures with participation " +
      "from several existing investors, which the company says it will use to expand its go-to-market team.";
    const text = longFact;
    const context = ctx(
      "p11",
      [{ label: "signal_result_output", text }],
      "Funding",
    );
    const result = await run(context, {
      fact: longFact,
      sourceIndex: 0,
      evidenceQuote: "$40M Series C financing round led by XYZ Ventures",
    });
    expect(result).toBeNull();
  });

  it("returns null when there is no source content to research at all", async () => {
    const context = ctx("p12", [], "Empty");
    const result = await researchSignal(context.signalResultId, {
      loadContext: async () => context,
      generateObject: llm({
        fact: null,
        sourceIndex: null,
        evidenceQuote: null,
      }),
      persistHook,
    });
    expect(result).toBeNull();
  });

  it("returns null when the LLM call throws", async () => {
    const text = "Acme Corp launched a new product.";
    const context = ctx(
      "p13",
      [{ label: "signal_result_output", text }],
      "Launch",
    );
    const result = await researchSignal(context.signalResultId, {
      loadContext: async () => context,
      generateObject: vi.fn(async () => {
        throw new Error("provider timeout");
      }),
      persistHook,
    });
    expect(result).toBeNull();
  });

  it("passes personId/organizationId through from the context on success", async () => {
    const text = "Acme Corp opened a new office in Berlin.";
    const context: ResearchContext = {
      signalResultId: "sr-org1",
      organizationId: "org1",
      sources: [{ label: "signal_result_output", text }],
      signalName: "Expansion",
    };
    const result = await researchSignal(context.signalResultId, {
      loadContext: async () => context,
      generateObject: llm({
        fact: "Acme Corp opened a new office in Berlin.",
        sourceIndex: 0,
        evidenceQuote: "opened a new office in Berlin",
      }),
      persistHook,
    });
    expect(result).not.toBeNull();
    expect(result!.organizationId).toBe("org1");
    expect(result!.personId).toBeUndefined();
  });
});
