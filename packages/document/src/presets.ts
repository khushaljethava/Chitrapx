// SP11 quick-start presets. Copy written for Chitrapx; each preset points at an SP10 headline bank
// (app-store-screenshots, MIT, see NOTICES.md) whose lines show the model the register, never the words.
import type { BrandToken } from "./brand.ts";
import type { BriefTone } from "./brief.ts";

export type Preset = {
  key: string;
  label: string;
  description: string;
  audience: string;
  tone: BriefTone;
  /** Seeds an empty brief. */
  aiBrief: string;
  /** How copy for this vertical should sound; goes into the pick and copy prompts. */
  voice: string;
  /** Suggested to the AI when the app has no brand colours; never written to the brand. */
  palette: Record<BrandToken, string>;
  /** Example feature chips, shown to the chips writer as style. */
  chips: readonly string[];
  bankId?: string;
};

export const PRESETS = [
  {
    key: "saas", label: "SaaS / Productivity", description: "Work tools, notes, tasks and team apps.",
    audience: "Professionals and small teams who want to get more done with less busywork", tone: "professional",
    aiBrief: "Focus on time saved and clarity. Lead with the single biggest outcome, then show how tasks, notes and reminders fit together. Keep claims concrete; no buzzwords.",
    voice: "Sound capable and calm: concrete time saved, no buzzwords.",
    palette: { primary: "#2563EB", secondary: "#0F172A", accent: "#22C55E", surface: "#F8FAFC", text: "#0F172A", muted: "#64748B" },
    chips: ["Smart lists", "Reminders", "Team sharing", "Offline mode", "Calendar sync"], bankId: "bank.productivity",
  },
  {
    key: "game", label: "Game / Entertainment", description: "Games, streaming and fun.",
    audience: "Players looking for a quick, satisfying session or a world to sink into", tone: "playful",
    aiBrief: "Sell the feeling of playing: the core loop, the moment of winning, the characters. Short, energetic lines. Mention modes and rewards the screenshots show; never invent rankings or awards.",
    voice: "Sound energetic and vivid: verbs, moments and rewards, short lines.",
    palette: { primary: "#7C3AED", secondary: "#111827", accent: "#F59E0B", surface: "#1E1B4B", text: "#FFFFFF", muted: "#C4B5FD" },
    chips: ["Daily quests", "Co-op play", "New levels", "Leaderboards", "No ads"],
  },
  {
    key: "finance", label: "Finance / Fintech", description: "Budgets, banking, payments and investing.",
    audience: "People who want to understand and control their money without spreadsheets", tone: "calm",
    aiBrief: "Lead with clarity and control. Show budgets, spending insights and security plainly. Trust matters more than excitement: no promises of returns, no hype.",
    voice: "Sound trustworthy and plain: clarity and control, no promises of returns.",
    palette: { primary: "#0F766E", secondary: "#0B1F33", accent: "#F5B700", surface: "#F2F7F6", text: "#0B1F33", muted: "#5B7083" },
    chips: ["Smart budgets", "Bill alerts", "Bank security", "Insights", "Shared wallets"], bankId: "bank.finance",
  },
  {
    key: "health", label: "Health / Wellness", description: "Sleep, fitness, mindfulness and habits.",
    audience: "People building calmer, healthier daily routines", tone: "calm",
    aiBrief: "Speak gently and specifically: sleep, movement, mindfulness, habits. Show progress without guilt. Avoid medical claims and before-and-after promises.",
    voice: "Sound warm and gentle: small daily wins, no medical claims.",
    palette: { primary: "#10B981", secondary: "#064E3B", accent: "#F472B6", surface: "#F0FDF7", text: "#064E3B", muted: "#6B8F80" },
    chips: ["Sleep tracking", "Guided breathing", "Daily streaks", "Gentle nudges", "Health sync"], bankId: "bank.health",
  },
  {
    key: "education", label: "Education", description: "Courses, languages and study tools.",
    audience: "Learners who have a few minutes a day and want real progress", tone: "friendly",
    aiBrief: "Show how little time it takes and what the learner can do afterwards. Lessons, practice and streaks. Encouraging, never childish unless the app is for kids.",
    voice: "Sound encouraging and clear: progress in minutes a day.",
    palette: { primary: "#F97316", secondary: "#1E3A8A", accent: "#FACC15", surface: "#FFF7ED", text: "#1E293B", muted: "#64748B" },
    chips: ["Short lessons", "Quizzes", "Daily streaks", "Offline study", "Progress stats"], bankId: "bank.learning",
  },
  {
    key: "travel", label: "Travel", description: "Trips, maps, bookings and guides.",
    audience: "Travellers planning trips and finding their way on the go", tone: "friendly",
    aiBrief: "Lead with the trip, not the app: places, plans, maps that work offline. Evoke the destination while staying practical about bookings and itineraries.",
    voice: "Sound inviting and practical: the destination first, then the plan.",
    palette: { primary: "#0EA5E9", secondary: "#0C4A6E", accent: "#F97316", surface: "#F0F9FF", text: "#0C4A6E", muted: "#5E7C91" },
    chips: ["Offline maps", "Trip planner", "Local picks", "Price alerts", "Shared plans"], bankId: "bank.travel",
  },
  {
    key: "social", label: "Social", description: "Chat, communities, events and dating.",
    audience: "People who want to stay close to friends and find their community", tone: "friendly",
    aiBrief: "Lead with people and moments, not features. Show chat, groups and events as ways to connect. Warm and inclusive; avoid follower-count bragging.",
    voice: "Sound warm and inclusive: people and moments, not metrics.",
    palette: { primary: "#EC4899", secondary: "#4C1D95", accent: "#22D3EE", surface: "#FDF2F8", text: "#2E1065", muted: "#8B6B9E" },
    chips: ["Group chats", "Events", "Stories", "Private circles", "Voice notes"], bankId: "bank.social",
  },
  {
    key: "ecommerce", label: "E-commerce", description: "Shops, marketplaces and delivery.",
    audience: "Shoppers who want to find the right thing fast and check out without friction", tone: "bold",
    aiBrief: "Lead with the products and the ease of buying: discovery, fast checkout, tracking, returns. Concrete offers only if the screenshots show them; no fake discounts.",
    voice: "Sound confident and direct: find it fast, buy it easily, no fake urgency.",
    palette: { primary: "#E11D48", secondary: "#111827", accent: "#FBBF24", surface: "#FFF1F2", text: "#111827", muted: "#6B7280" },
    chips: ["Fast checkout", "Order tracking", "Easy returns", "Wishlists", "Daily deals"],
  },
  {
    key: "utilities", label: "Utilities", description: "Tools, widgets, scanners and settings.",
    audience: "People who want one tool that does its job quickly and reliably", tone: "professional",
    aiBrief: "Lead with the job the tool does and how fast it does it. Show widgets, shortcuts and privacy. Plain, confident, no fluff.",
    voice: "Sound precise and quick: the job done in a tap, privacy plainly stated.",
    palette: { primary: "#475569", secondary: "#0F172A", accent: "#38BDF8", surface: "#F1F5F9", text: "#0F172A", muted: "#64748B" },
    chips: ["Home widgets", "One-tap actions", "Privacy first", "Dark mode", "No sign-up"], bankId: "bank.developer",
  },
] as const satisfies readonly Preset[];

export type PresetKey = (typeof PRESETS)[number]["key"];
export const PRESET_KEYS = PRESETS.map((p) => p.key) as [PresetKey, ...PresetKey[]];
export const presetFor = (key: string | undefined): Preset | undefined => PRESETS.find((p) => p.key === key);

/**
 * What picking a preset does to the brief form: empty fields take the preset's values, filled ones are kept.
 * A written brief is replaced only when `replaceText` is set (the user confirmed).
 */
export function applyPreset<T extends { text: string; audience: string; tone: string }>(form: T, key: PresetKey, replaceText = false): T & { preset: PresetKey } {
  const p = presetFor(key)!;
  return {
    ...form,
    text: !form.text.trim() || replaceText ? p.aiBrief : form.text,
    audience: form.audience.trim() ? form.audience : p.audience,
    tone: form.tone || p.tone,
    preset: key,
  };
}
