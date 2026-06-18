import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";

import { adminDb } from "@/lib/db/admin";
import { schema } from "@/db";

import type { EnrichmentSettings } from "./config";
import { Tier, type FieldValue, type ProviderResult } from "./types";

/**
 * Drizzle-backed TTL cache keyed by (identityHash, provider), on the
 * enrichmentCache table.
 *
 * The cache short-circuits provider calls: before invoking any provider the
 * orchestrator checks for a fresh cached payload for that identity + provider
 * and reuses it on a hit, avoiding both cost and latency. A row is fresh while
 * now() < expiresAt.
 *
 * Any DB or deserialization error degrades to a miss / no-op so caching never
 * blocks enrichment.
 */

/** Cache TTL in seconds for a given tier. */
export function ttlForTier(tier: Tier, settings: EnrichmentSettings): number {
  return (
    settings.cacheTtlSeconds[tier] ?? settings.cacheTtlSeconds["T2_person"]
  );
}

/** Revive a serialized ProviderResult, restoring Date objects on FieldValues. */
function reviveResult(payload: Record<string, unknown>): ProviderResult {
  const reviveFields = (raw: unknown): Record<string, FieldValue> => {
    const out: Record<string, FieldValue> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const fv = v as Record<string, unknown>;
        out[k] = {
          value: fv.value,
          source: String(fv.source ?? ""),
          confidence: Number(fv.confidence ?? 0),
          verified: Boolean(fv.verified),
          observedAt: fv.observedAt
            ? new Date(String(fv.observedAt))
            : new Date(),
        };
      }
    }
    return out;
  };

  return {
    provider: String(payload.provider ?? ""),
    tier: (payload.tier as Tier) ?? Tier.T0Master,
    success: Boolean(payload.success),
    fields: reviveFields(payload.fields),
    firmographics: (payload.firmographics as Record<string, unknown>) ?? {},
    emailVerification:
      (payload.emailVerification as ProviderResult["emailVerification"]) ??
      null,
    costUsd: Number(payload.costUsd ?? 0),
    latencyMs:
      payload.latencyMs === null || payload.latencyMs === undefined
        ? null
        : Number(payload.latencyMs),
    httpStatus:
      payload.httpStatus === null || payload.httpStatus === undefined
        ? null
        : Number(payload.httpStatus),
    error:
      payload.error === undefined ? null : (payload.error as string | null),
    requestIdentifiers:
      (payload.requestIdentifiers as Record<string, unknown>) ?? {},
  };
}

/** Highest field confidence in a result, for the cache row's summary column. */
function maxConfidence(result: ProviderResult): number {
  const vals = Object.values(result.fields).map((fv) => fv.confidence);
  return vals.length ? Math.max(...vals) : 0;
}

/**
 * Return a fresh cached ProviderResult for (identityHash, provider), else null.
 * Any error degrades to a miss so caching never blocks enrichment.
 */
export async function getCached(
  identityHashValue: string,
  provider: string,
): Promise<ProviderResult | null> {
  try {
    const [row] = await adminDb
      .select({ payload: schema.enrichmentCache.payload })
      .from(schema.enrichmentCache)
      .where(
        and(
          eq(schema.enrichmentCache.identityHash, identityHashValue),
          eq(schema.enrichmentCache.provider, provider),
          gt(schema.enrichmentCache.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row || !row.payload) return null;
    return reviveResult(row.payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Upsert a successful ProviderResult into the cache with a per-tier TTL.
 * Only successful results are cached. Any DB error is swallowed.
 */
export async function setCached(
  identityHashValue: string,
  result: ProviderResult,
  settings: EnrichmentSettings,
): Promise<void> {
  if (!result.success) return;
  const ttl = ttlForTier(result.tier, settings);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const payload = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  try {
    await adminDb
      .insert(schema.enrichmentCache)
      .values({
        identityHash: identityHashValue,
        provider: result.provider,
        payload,
        confidence: String(maxConfidence(result)),
        fetchedAt: new Date(),
        ttlSeconds: ttl,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.enrichmentCache.identityHash,
          schema.enrichmentCache.provider,
        ],
        set: {
          payload,
          confidence: String(maxConfidence(result)),
          fetchedAt: new Date(),
          ttlSeconds: ttl,
          expiresAt,
        },
      });
  } catch {
    return;
  }
}

/** Delete expired cache rows. Optional housekeeping; safe to call from a cron. */
export async function purgeExpiredCache(): Promise<void> {
  try {
    await adminDb
      .delete(schema.enrichmentCache)
      .where(sql`${schema.enrichmentCache.expiresAt} <= now()`);
  } catch {
    return;
  }
}
