import type { Metadata } from "next";
import { Hero } from "@/components/marketing/hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Proof } from "@/components/marketing/proof";
import { CTA } from "@/components/marketing/cta";

export const metadata: Metadata = {
  title: "ChampHarbinger: Detect buying signals before they become deals",
  description:
    "ChampHarbinger watches the web for hiring shifts, funding rounds, product launches, and sentiment changes. Enriches contacts and drafts personalized outreach in a single workspace.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeatureGrid />
      <Proof />
      <CTA />
    </>
  );
}
