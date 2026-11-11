export function CreditsBadge({ balance }: { balance: number }) {
  return (
    <span title="Credits pay for AI and exports" className="inline-flex items-center gap-1.5 rounded-full bg-coral/10 px-3 py-1 text-sm font-semibold tabular-nums text-coral-ink">
      <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="currentColor"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
      {balance.toLocaleString()} credits
    </span>
  );
}
