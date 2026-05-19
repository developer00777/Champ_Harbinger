import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/api/validate-api-key";
import {
  checkAllEnabledFeeds,
  checkAllFeeds,
  checkFeed,
} from "@/lib/services/rss-monitor";

export const maxDuration = 60;

/**
 * Trigger RSS/Atom feed checks.
 *
 *   { feedId: "..." }            → check exactly that feed
 *   { userId: "user_..." }       → check every enabled feed for that user
 *   {}                           → check every enabled feed system-wide (cron)
 *
 * Authenticated by `chh_` API key (same as /api/v1/*).
 */
export async function POST(request: Request) {
  try {
    await validateApiKey(request);
  } catch (e) {
    return e as Response;
  }

  let body: { userId?: string; feedId?: string } = {};
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      body = JSON.parse(raw) as { userId?: string; feedId?: string };
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.feedId) {
    const result = await checkFeed(body.feedId);
    return NextResponse.json({
      scope: "feed",
      feedId: body.feedId,
      checked: 1,
      newItems: result.newItems,
      errors: result.errors,
    });
  }

  if (body.userId) {
    const result = await checkAllFeeds(body.userId);
    return NextResponse.json({
      scope: "user",
      userId: body.userId,
      ...result,
    });
  }

  const result = await checkAllEnabledFeeds();
  return NextResponse.json({ scope: "all", ...result });
}
