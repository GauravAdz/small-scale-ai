import { AlertTriangle } from "lucide-react";

import counterpartConfig from "../../counterpart.config";
import { Workspace } from "@/components/layout/workspace";
import { contactFormVisual, featuredProjectsVisual, projectsVisual } from "@/lib/chat/visual-data";
import { loadProfile } from "@/lib/knowledge/loader";
import { profileStructuredData, serializeJsonLd } from "@/lib/seo/structured-data";

export default function Page() {
  try {
    const profile = loadProfile();
    // Resolved on the server so the rail and the contact form are correct on
    // first paint — including whether message delivery is actually configured,
    // which the form has to know before the visitor types anything.
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(profileStructuredData(profile)) }}
        />
        <Workspace
          profile={profile}
          featured={featuredProjectsVisual()}
          projects={projectsVisual()}
          contactForm={contactFormVisual()}
          chatUi={{
            intro: counterpartConfig.chat.intro,
            quickPrompts: counterpartConfig.chat.quickPrompts,
          }}
        />
      </>
    );
  } catch (error) {
    return <SetupError message={error instanceof Error ? error.message : String(error)} />;
  }
}

/**
 * A blank page with a stack trace in the terminal is a bad first-run experience.
 * The two things that actually go wrong on setup — a malformed `profile.json`
 * and a missing index — both land here with the fix spelled out.
 */
function SetupError({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="border-destructive/30 bg-destructive/5 w-full max-w-lg rounded-xl border p-6">
        <div className="text-destructive flex items-center gap-2">
          <AlertTriangle className="size-5" />
          <h1 className="text-base font-semibold">Setup incomplete</h1>
        </div>

        <pre className="bg-card border-border text-foreground/80 mt-4 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-wrap">
          {message}
        </pre>

        <ol className="text-muted-foreground mt-4 flex list-decimal flex-col gap-1.5 pl-4 text-xs">
          <li>
            Copy <code className="text-foreground">.env.example</code> to{" "}
            <code className="text-foreground">.env.local</code> and add your API key.
          </li>
          <li>
            Fill in <code className="text-foreground">data/profile.json</code>.
          </li>
          <li>
            Run <code className="text-foreground">npm run ingest</code> to build the knowledge
            index.
          </li>
        </ol>
      </div>
    </main>
  );
}
