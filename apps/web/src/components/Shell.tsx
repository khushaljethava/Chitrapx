"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, Logo, Menu } from "./ui.tsx";

const TABS = [["/dashboard", "Apps"], ["/dashboard/billing", "Billing & plans"], ["/dashboard/team", "Team"], ["/dashboard/community", "Community"]] as const;

/** The logged-in section tabs; the current one gets the violet underline. */
export function NavTabs() {
  const path = usePathname();
  const current = (href: string) => href === "/dashboard" ? path === href || /^\/dashboard\/(apps|projects)\b/.test(path) : path.startsWith(href);
  return (
    <nav aria-label="Sections" className="flex h-full min-w-0 items-stretch gap-6 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
      {TABS.map(([href, label]) => <Link key={href} href={href} className="tab" aria-current={current(href) ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}

/** Avatar button with the account links and sign out. */
export function AccountMenu() {
  return (
    <Menu label="Account" align="right" buttonClassName="inline-flex items-center gap-1 rounded-full p-0.5 transition hover:bg-ink/5"
      button={<><span className="grid size-8 place-items-center rounded-full bg-primary-tint text-on-primary-tint"><Icon name="user" className="size-4" /></span><Icon name="chevronDown" className="size-4 text-muted" /></>}>
      {() => (
        <>
          <Link role="menuitem" href="/dashboard/billing" className="menu-item">Plan and credits</Link>
          <Link role="menuitem" href="/dashboard/team" className="menu-item">Team</Link>
          <Link role="menuitem" href="/changelog" className="menu-item">What&apos;s new</Link>
          <div className="my-1 border-t border-line" />
          <form action="/auth/signout" method="post"><button role="menuitem" className="menu-item text-red-600">Sign out</button></form>
        </>
      )}
    </Menu>
  );
}

/** Sticky 64px bar for signed-out pages. `children` replaces the default sign-in actions. */
export function PublicHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {children ?? (
          <>
            <div className="flex items-center gap-8">
              <Logo />
              <Link href="/changelog" className="hidden text-sm text-muted transition hover:text-ink sm:inline">Changelog</Link>
            </div>
            <nav className="flex items-center gap-2">
              <Link href="/login" className="btn-text">Sign in</Link>
              <Link href="/login" className="btn">Get started free</Link>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}

/** The dark conversion band that closes every public page. */
export function CtaBand({ title = "Create store screenshots like these in minutes", body = "Upload your app screens. Chitrapx designs, writes and translates the full App Store and Google Play set." }: { title?: string; body?: string }) {
  return (
    <section className="bg-night px-4 py-20 text-center text-white">
      <h2 className="mx-auto max-w-2xl text-3xl font-extrabold sm:text-4xl">{title}</h2>
      <p className="mx-auto mt-4 max-w-xl text-white/65">{body}</p>
      <Link href="/login" className="btn mt-8 px-6 py-3 text-base">Get started free</Link>
    </section>
  );
}
