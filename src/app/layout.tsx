import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PostHogIdentify } from "@/components/posthog-identify";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "ChampHarbinger",
  description:
    "Detect buying signals before they become deals. A Champions Group product.",
};

/**
 * Root layout — wraps every route in the app.
 * Auth-gated pages are in src/app/(app)/ and get DashboardShell via (app)/layout.tsx.
 * Public marketing pages are in src/app/(marketing)/ and get MarketingHeader/Footer.
 * Both route groups handle their own structural layout; the root stays minimal.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ClerkProvider appearance={{ theme: shadcn }}>
          <PostHogIdentify />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>
              {children}
              <Toaster richColors />
            </TooltipProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
