import { sql } from "drizzle-orm";
import {
  index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid,
} from "drizzle-orm/pg-core";
// Supabase-owned auth.users, referenced for FKs only; drizzle-kit skips it with entities.roles.provider = supabase.
import { authUsers } from "drizzle-orm/supabase";

export const planEnum = pgEnum("plan", ["free", "pro", "studio"]);
export const roleEnum = pgEnum("member_role", ["owner", "member"]);
export const platformEnum = pgEnum("platform_hint", ["ios", "android", "both"]);
export const projectKindEnum = pgEnum("project_kind", ["screenshots", "video", "social"]);
export const assetKindEnum = pgEnum("asset_kind", ["screenshot", "recording", "image", "font", "export", "thumbnail"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);
export const ledgerReasonEnum = pgEnum("ledger_reason", ["plan_grant", "purchase", "reserve", "settle", "refund", "adjust"]);
export const paymentStatusEnum = pgEnum("payment_status", ["created", "paid", "failed"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["created", "active", "cancelling", "ended"]);
export const templateSourceEnum = pgEnum("template_source", ["osg", "ass", "pixeldeck", "chitrapx"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const workspaceRef = () => uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

export type AssetMeta = {
  ready: boolean;
  webm?: string;
  poster?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
};

export type Brand = {
  primaryColor?: string;
  secondaryColor?: string;
  headingFont?: string;
  bodyFont?: string;
  logoAssetId?: string;
};

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  razorpayCustomerId: text("razorpay_customer_id"),
  createdAt: createdAt(),
});

export const memberships = pgTable("memberships", {
  workspaceId: workspaceRef(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("owner"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)]);

export const apps = pgTable("apps", {
  id: id(),
  workspaceId: workspaceRef(),
  name: text("name").notNull(),
  platformHint: platformEnum("platform_hint").notNull().default("both"),
  description: text("description").notNull().default(""),
  brand: jsonb("brand").$type<Brand>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("apps_workspace_idx").on(t.workspaceId)]);

export const projects = pgTable("projects", {
  id: id(),
  workspaceId: workspaceRef(),
  appId: uuid("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: projectKindEnum("kind").notNull(),
  doc: jsonb("doc").notNull(),
  docSchemaVersion: integer("doc_schema_version").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  thumbnailAssetId: uuid("thumbnail_asset_id"),
  updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("projects_app_idx").on(t.appId), index("projects_workspace_idx").on(t.workspaceId)]);

export const projectVersions = pgTable("project_versions", {
  id: id(),
  workspaceId: workspaceRef(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  doc: jsonb("doc").notNull(),
  label: text("label"),
  createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("project_versions_project_idx").on(t.projectId)]);

export const assets = pgTable("assets", {
  id: id(),
  workspaceId: workspaceRef(),
  appId: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
  kind: assetKindEnum("kind").notNull(),
  storagePath: text("storage_path").notNull(),
  mime: text("mime").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  /** Recordings: { ready, webm, poster, duration, width, height } once processed, or { ready: false, error }. */
  meta: jsonb("meta").$type<AssetMeta>(),
  createdAt: createdAt(),
}, (t) => [unique("assets_ws_app_sha_uq").on(t.workspaceId, t.appId, t.sha256).nullsNotDistinct()]);

export const jobs = pgTable("jobs", {
  id: id(),
  workspaceId: workspaceRef(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  status: jobStatusEnum("status").notNull().default("queued"),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output"),
  error: text("error"),
  creditsReserved: integer("credits_reserved").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("jobs_workspace_created_idx").on(t.workspaceId, t.createdAt)]);

export const creditLedger = pgTable("credit_ledger", {
  id: id(),
  workspaceId: workspaceRef(),
  delta: integer("delta").notNull(),
  reason: ledgerReasonEnum("reason").notNull(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [
  index("credit_ledger_workspace_idx").on(t.workspaceId),
  // A redelivered job can never settle or refund twice; null job_id rows are unaffected.
  unique("credit_ledger_job_reason_uq").on(t.jobId, t.reason),
]);

/** One analysis per screenshot per workspace (by content hash), reused by every AI design. */
export const screenInsights = pgTable("screen_insights", {
  id: id(),
  workspaceId: workspaceRef(),
  sha256: text("sha256").notNull(),
  insight: jsonb("insight").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
}, (t) => [unique("screen_insights_ws_sha_uq").on(t.workspaceId, t.sha256)]);

/** One row per Razorpay order for a credit pack; amount and credits are ours, never the client's. */
export const payments = pgTable("payments", {
  id: id(),
  workspaceId: workspaceRef(),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  pack: text("pack").notNull(),
  credits: integer("credits").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: paymentStatusEnum("status").notNull().default("created"),
  createdAt: createdAt(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [index("payments_workspace_idx").on(t.workspaceId, t.createdAt)]);

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  workspaceId: workspaceRef(),
  razorpaySubscriptionId: text("razorpay_subscription_id").notNull().unique(),
  plan: planEnum("plan").notNull(),
  status: subscriptionStatusEnum("status").notNull().default("created"),
  currentEnd: timestamp("current_end", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("subscriptions_workspace_idx").on(t.workspaceId)]);

/** Webhook deliveries already handled (Razorpay retries and may deliver twice). */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
});

export const templates = pgTable("templates", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  platforms: text("platforms").array().notNull().default(sql`'{}'::text[]`),
  kind: projectKindEnum("kind").notNull(),
  doc: jsonb("doc").notNull(),
  previewPath: text("preview_path"),
  source: templateSourceEnum("source").notNull(),
  licenseNote: text("license_note").notNull().default(""),
  createdAt: createdAt(),
});
