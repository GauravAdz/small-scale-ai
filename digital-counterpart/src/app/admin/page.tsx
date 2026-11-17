import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Github, LockKeyhole } from "lucide-react";

import { adminConfigured, isAdmin, signIn, signOut } from "@/auth";
import { ContentManager } from "@/components/admin/content-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Content editor",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const configured = adminConfigured();
  const authorized = configured && await isAdmin();

  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Portfolio
          </Link>
          <span className="text-sm font-semibold">Content editor</span>
          {authorized ? (
            <form action={async () => { "use server"; await signOut({ redirectTo: "/admin" }); }}>
              <button className="min-h-11 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Sign out</button>
            </form>
          ) : <span className="w-16" />}
        </div>
      </header>

      {!configured ? (
        <div className="mx-auto max-w-xl px-5 py-20 sm:py-28">
          <LockKeyhole className="mb-7 size-8 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Editor setup needed</h1>
          <p className="mt-4 leading-7 text-muted-foreground">
            Add the admin sign-in and GitHub publishing variables to your deployment, then redeploy.
            The setup steps are in the project README.
          </p>
        </div>
      ) : !authorized ? (
        <div className="mx-auto max-w-xl px-5 py-20 sm:py-28">
          <LockKeyhole className="mb-7 size-8 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">Edit your portfolio</h1>
          <p className="mt-4 leading-7 text-muted-foreground">
            Sign in with the GitHub account allowed to publish portfolio updates.
          </p>
          <form action={async () => { "use server"; await signIn("github", { redirectTo: "/admin" }); }} className="mt-8">
            <button className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              <Github className="size-4" /> Continue with GitHub
            </button>
          </form>
        </div>
      ) : <ContentManager />}
    </main>
  );
}
