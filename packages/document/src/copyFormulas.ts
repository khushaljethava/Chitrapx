// Formulas and category banks from app-store-screenshots (MIT), skills/app-store-screenshots/copy-ideas.md.
// Placeholders like [verb] stay visible after insertion; readiness flags any left at export.
export type FormulaRole = "hero" | "differentiator" | "feature" | "proof" | "closer";
export type Formula = { id: string; role: FormulaRole; template: string; example: string };
export type CategoryBank = { id: string; name: string; lines: Array<{ id: string; text: string }> };

export const FORMULA_ROLES: ReadonlyArray<{ id: FormulaRole; name: string }> = [
  { id: "hero", name: "Hero" }, { id: "differentiator", name: "Differentiator" }, { id: "feature", name: "Feature" },
  { id: "proof", name: "Proof" }, { id: "closer", name: "Closer" },
];

const f = (role: FormulaRole, id: string, template: string, example: string): Formula => ({ id: `${role}.${id}`, role, template, example });
export const FORMULAS: Formula[] = [
  f("hero", "outcome-without-pain", "[outcome], without [pain].", "Great coffee, without the guesswork."),
  f("hero", "adjective-way", "The [adjective] way to [verb] [noun].", "The calm way to plan your week."),
  f("hero", "your-noun-benefit", "Your [noun],\n[benefit].", "Your money,\nfinally clear."),
  f("hero", "verb-noun-twice", "[verb] [noun].\n[verb] [noun].", "Track habits.\nKeep streaks."),
  f("hero", "every-noun", "Every [noun],\n[outcome].", "Every workout,\ncounted."),
  f("hero", "noun-that-verbs", "[noun] that [verb]s you.", "A journal that listens back."),
  f("hero", "meet-your-role", "Meet your new [role].", "Meet your new sleep coach."),
  f("differentiator", "only-app", "Only [app] [does unique thing].", "Only Bloom knows when beans peak."),
  f("differentiator", "others-vs-app", "[Competitor category] [does X].\n[app] [does Y].", "Timers count down.\nBloom coaches each pour."),
  f("differentiator", "no-no-just", "No [pain]. No [pain]. Just [outcome].", "No ads. No streak guilt. Just progress."),
  f("differentiator", "built-for", "Built for [specific person].", "Built for people who read slowly."),
  f("differentiator", "once-forever", "[verb] it once.\n[outcome] forever.", "Scan it once.\nTracked forever."),
  f("feature", "in-time", "[verb] [noun] in [time/number].", "Log a meal in 3 seconds."),
  f("feature", "at-a-glance", "See [thing] at a glance.", "See your whole month at a glance."),
  f("feature", "sorted", "[noun], sorted.", "Your shelf, sorted by freshness."),
  f("feature", "never-again", "Never [pain] again.", "Never miss a refill again."),
  f("feature", "from-to", "From [before] to [after].", "From receipt to budget in one tap."),
  f("feature", "app-does-rest", "[verb] it. [app] does the rest.", "Snap the bag. Bloom does the rest."),
  f("feature", "on-your-surface", "Right on your [surface].", "Right on your lock screen."),
  f("proof", "people-use", "[number] [people] [verb] [app].", "40,000 runners train with Stride."),
  f("proof", "loved-by", "Loved by [specific group].", "Loved by home baristas."),
  f("proof", "rating", "[rating] from [number] reviews.", "4.9 stars from 12,000 reviews."),
  f("proof", "private", "Private by design.", "Private by design. Your data stays on device."),
  f("proof", "as-seen-in", "As seen in [publication].", "Use only for a real, permitted press mention."),
  f("closer", "wordlist", "[feature] · [feature] · [feature] · [feature]", "Widgets · Journal · Recipes · Caffeine · Scanner"),
  f("closer", "quiet-statement", "And it's all [yours].", "And it's all yours."),
  f("closer", "invitation", "Your first [period] starts today.", "Your first week starts today."),
  f("closer", "so-much-more", "[feature] · [feature] · [feature] · and so much more", "Dark mode · iCloud sync · Siri · Shortcuts"),
  f("closer", "identity", "Made for people who [value].", "Made for people who care about the details."),
];

const bank = (id: string, name: string, lines: string[]): CategoryBank => ({ id: `bank.${id}`, name, lines: lines.map((text, i) => ({ id: `bank.${id}.${i + 1}`, text })) });
export const CATEGORY_BANKS: CategoryBank[] = [
  bank("productivity", "Productivity & tasks", ["Your whole day,\nin one list.", "Turn notes into\nnext steps.", "Plan less.\nDo more.", "Inbox zero,\nfinally.", "Talk it out.\nWe'll write it down."]),
  bank("notes", "Notes & writing", ["Write first.\nOrganize later.", "Every idea,\nfound in seconds.", "A quiet place\nto think.", "Your second brain,\nwithout the setup."]),
  bank("finance", "Finance & budgeting", ["Your money,\nfinally clear.", "Know where\nevery dollar goes.", "Split bills.\nKeep friends.", "Save without\nthinking about it.", "Budgets that\nbend, not break."]),
  bank("fitness", "Fitness & running", ["Every rep,\ncounted.", "Train smarter,\nnot longer.", "Beat last week.", "Your pace.\nYour plan.", "Recover like\nyou mean it."]),
  bank("health", "Health, sleep & wellness", ["Sleep deeper\ntonight.", "Two minutes\nto calm.", "Feel it before\nyou burn out.", "Slow mornings,\nmade simple.", "Understand your\ncycle, gently."]),
  bank("food", "Food, recipes & drink", ["Dinner, decided.", "Cook what's\nalready in the fridge.", "Every recipe,\none tap away.", "Great coffee,\nwithout the guesswork.", "Taste more.\nWaste less."]),
  bank("social", "Social, friends & events", ["Plans your friends\nactually show up to.", "See what your\nfriends are up to.", "The group chat,\nbut for real life.", "Your people,\nin one place."]),
  bank("dating", "Dating & relationships", ["Fewer swipes.\nBetter dates.", "Meet people\nworth your time.", "Stay close,\nfrom anywhere.", "Your little world,\ntogether."]),
  bank("learning", "Learning & education", ["Five minutes\na day is enough.", "Learn it.\nKeep it.", "Speak from\nday one.", "Study smarter\nfor finals."]),
  bank("photo", "Photo, video & creative", ["Edits that\nlook expensive.", "Your best shot,\nin one tap.", "Make it yours.", "Pro tools,\nno learning curve."]),
  bank("travel", "Travel & maps", ["Every trip,\nplanned in minutes.", "Your itinerary,\noffline.", "Find the places\nlocals love.", "Pack once.\nNever forget."]),
  bank("developer", "Developer & pro tools", ["Ship faster\nfrom your phone.", "Every log,\nsearchable.", "Your servers,\nin your pocket.", "Alerts that\nactually matter."]),
  bank("kids", "Kids & family", ["Screen time\nthat teaches.", "The family calendar\neveryone uses.", "Chores, turned\ninto a game.", "Bedtime,\nwithout the battle."]),
];

/** First board = hero, last = closer, the rest = feature. */
export const defaultRole = (boardIndex: number, boardCount: number): FormulaRole =>
  boardIndex === 0 ? "hero" : boardIndex === boardCount - 1 ? "closer" : "feature";

/** A formula placeholder such as [verb] or [Competitor category]. */
export const PLACEHOLDER = /\[[^\]\n]{1,40}\]/;
export const hasPlaceholder = (text: string) => PLACEHOLDER.test(text);
