/**
 * ChampHarbinger Drizzle schema.
 *
 * Translated from supabase/migrations/20260419000000_initial_schema.sql
 * and subsequent migrations through 20260427000000_clerk_auth_migration.sql.
 *
 * Key translation rules vs. the original Supabase/Signal schema:
 * - `auth.users(id)` FK references → `text` column `clerk_user_id` (no FK;
 *   Clerk owns the identity layer).
 * - Tables that were user-owned gain `clerk_user_id text NOT NULL`.
 * - Tables that can belong to a Clerk org gain `clerk_org_id text`.
 * - All RLS policies dropped — scoping handled at the application layer via
 *   getScopedDb() in src/lib/db/scoped.ts.
 * - Timestamps kept with `defaultNow()`.
 * - UUIDs kept with `defaultRandom()`.
 * - pg_trgm extension usage kept as a comment; must be enabled in Postgres
 *   before running migrations if fuzzy-name indexes are desired.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

// ─── Core user-owned tables ───────────────────────────────────────────────────

/**
 * Campaigns: ICP definition, offering, positioning, search criteria.
 * Tenant-owned by clerk_user_id; optionally shared via clerk_org_id.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    name: text("name").notNull(),
    status: text("status").notNull().default("discovery"),
    icp: jsonb("icp").$type<Record<string, unknown>>().default({}).notNull(),
    offering: jsonb("offering")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    positioning: jsonb("positioning")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    searchCriteria: jsonb("search_criteria")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    notes: text("notes"),
    profileId: uuid("profile_id"),
    ...timestamps,
  },
  (t) => ({
    byUser: index("campaigns_clerk_user_id_idx").on(t.clerkUserId),
    byOrg: index("campaigns_clerk_org_id_idx").on(t.clerkOrgId),
  }),
);

/**
 * User profile: personal info, company, links, notes.
 * Tenant-owned; label distinguishes multiple profiles per user.
 */
export const userProfile = pgTable(
  "user_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    label: text("label"),
    name: text("name"),
    email: text("email"),
    companyName: text("company_name"),
    companyUrl: text("company_url"),
    personalUrl: text("personal_url"),
    linkedinUrl: text("linkedin_url"),
    twitterUrl: text("twitter_url"),
    roleTitle: text("role_title"),
    offeringSummary: text("offering_summary"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    byUser: index("user_profile_clerk_user_id_idx").on(t.clerkUserId),
    byOrg: index("user_profile_clerk_org_id_idx").on(t.clerkOrgId),
  }),
);

/**
 * Chats: persisted conversations.
 * Messages stored as a JSONB array of UIMessage objects.
 */
export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    title: text("title").notNull().default("New chat"),
    campaignId: uuid("campaign_id"),
    messages: jsonb("messages").$type<unknown[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    byUpdatedAt: index("chats_updated_at_idx").on(t.updatedAt),
    byCampaign: index("chats_campaign_id_idx").on(t.campaignId),
    byUser: index("chats_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

/**
 * API usage tracking: cost monitoring per service/operation.
 * Tenant-owned by clerk_user_id.
 */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    service: text("service").notNull(),
    operation: text("operation").notNull(),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    campaignId: uuid("campaign_id"),
    actionId: uuid("action_id"),
    actionLabel: text("action_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byCreatedAt: index("api_usage_created_at_idx").on(t.createdAt),
    byService: index("api_usage_service_idx").on(t.service, t.createdAt),
    byCampaign: index("api_usage_campaign_idx").on(t.campaignId),
    byAction: index("api_usage_action_idx").on(t.actionId),
    byUser: index("api_usage_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

/**
 * User settings: per-user email configuration (one row per user).
 */
export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    clerkOrgId: text("clerk_org_id"),
    agentmailInboxId: text("agentmail_inbox_id"),
    fromName: text("from_name"),
    replyToEmail: text("reply_to_email"),
    // ChampIQ integration settings
    champiqUrl: text("champiq_url"),
    champiqHandoffMode: text("champiq_handoff_mode").default("review"),
    champiqSignalConfig: jsonb("champiq_signal_config")
      .$type<Record<string, { mode: "auto" | "review"; min_score: number }>>()
      .default({}),
    // Lake B2B integration settings
    lakeb2bBaseUrl: text("lakeb2b_base_url"),
    ...timestamps,
  },
  (t) => ({
    byUser: index("user_settings_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

// ─── Shared knowledge base (org-level, not user-owned) ────────────────────────

/**
 * Organizations: enriched company records.
 * Shared pool — not scoped to a single user. Includes email pattern cache.
 * NOTE: Requires pg_trgm extension for the GIN index on name.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    domain: text("domain"),
    url: text("url"),
    industry: text("industry"),
    location: text("location"),
    description: text("description"),
    enrichmentData: jsonb("enrichment_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    enrichmentStatus: text("enrichment_status").notNull().default("pending"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    source: text("source"),
    // Email pattern cache (from 20260426000000_email_pattern.sql)
    emailPattern: text("email_pattern"),
    emailPatternConfidence: real("email_pattern_confidence"),
    emailPatternEvidenceCount: integer("email_pattern_evidence_count")
      .notNull()
      .default(0),
    emailPatternBounceCount: integer("email_pattern_bounce_count")
      .notNull()
      .default(0),
    emailPatternUpdatedAt: timestamp("email_pattern_updated_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => ({
    domainUnique: uniqueIndex("organizations_domain_unique_idx").on(t.domain),
    byLastEnriched: index("organizations_last_enriched_idx").on(
      t.lastEnrichedAt,
    ),
    // GIN index for trigram search requires pg_trgm extension:
    // CREATE INDEX organizations_name_trgm_idx ON organizations USING GIN (name gin_trgm_ops);
  }),
);

/**
 * People: enriched person records.
 * Shared pool — not scoped to a single user.
 * Email fields include verification metadata and email-source tracking.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    linkedinUrl: text("linkedin_url"),
    workEmail: text("work_email"),
    personalEmail: text("personal_email"),
    twitterUrl: text("twitter_url"),
    githubUrl: text("github_url"),
    title: text("title"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    enrichmentData: jsonb("enrichment_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    enrichmentStatus: text("enrichment_status").notNull().default("pending"),
    lastEnrichedAt: timestamp("last_enriched_at", { withTimezone: true }),
    source: text("source"),
    // Email verification (from 20260330020000_split_email_columns.sql)
    workEmailVerifiedAt: timestamp("work_email_verified_at", {
      withTimezone: true,
    }),
    personalEmailVerifiedAt: timestamp("personal_email_verified_at", {
      withTimezone: true,
    }),
    // Email source + confidence (from 20260426000000_email_pattern.sql)
    workEmailSource: text("work_email_source"),
    workEmailConfidence: real("work_email_confidence"),
    ...timestamps,
  },
  (t) => ({
    linkedinUnique: uniqueIndex("people_linkedin_unique_idx").on(t.linkedinUrl),
    githubUnique: uniqueIndex("people_github_url_unique_idx").on(t.githubUrl),
    byOrg: index("people_organization_id_idx").on(t.organizationId),
    byLastEnriched: index("people_last_enriched_idx").on(t.lastEnrichedAt),
    byWorkEmail: index("people_work_email_idx").on(t.workEmail),
    byPersonalEmail: index("people_personal_email_idx").on(t.personalEmail),
    byNameOrg: index("people_name_org_idx").on(t.name, t.organizationId),
  }),
);

// ─── Junction tables (campaign → org/person) ──────────────────────────────────

/**
 * Campaign <-> Organization join: per-campaign relevance scores and status.
 */
export const campaignOrganizations = pgTable(
  "campaign_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    relevanceScore: numeric("relevance_score", {
      precision: 3,
      scale: 1,
    }).default("0"),
    scoreReason: text("score_reason"),
    status: text("status").notNull().default("discovered"),
    readinessTag: text("readiness_tag"),
    ...timestamps,
  },
  (t) => ({
    uniquePair: unique("campaign_organizations_unique").on(
      t.campaignId,
      t.organizationId,
    ),
    byCampaign: index("campaign_orgs_campaign_idx").on(t.campaignId),
    byOrg: index("campaign_orgs_org_idx").on(t.organizationId),
    byStatus: index("campaign_orgs_status_idx").on(t.status),
    byReadiness: index("campaign_orgs_readiness_idx").on(t.readinessTag),
  }),
);

/**
 * Campaign <-> Person join: per-campaign outreach pipeline status.
 * Note: `status` column was dropped in 20260420000000_drop_campaign_people_status.sql.
 * Approval lives on email_drafts.review_status.
 */
export const campaignPeople = pgTable(
  "campaign_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    outreachStatus: text("outreach_status").notNull().default("not_contacted"),
    priorityScore: numeric("priority_score", {
      precision: 3,
      scale: 1,
    }).default("0"),
    scoreReason: text("score_reason"),
    readinessTag: text("readiness_tag"),
    ...timestamps,
  },
  (t) => ({
    uniquePair: unique("campaign_people_unique").on(t.campaignId, t.personId),
    byCampaign: index("campaign_people_campaign_idx").on(t.campaignId),
    byPerson: index("campaign_people_person_idx").on(t.personId),
    byOutreach: index("campaign_people_outreach_idx").on(t.outreachStatus),
    byPriority: index("campaign_people_priority_idx").on(t.priorityScore),
    byReadiness: index("campaign_people_readiness_idx").on(t.readinessTag),
  }),
);

// ─── Signals system ────────────────────────────────────────────────────────────

/**
 * Signals catalog: reusable signal definitions.
 * Built-in signals have clerkUserId = null (created by the platform).
 * User-authored signals have clerkUserId set.
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id"), // null for built-ins
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    longDescription: text("long_description"),
    category: text("category").notNull().default("custom"),
    icon: text("icon"),
    executionType: text("execution_type")
      .notNull()
      .default("agent_instructions"),
    toolKey: text("tool_key"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    createdBy: uuid("created_by"), // references user_profile.id — kept as loose ref
    ...timestamps,
  },
  (t) => ({
    bySlug: index("signals_slug_idx").on(t.slug),
    byCategory: index("signals_category_idx").on(t.category),
    byBuiltin: index("signals_builtin_idx").on(t.isBuiltin),
    byUser: index("signals_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

/**
 * Campaign <-> Signal join: which signals are active per campaign.
 */
export const campaignSignals = pgTable(
  "campaign_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    configOverride: jsonb("config_override")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (t) => ({
    uniquePair: unique("campaign_signals_unique").on(t.campaignId, t.signalId),
    byCampaign: index("campaign_signals_campaign_idx").on(t.campaignId),
    bySignal: index("campaign_signals_signal_idx").on(t.signalId),
  }),
);

/**
 * Signal results: execution outputs.
 */
export const signalResults = pgTable(
  "signal_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "cascade",
    }),
    output: jsonb("output")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").notNull().default("success"),
    trackingConfigId: uuid("tracking_config_id"), // references tracking_configs.id
    ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bySignal: index("signal_results_signal_idx").on(t.signalId),
    byCampaign: index("signal_results_campaign_idx").on(t.campaignId),
    byOrg: index("signal_results_organization_idx").on(t.organizationId),
    byPerson: index("signal_results_person_idx").on(t.personId),
    byRanAt: index("signal_results_ran_at_idx").on(t.ranAt),
    byTracking: index("signal_results_tracking_idx").on(
      t.trackingConfigId,
      t.ranAt,
    ),
  }),
);

// ─── Tracking system ───────────────────────────────────────────────────────────

/**
 * Tracking configs: recurring signal execution schedules.
 * Scoped transitively via campaign ownership.
 */
export const trackingConfigs = pgTable(
  "tracking_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "cascade",
    }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    schedule: text("schedule").notNull().default("weekly"),
    intent: text("intent").notNull().default(""),
    status: text("status").notNull().default("active"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    byCampaign: index("tracking_configs_campaign_idx").on(t.campaignId),
    byStatus: index("tracking_configs_status_idx").on(t.status),
    byNextRun: index("tracking_configs_next_run_idx").on(t.nextRunAt),
  }),
);

/**
 * Tracking snapshots: normalized signal output for diffing.
 */
export const trackingSnapshots = pgTable(
  "tracking_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackingConfigId: uuid("tracking_config_id")
      .notNull()
      .references(() => trackingConfigs.id, { onDelete: "cascade" }),
    snapshotData: jsonb("snapshot_data")
      .$type<Record<string, unknown>>()
      .notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byConfig: index("tracking_snapshots_config_idx").on(
      t.trackingConfigId,
      t.capturedAt,
    ),
  }),
);

/**
 * Tracking changes: structured change records for UI display.
 */
export const trackingChanges = pgTable(
  "tracking_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackingConfigId: uuid("tracking_config_id")
      .notNull()
      .references(() => trackingConfigs.id, { onDelete: "cascade" }),
    changeType: text("change_type").notNull(),
    fieldPath: text("field_path"),
    previousValue: jsonb("previous_value"),
    currentValue: jsonb("current_value"),
    description: text("description").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byConfig: index("tracking_changes_config_idx").on(
      t.trackingConfigId,
      t.detectedAt,
    ),
  }),
);

/**
 * Outreach events: append-only log of outreach status transitions.
 */
export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byCampaignDate: index("outreach_events_campaign_date_idx").on(
      t.campaignId,
      t.createdAt,
    ),
    byDateStatus: index("outreach_events_date_status_idx").on(
      t.createdAt,
      t.status,
    ),
  }),
);

// ─── Email system ─────────────────────────────────────────────────────────────

/**
 * Email drafts: composed by the AI before sending.
 */
export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    campaignPeopleId: uuid("campaign_people_id")
      .notNull()
      .references(() => campaignPeople.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text"),
    replyTo: text("reply_to"),
    status: text("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Sequence-related columns (from 20260418000000_sequences.sql)
    sequenceId: uuid("sequence_id").references(() => sequences.id, {
      onDelete: "cascade",
    }),
    sequenceStepId: uuid("sequence_step_id").references(
      () => sequenceSteps.id,
      { onDelete: "cascade" },
    ),
    enrollmentId: uuid("enrollment_id").references(
      () => sequenceEnrollments.id,
      { onDelete: "cascade" },
    ),
    aiReasoning: text("ai_reasoning"),
    reviewStatus: text("review_status").default("pending"),
    ...timestamps,
  },
  (t) => ({
    byCampaignStatus: index("email_drafts_campaign_status_idx").on(
      t.campaignId,
      t.status,
    ),
    byCleanup: index("email_drafts_cleanup_idx").on(t.createdAt, t.status),
    bySequence: index("email_drafts_sequence_idx").on(
      t.sequenceId,
      t.reviewStatus,
    ),
    byUser: index("email_drafts_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

/**
 * Sent emails: maps provider message IDs to campaign_people for status tracking.
 */
export const sentEmails = pgTable(
  "sent_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    agentmailMessageId: text("agentmail_message_id").notNull().unique(),
    agentmailThreadId: text("agentmail_thread_id"),
    draftId: uuid("draft_id").references(() => emailDrafts.id, {
      onDelete: "set null",
    }),
    campaignPeopleId: uuid("campaign_people_id")
      .notNull()
      .references(() => campaignPeople.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    // Delivery-event timestamps, set by the inbound provider webhook
    // (/api/email/track). Nullable — populated as events arrive.
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byCampaign: index("sent_emails_campaign_idx").on(t.campaignId),
    byCampaignPeople: index("sent_emails_campaign_people_idx").on(
      t.campaignPeopleId,
    ),
    byThread: index("sent_emails_thread_idx").on(t.agentmailThreadId),
    byUser: index("sent_emails_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

// ─── Sequences ────────────────────────────────────────────────────────────────

/**
 * Sequences: multi-step outreach plans.
 */
export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    name: text("name").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    triggerSignalId: uuid("trigger_signal_id").references(() => signals.id),
    status: text("status").notNull().default("draft"),
    ...timestamps,
  },
  (t) => ({
    byCampaign: index("sequences_campaign_idx").on(t.campaignId),
    byStatus: index("sequences_status_idx").on(t.status),
    byUser: index("sequences_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

/**
 * Sequence steps: individual steps inside a sequence.
 */
export const sequenceSteps = pgTable(
  "sequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    stepType: text("step_type").notNull().default("email"),
    delayDays: integer("delay_days"),
    delayHours: integer("delay_hours"),
    condition: text("condition").default("no_reply"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueStep: unique("sequence_steps_unique").on(t.sequenceId, t.stepNumber),
  }),
);

/**
 * Sequence enrollments: tracks a person's progress through a sequence.
 */
export const sequenceEnrollments = pgTable(
  "sequence_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    campaignPeopleId: uuid("campaign_people_id")
      .notNull()
      .references(() => campaignPeople.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    currentStep: integer("current_step").notNull().default(1),
    status: text("status").notNull().default("waiting"),
    waitingSince: timestamp("waiting_since", {
      withTimezone: true,
    }).defaultNow(),
    nextSendAt: timestamp("next_send_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    uniquePair: unique("sequence_enrollments_unique").on(
      t.sequenceId,
      t.campaignPeopleId,
    ),
    byStatus: index("enrollments_status_idx").on(t.status),
    byNextSend: index("enrollments_next_send_idx").on(t.nextSendAt),
  }),
);

// ─── Email skills ─────────────────────────────────────────────────────────────

/**
 * Email skills: user-authored rule packs for the email composer.
 * Built-ins have clerkUserId = null.
 */
export const emailSkills = pgTable(
  "email_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id"), // null for built-ins
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    byUser: index("email_skills_user_idx").on(t.clerkUserId),
    byBuiltin: index("email_skills_builtin_idx").on(t.isBuiltin),
    // Unique per user (nulls are equal per SQL standard — use coalesce in app logic)
  }),
);

/**
 * Email skill attachments: polymorphic join (user / profile / campaign scope).
 * scope_id is TEXT to hold both Clerk user IDs and UUID primary keys.
 */
export const emailSkillAttachments = pgTable(
  "email_skill_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => emailSkills.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(), // 'user' | 'profile' | 'campaign'
    scopeId: text("scope_id").notNull(), // Clerk userId OR uuid.toString()
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueAttachment: unique("email_skill_attachments_unique").on(
      t.skillId,
      t.scopeType,
      t.scopeId,
    ),
    byScope: index("email_skill_attachments_scope_idx").on(
      t.scopeType,
      t.scopeId,
    ),
    bySkill: index("email_skill_attachments_skill_idx").on(t.skillId),
  }),
);

// ─── BYOK: user API keys ───────────────────────────────────────────────────────

/**
 * User API keys: encrypted storage of user-supplied API keys (BYOK).
 * One row per (clerkUserId, keyName) pair — upserted on save.
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    keyName: text("key_name").notNull(),
    keyValueEncrypted: text("key_value_encrypted").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keySuffix: text("key_suffix").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueUserKey: unique("user_api_keys_user_key_unique").on(
      t.clerkUserId,
      t.keyName,
    ),
    byUser: index("user_api_keys_clerk_user_id_idx").on(t.clerkUserId),
  }),
);

// ─── ChampIQ queue ────────────────────────────────────────────────────────────

/**
 * Prospects that have cleared the ChampHarbinger handoff threshold and are
 * waiting to be pushed (or have been pushed/discarded) to ChampIQ.
 */
export const champiqQueue = pgTable(
  "champiq_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    companyName: text("company_name").notNull(),
    companyDomain: text("company_domain").notNull(),
    companyData: jsonb("company_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    contacts: jsonb("contacts")
      .$type<Array<Record<string, unknown>>>()
      .default([])
      .notNull(),
    signalId: uuid("signal_id"),
    signalName: text("signal_name"),
    signalReasoning: text("signal_reasoning"),
    signalData: jsonb("signal_data")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    score: real("score"),
    talkingPoints: jsonb("talking_points")
      .$type<string[]>()
      .default([])
      .notNull(),
    status: text("status").notNull().default("pending"),
    ...timestamps,
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
  },
  (t) => ({
    byUser: index("champiq_queue_clerk_user_id_idx").on(t.clerkUserId),
    byStatus: index("champiq_queue_status_idx").on(t.status),
  }),
);
