import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/admin/guard";
import { getAppSetting, setAppSetting } from "@/lib/app-settings";
import { CURATED_MODELS, Models } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/**
 * Super-admin app settings: the instance-wide default model and the usage
 * alert thresholds. Values live in the app_settings table (see
 * src/lib/app-settings.ts); resolution order for the model is
 * user preference → "default_model" here → env default.
 */

const bodySchema = z
  .object({
    // null clears the admin override (fall back to the env default).
    defaultModel: z.string().trim().min(1).max(200).nullable().optional(),
    // Fractions of a cap at which to alert, e.g. [0.8, 1].
    alertThresholds: z.array(z.number().gt(0).max(2)).min(1).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function GET() {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;

  const [defaultModel, alertThresholds] = await Promise.all([
    getAppSetting("default_model"),
    getAppSetting("alert_thresholds"),
  ]);

  return Response.json({
    defaultModel:
      typeof defaultModel === "string" && defaultModel.trim() !== ""
        ? defaultModel
        : null,
    envDefaultModel: Models.default(),
    alertThresholds: Array.isArray(alertThresholds)
      ? alertThresholds
      : [0.8, 1],
    curatedModels: CURATED_MODELS,
  });
}

export async function POST(request: Request) {
  const guard = await requireSuperAdminApi();
  if (guard instanceof Response) return guard;
  const { userId } = guard;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if ("defaultModel" in input) {
    // "" clears the override (the jsonb column is NOT NULL; readers treat an
    // empty string as unset — see getAppSettingString).
    await setAppSetting("default_model", input.defaultModel ?? "", userId);
  }
  if (input.alertThresholds !== undefined) {
    const sorted = [...input.alertThresholds].sort((a, b) => a - b);
    await setAppSetting("alert_thresholds", sorted, userId);
  }

  return Response.json({ ok: true });
}
