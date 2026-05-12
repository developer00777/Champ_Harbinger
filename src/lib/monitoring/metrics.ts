import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
} from "prom-client";

declare global {
  var __harbinger_registry: Registry | undefined;
}

function getRegistry(): Registry {
  if (!global.__harbinger_registry) {
    const r = new Registry();
    collectDefaultMetrics({ register: r, prefix: "harbinger_" });
    global.__harbinger_registry = r;
  }
  return global.__harbinger_registry;
}

const r = getRegistry();

export const httpRequestsTotal = new Counter({
  name: "harbinger_http_requests_total",
  help: "Total HTTP requests handled",
  labelNames: ["method", "route", "status"] as const,
  registers: [r],
});

export const httpRequestDuration = new Histogram({
  name: "harbinger_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [r],
});

export const aiCallsTotal = new Counter({
  name: "harbinger_ai_calls_total",
  help: "Total AI provider calls",
  labelNames: ["model", "status"] as const,
  registers: [r],
});

export const aiCallDuration = new Histogram({
  name: "harbinger_ai_call_duration_seconds",
  help: "AI call duration in seconds",
  labelNames: ["model"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [r],
});

export function getRegistryForExport() {
  return r;
}
