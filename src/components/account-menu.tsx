"use client";

import { useRouter } from "next/navigation";
import {
  LogOut,
  MessageSquare,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import { useClerk } from "@clerk/nextjs";

import { isDevAuthBypassClient, useUserOrDev } from "@/lib/dev-auth-client";
import { SafeLink } from "@/components/safe-link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FEEDBACK_HREF =
  "mailto:hello@championsgroup.com?subject=ChampHarbinger%20feedback";

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Top-bar account control (Aegis). The avatar opens a menu with the live Clerk
 * identity plus the app-level entries that used to live in the sidebar footer:
 * Settings, Admin (super-admin only), Feedback, and Log out.
 */
export function AccountMenu({
  isSuperAdmin = false,
}: {
  readonly isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user } = useUserOrDev();

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const name = user?.fullName?.trim() || user?.username || email || "Account";
  const avatar = user?.imageUrl || "";

  async function handleSignOut() {
    // Under the local dev bypass there is no Clerk session to end, and the
    // middleware would just let the user back in. Go to /login so the button
    // isn't a no-op, but skip the Clerk call.
    if (!isDevAuthBypassClient()) {
      await signOut();
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account"
      >
        <Avatar className="h-7 w-7 border border-border">
          <AvatarImage src={avatar || undefined} alt={name} />
          <AvatarFallback className="text-[11px]">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={avatar || undefined} alt={name} />
              <AvatarFallback className="rounded-lg">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="text-muted-foreground truncate text-xs">
                {email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<SafeLink href="/settings" />}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        {isSuperAdmin && (
          <DropdownMenuItem render={<SafeLink href="/admin" />}>
            <ShieldCheck />
            Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<a href={FEEDBACK_HREF} />}>
          <MessageSquare />
          Feedback
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
