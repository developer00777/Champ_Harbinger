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

// Use getSingleMetric to avoid re-registering on hot reload.
// Counter/Histogram constructors throw if the name is already registered.
function getOrCreateCounter(
  r: Registry,
  name: string,
  help: string,
  labelNames: string[],
): Counter {
  return (
    (r.getSingleMetric(name) as Counter | undefined) ??
    new Counter({ name, help, labelNames, registers: [r] })
  );
}

function getOrCreateHistogram(
  r: Registry,
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
): Histogram {
  return (
    (r.getSingleMetric(name) as Histogram | undefined) ??
    new Histogram({ name, help, labelNames, buckets, registers: [r] })
  );
}

const r = getRegistry();

export const httpRequestsTotal = getOrCreateCounter(
  r,
  "harbinger_http_requests_total",
  "Total HTTP requests handled",
  ["method", "route", "status"],
);

export const httpRequestDuration = getOrCreateHistogram(
  r,
  "harbinger_http_request_duration_seconds",
  "HTTP request duration in seconds",
  ["method", "route"],
  [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export const aiCallsTotal = getOrCreateCounter(
  r,
  "harbinger_ai_calls_total",
  "Total AI provider calls",
  ["model", "status"],
);

export const aiCallDuration = getOrCreateHistogram(
  r,
  "harbinger_ai_call_duration_seconds",
  "AI call duration in seconds",
  ["model"],
  [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
);

export function getRegistryForExport() {
  return r;
}
