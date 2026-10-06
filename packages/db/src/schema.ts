import { sql } from "drizzle-orm";
import type { AppBriefFields, BrandToken } from "@chitrapx/document";
import {
  bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn,
} from "drizzle-orm/pg-core";
// Supabase-owned auth.users, referenced for FKs only; drizzle-kit skips it with entities.roles.provider = supabase.
import { authUsers } from "drizzle-orm/supabase";

export const planEnum = pgEnum("plan", ["free", "pro", "studio"]);
/** SP15: ranked viewer < editor < admin < owner; permissions live in apps/web/src/server/authz.ts. */
export const MEMBER_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const roleEnum = pgEnum("member_role", MEMBER_ROLES);
export const platformEnum = pgEnum("platform_hint", ["ios", "android", "both"]);
export const projectKindEnum = pgEnum("project_kind", ["screenshots", "video", "social"]);
export const assetKindEnum = pgEnum("asset_kind", ["screenshot", "recording", "image", "font", "export", "thumbnail", "reference"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);
export const ledgerReasonEnum = pgEnum("ledger_reason", ["plan_grant", "purchase", "reserve", "settle", "refund", "adjust"]);
export const paymentStatusEnum = pgEnum("payment_status", ["created", "paid", "failed"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["created", "active", "cancelling", "ended"]);
export const templateSourceEnum = pgEnum("template_source", ["osg", "ass", "pixeldeck", "chitrapx"]);
/** SP16: published (visible to all), hidden (reported or held: author and staff only), removed (staff: nobody). */
export const communityStatusEnum = pgEnum("community_status", ["published", "hidden", "removed"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const workspaceRef = () => uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

/** An uploaded font face (assets.kind = 'font', appId null: owned by the workspace). */
export type FontMeta = { family: string; weight: number; italic: boolean; format: "ttf" | "otf" | "woff" | "woff2" };

/**
 * Recordings: { ready, webm, poster, duration, width, height } once processed, or { ready: false, error }.
 * Fonts: FontMeta.
 */
export type AssetMeta = {
  ready?: boolean;
  webm?: string;
  poster?: string;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
} & Partial<FontMeta>;

export type Brand = {
  primaryColor?: string;
  secondaryColor?: string;
  headingFont?: string;
  bodyFont?: string;
  logoAssetId?: string;
  /** SP10: up to six token colours; primaryColor/secondaryColor seed it until saved. */
  palette?: Array<{ token: BrandToken; color: string }>;
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
  role: roleEnum("role").notNull().default("viewer"),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index("memberships_user_idx").on(t.userId),
  // SP15: exactly one owner per workspace; ownership moves only by transfer.
  uniqueIndex("memberships_one_owner").on(t.workspaceId).where(sql`role = 'owner'`),
]);

export const apps = pgTable("apps", {
  id: id(),
  workspaceId: workspaceRef(),
  name: text("name").notNull(),
  platformHint: platformEnum("platform_hint").notNull().default("both"),
  description: text("description").notNull().default(""),
  brand: jsonb("brand").$type<Brand>().notNull().default({}),
  /** SP11: one brief per app, reused by AI design, copy variants and chips. */
  brief: jsonb("brief").$type<AppBriefFields>().notNull().default({}),
  /** SP11: terms AI translation keeps exactly as written (the app name is always kept too). */
  glossary: text("glossary").array().notNull().default(sql`'{}'::text[]`),
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
  kind: text("kind").$type<"auto" | "export" | "restore" | "named">().notNull().default("auto"),
  createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("project_versions_project_idx").on(t.projectId), index("project_versions_project_created_idx").on(t.projectId, t.createdAt.desc())]);

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

/**
 * SP11: one analysis per competitor reference image. Keyed by the asset, so deleting the image (or its app) deletes
 * the analysis, and nothing is shared across apps or workspaces.
 */
export const referenceInsights = pgTable("reference_insights", {
  id: id(),
  workspaceId: workspaceRef(),
  assetId: uuid("asset_id").notNull().unique().references(() => assets.id, { onDelete: "cascade" }),
  insight: jsonb("insight").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

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

/** SP16: one image a community post carries, copied to `community/<postId>/<sha256>` at publish time. */
export type CommunityAsset = { id: string; sha256: string; mime: string; kind: "screenshot" | "image"; width: number | null; height: number | null; bytes: number };

/**
 * SP16: a project snapshot shared to the community feed. `doc` is a copy taken at publish time with
 * workspace-private data removed; `assets` lists the images it references by their original asset ids.
 */
export const communityPosts = pgTable("community_posts", {
  id: id(),
  authorId: uuid("author_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  workspaceId: workspaceRef(),
  sourceProjectId: uuid("source_project_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  platforms: text("platforms").array().notNull().default(sql`'{}'::text[]`),
  kind: projectKindEnum("kind").notNull(),
  doc: jsonb("doc").notNull(),
  assets: jsonb("assets").$type<CommunityAsset[]>().notNull().default([]),
  status: communityStatusEnum("status").notNull().default("published"),
  importCount: integer("import_count").notNull().default(0),
  /** When the author confirmed they own or may share everything in the post. */
  licenseAcceptedAt: timestamp("license_accepted_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("community_posts_feed_idx").on(t.status, t.createdAt.desc()),
  index("community_posts_author_idx").on(t.authorId, t.createdAt),
]);

/** SP16: one report per user per post; enough of them hide the post for staff review. */
export const communityReports = pgTable("community_reports", {
  id: id(),
  postId: uuid("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  reporterId: uuid("reporter_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
}, (t) => [unique("community_reports_post_reporter_uq").on(t.postId, t.reporterId), index("community_reports_reporter_idx").on(t.reporterId, t.createdAt)]);

/** SP16: who imported which post; the primary key makes the import counter count each user once. */
export const communityImports = pgTable("community_imports", {
  postId: uuid("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] })]);

/** SP16: audit log of staff moderation (restore, remove). Kept when the post goes. */
export const communityActions = pgTable("community_actions", {
  id: id(),
  postId: uuid("post_id"),
  staffId: uuid("staff_id").references(() => authUsers.id, { onDelete: "set null" }),
  action: text("action").$type<"restore" | "remove">().notNull(),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("community_actions_post_idx").on(t.postId)]);

/**
 * SP16: first-party, consent-gated usage counts. Deliberately anonymous: no user, session, IP,
 * user agent or referrer; `path` has ids replaced and `props` holds only allow-listed values.
 */
export const analyticsEvents = pgTable("analytics_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().default(""),
  props: jsonb("props").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("analytics_events_name_created_idx").on(t.name, t.createdAt)]);

/**
 * SP15: an invite link. Only the SHA-256 of the token is stored; the link is shown once to the inviter.
 * Bound to `email`; single use (`accepted_at`); pending ones count toward the plan's seats.
 */
export const workspaceInvites = pgTable("workspace_invites", {
  id: id(),
  workspaceId: workspaceRef(),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => authUsers.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("workspace_invites_workspace_idx").on(t.workspaceId)]);

/** SP15: a read-only public link to a project. One active (not revoked) link per project. */
export const projectShares = pgTable("project_shares", {
  id: id(),
  workspaceId: workspaceRef(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  allowDuplicate: boolean("allow_duplicate").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("project_shares_active_uq").on(t.projectId).where(sql`revoked_at is null`)]);

/**
 * SP15: a comment on a board (optionally an element and a point, in percent of the board). Replies set
 * `parent_id` to the thread root. Not part of the document: never exported, rendered, shared or duplicated.
 */
export const projectComments = pgTable("project_comments", {
  id: id(),
  workspaceId: workspaceRef(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boardId: text("board_id").notNull(),
  elementId: text("element_id"),
  parentId: uuid("parent_id").references((): AnyPgColumn => projectComments.id, { onDelete: "cascade" }),
  xPct: real("x_pct"),
  yPct: real("y_pct"),
  body: text("body").notNull(),
  authorId: uuid("author_id").references(() => authUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => authUsers.id, { onDelete: "set null" }),
}, (t) => [index("project_comments_project_board_idx").on(t.projectId, t.boardId), index("project_comments_parent_idx").on(t.parentId)]);

/** SP15: in-app notifications (no email): a reply in your thread or an @mention. */
export const notifications = pgTable("notifications", {
  id: id(),
  workspaceId: workspaceRef(),
  userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => authUsers.id, { onDelete: "set null" }),
  kind: text("kind").$type<"mention" | "reply">().notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  commentId: uuid("comment_id").notNull().references(() => projectComments.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt.desc())]);
