export function CreditsBadge({ balance }: { balance: number }) {
  return (
    <span title="Credits pay for AI and exports" className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
      {balance.toLocaleString()} credits
    </span>
  );
}
