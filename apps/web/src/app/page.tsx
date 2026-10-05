import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter.tsx";
import { currentUser } from "@/server/context.ts";

export default async function Home() {
  if (await currentUser()) redirect("/dashboard");
  return (
    <>
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Store screenshots that sell</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        Upload your app screens. Chitrapx designs, writes and translates the full App Store and Google Play set, and you finish it in a real editor.
      </p>
      <Link href="/login" className="btn">Get started free</Link>
    </main>
    <SiteFooter />
    </>
  );
}
