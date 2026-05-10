import { NextResponse } from "next/server";
import { getSupabaseAndUser } from "@/lib/supabase/server";
import { getEmailProvider } from "@/lib/email/provider";

export async function GET() {
  const ctx = await getSupabaseAndUser();
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, user } = ctx;

  const { data: settings } = await supabase
    .from("user_settings")
    .select("from_name, reply_to_email")
    .eq("user_id", user.id)
    .maybeSingle();

  const provider = getEmailProvider();

  return NextResponse.json({
    settings: settings ?? {
      from_name: null,
      reply_to_email: null,
    },
    is_configured: provider.enabled,
    provider_name: provider.name,
  });
}

export async function POST(request: Request) {
  const ctx = await getSupabaseAndUser();
  if (!ctx)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, user } = ctx;
  const body = await request.json();

  // Save/update settings
  const { from_name, reply_to_email } = body;

  const fields = {
    user_id: user.id,
    from_name: from_name ?? null,
    reply_to_email: reply_to_email ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("user_settings").upsert(fields, {
    onConflict: "user_id",
  });

  if (error) {
    return NextResponse.json(
      { error: `Failed to save settings: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true });
}
