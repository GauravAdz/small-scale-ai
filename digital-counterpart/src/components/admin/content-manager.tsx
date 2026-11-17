"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, FilePlus2, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

import type { ContentEntry, ContentFile, EditorDocument } from "@/lib/admin/github-content";

type Notice = { kind: "success" | "error"; text: string; url?: string };

function label(path: string): string {
  if (path === "data/profile.json") return "Profile";
  return path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ") ?? path;
}

function field(labelText: string, value: string, onChange: (value: string) => void, options?: { multiline?: boolean; hint?: string }) {
  return (
    <label className="block min-w-0 space-y-1.5 text-sm font-medium">
      <span>{labelText}</span>
      {options?.multiline ? (
        <textarea aria-label={labelText} className="admin-input min-h-28 resize-y" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input aria-label={labelText} className="admin-input" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {options?.hint && <span className="block text-xs font-normal text-muted-foreground">{options.hint}</span>}
    </label>
  );
}

function str(value: unknown): string { return typeof value === "string" ? value : ""; }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

export function ContentManager() {
  const [entries, setEntries] = useState<ContentEntry[]>([]);
  const [file, setFile] = useState<ContentFile | null>(null);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [source, setSource] = useState("");
  const [sourceMode, setSourceMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<"project" | "note" | null>(null);
  const [newFilename, setNewFilename] = useState("");
  const dirty = Boolean(file && document && (sourceMode
    ? source !== file.content
    : JSON.stringify(document) !== JSON.stringify(file.document)));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const loadList = useCallback(async () => {
    const list = await request<ContentEntry[]>("/api/admin/content");
    setEntries(list);
    return list;
  }, []);

  const openFile = useCallback(async (path: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await request<ContentFile>(`/api/admin/content?path=${encodeURIComponent(path)}`);
      setFile(next);
      setDocument(next.document);
      setSource(next.content);
      setSourceMode(false);
      setCreating(false);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not open the file." });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    request<ContentEntry[]>("/api/admin/content")
      .then((list) => {
        if (!active) return;
        setEntries(list);
        const first = list.find((entry) => entry.path === "data/profile.json") ?? list[0];
        if (first) void openFile(first.path);
      })
      .catch((error) => {
        if (active) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load content." });
      });
    return () => { active = false; };
  }, [openFile]);

  const updateProfile = (key: string, value: unknown) => setDocument((current) =>
    current?.kind === "profile" ? { ...current, data: { ...current.data, [key]: value } } : current,
  );
  const updateNested = (parent: string, key: string, value: unknown) => setDocument((current) => {
    if (current?.kind !== "profile") return current;
    const previous = current.data[parent];
    const nested = previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Record<string, unknown> : {};
    return { ...current, data: { ...current.data, [parent]: { ...nested, [key]: value } } };
  });
  const updateFrontmatter = (key: string, value: unknown) => setDocument((current) =>
    current?.kind === "markdown"
      ? { ...current, frontmatter: { ...current.frontmatter, [key]: value } }
      : current,
  );

  const startNew = (kind: "project" | "note", filename: string) => {
    if (dirty && !window.confirm("Discard your unpublished changes?")) return;
    const slug = filename.trim().toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setNotice({ kind: "error", text: "Use letters, numbers, and hyphens in the file name." });
      return;
    }
    const path = kind === "project" ? `data/projects/${slug}.md` : `data/notes/${slug}.md`;
    if (entries.some((entry) => entry.path === path)) {
      setNotice({ kind: "error", text: "That file already exists. Open it from the list." });
      return;
    }
    setFile({ path, sha: "", content: "", document: { kind: "markdown", frontmatter: {}, body: "" } });
    setDocument({
      kind: "markdown",
      frontmatter: { title: "", type: kind, slug, weight: 50, summary: "", tags: [], featured: false },
      body: "",
    });
    setSource("");
    setSourceMode(false);
    setCreating(true);
    setNewKind(null);
    setNewFilename("");
    setNotice(null);
  };

  const publish = async () => {
    if (!file || !document || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const payload = {
        action: "save",
        path: file.path,
        ...(file.sha ? { sha: file.sha } : {}),
        ...(sourceMode ? { content: source } : { document }),
      };
      const result = await request<{ commitUrl: string }>("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await Promise.allSettled([loadList(), openFile(file.path)]);
      setNotice({ kind: "success", text: "Published to GitHub. The site will update after deployment finishes.", url: result.commitUrl });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not publish." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!file?.sha || file.path === "data/profile.json" || busy) return;
    if (!window.confirm(`Remove ${label(file.path)} from the portfolio? This publishes a deletion.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await request<{ commitUrl: string }>("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: file.path, sha: file.sha }),
      });
      setFile(null);
      setDocument(null);
      try {
        const list = await loadList();
        const first = list.find((entry) => entry.path === "data/profile.json") ?? list[0];
        if (first) await openFile(first.path);
      } catch {
        // The commit succeeded; the list can be refreshed later.
      }
      setNotice({ kind: "success", text: "Removed from GitHub. The site will update after deployment finishes.", url: result.commitUrl });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not remove the file." });
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    if (!document || !file) return;
    if (sourceMode) {
      try {
        if (document.kind === "profile") setDocument({ kind: "profile", data: JSON.parse(source) as Record<string, unknown> });
        else {
          if (source !== file.content && !window.confirm("Discard your unpublished Markdown changes?")) return;
          setDocument(file.document);
        }
      } catch {
        setNotice({ kind: "error", text: "Fix the JSON before returning to the form." });
        return;
      }
    } else if (document.kind === "profile") {
      setSource(`${JSON.stringify(document.data, null, 2)}\n`);
    } else {
      if (dirty) {
        setNotice({ kind: "error", text: "Publish your form changes before editing the Markdown source." });
        return;
      }
      setSource(file.content);
    }
    setSourceMode(!sourceMode);
    setNotice(null);
  };

  const groups = [
    { title: "Profile", items: entries.filter((item) => item.path === "data/profile.json") },
    { title: "Projects", items: entries.filter((item) => item.path.startsWith("data/projects/")) },
    { title: "Other notes", items: entries.filter((item) => item.path !== "data/profile.json" && !item.path.startsWith("data/projects/")) },
  ];
  const chooseFile = (path: string) => {
    if (path === file?.path) return;
    if (dirty && !window.confirm("Discard your unpublished changes?")) return;
    void openFile(path);
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-card px-4 py-6 lg:min-h-[calc(100dvh-4rem)] lg:border-b-0 lg:border-r lg:px-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Your content</h1>
          <FilePlus2 className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="mt-5 flex gap-2 lg:flex-col">
          <button onClick={() => { setNewKind("project"); setNewFilename(""); }} className="admin-secondary"><Plus className="size-4" /> New project</button>
          <button onClick={() => { setNewKind("note"); setNewFilename(""); }} className="admin-secondary"><Plus className="size-4" /> New note</button>
        </div>
        {newKind && (
          <form className="mt-3 rounded-lg bg-muted p-3" onSubmit={(event) => { event.preventDefault(); startNew(newKind, newFilename); }}>
            <label className="block text-xs font-semibold">File name
              <input autoFocus className="admin-input mt-1.5" value={newFilename} onChange={(event) => setNewFilename(event.target.value)} placeholder={newKind === "project" ? "my-project" : "my-note"} required />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="submit" className="min-h-11 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">Create {newKind}</button>
              <button type="button" onClick={() => setNewKind(null)} className="min-h-11 rounded-md px-3 text-xs font-medium">Cancel</button>
            </div>
          </form>
        )}
        <nav aria-label="Content files" className="mt-7 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h2>
              <div className="space-y-0.5">
                {group.items.map((entry) => (
                  <button key={entry.path} onClick={() => chooseFile(entry.path)} aria-current={file?.path === entry.path ? "page" : undefined}
                    className={`min-h-10 w-full rounded-md px-3 py-2 text-left text-sm capitalize transition-colors hover:bg-muted ${file?.path === entry.path ? "bg-accent font-semibold text-accent-foreground" : "text-foreground"}`}>
                    {label(entry.path)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 px-4 py-6 sm:px-8 sm:py-9" aria-label="Content editor">
        {notice && (
          <div role={notice.kind === "error" ? "alert" : "status"} className={`mb-5 rounded-lg px-4 py-3 text-sm ${notice.kind === "error" ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "bg-accent text-accent-foreground"}`}>
            {notice.text}{notice.url && <a href={notice.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-4">View commit <ArrowUpRight className="size-3.5" /></a>}
          </div>
        )}
        {!file || !document ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">{busy ? <LoaderCircle className="size-5 animate-spin" aria-label="Loading content" /> : "Choose a file to edit."}</div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{creating ? `New file · ${file.path}` : file.path}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight capitalize sm:text-3xl">{label(file.path)}</h2>
                <p className="mt-2 text-sm text-muted-foreground">Changes become public after the next deployment.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={switchMode} className="admin-secondary">{sourceMode ? "Use fields" : document.kind === "profile" ? "Edit JSON" : "Edit Markdown"}</button>
                {file.sha && file.path !== "data/profile.json" && <button onClick={() => void remove()} disabled={busy} className="admin-secondary text-destructive"><Trash2 className="size-4" /> Remove</button>}
              </div>
            </div>

            {sourceMode ? (
              <label className="mt-7 block text-sm font-medium">{document.kind === "profile" ? "Profile JSON" : "Markdown source"}
                <textarea aria-label={document.kind === "profile" ? "Profile JSON" : "Markdown source"} className="admin-input mt-2 min-h-[60vh] font-mono text-xs leading-6" spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} />
              </label>
            ) : document.kind === "profile" ? (
              <div className="admin-form">
                <h3 className="admin-section-title">About you</h3>
                <div className="admin-two-col">
                  {field("Name", str(document.data.name), (v) => updateProfile("name", v))}
                  {field("Title", str(document.data.title), (v) => updateProfile("title", v))}
                  {field("Location", str(document.data.location), (v) => updateProfile("location", v))}
                  {field("Headline", str(document.data.headline), (v) => updateProfile("headline", v))}
                </div>
                {field("Tagline", str(document.data.tagline), (v) => updateProfile("tagline", v))}
                {field("Bio", str(document.data.bio), (v) => updateProfile("bio", v), { multiline: true })}
                <h3 className="admin-section-title">Availability</h3>
                <div className="admin-two-col">
                  {field("Status label", str((document.data.availability as Record<string, unknown> | undefined)?.label), (v) => updateNested("availability", "label", v))}
                  <label className="block space-y-1.5 text-sm font-medium">Status
                    <select className="admin-input" value={str((document.data.availability as Record<string, unknown> | undefined)?.status) || "open"} onChange={(event) => updateNested("availability", "status", event.target.value)}>
                      <option value="open">Open</option><option value="selective">Selective</option><option value="closed">Closed</option>
                    </select>
                  </label>
                </div>
                {field("What you're looking for", ((document.data.availability as Record<string, unknown> | undefined)?.interests as string[] | undefined)?.join("\n") ?? "", (v) => updateNested("availability", "interests", v.split("\n").map((s) => s.trim()).filter(Boolean)), { multiline: true, hint: "One interest per line" })}
                {field("Availability details", str((document.data.availability as Record<string, unknown> | undefined)?.note), (v) => updateNested("availability", "note", v), { multiline: true })}
                <h3 className="admin-section-title">Contact</h3>
                <div className="admin-two-col">
                  {(["email", "linkedin", "github", "website"] as const).map((key) => (
                    <div key={key}>{field(key[0].toUpperCase() + key.slice(1), str((document.data.contact as Record<string, unknown> | undefined)?.[key]), (v) => updateNested("contact", key, v))}</div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">For skills, coursework, links, and other structured fields, use Edit JSON above.</p>
              </div>
            ) : (
              <div className="admin-form">
                <h3 className="admin-section-title">Details</h3>
                <div className="admin-two-col">
                  {field("Title", str(document.frontmatter.title), (v) => updateFrontmatter("title", v))}
                  {field("Slug", str(document.frontmatter.slug), (v) => updateFrontmatter("slug", v), { hint: "Used to match project links and pins" })}
                  <label className="block space-y-1.5 text-sm font-medium">Type
                    <select className="admin-input" value={str(document.frontmatter.type) || "note"} onChange={(event) => updateFrontmatter("type", event.target.value)}>
                      {["project", "experience", "education", "philosophy", "faq", "note"].map((type) => <option value={type} key={type}>{type}</option>)}
                    </select>
                  </label>
                  {field("Year", String(document.frontmatter.year ?? ""), (v) => updateFrontmatter("year", v ? Number(v) : undefined))}
                  {field("Status", str(document.frontmatter.status), (v) => updateFrontmatter("status", v))}
                  {field("Role", str(document.frontmatter.role), (v) => updateFrontmatter("role", v))}
                </div>
                {field("Short summary", str(document.frontmatter.summary), (v) => updateFrontmatter("summary", v), { multiline: true })}
                {field("Tags", Array.isArray(document.frontmatter.tags) ? document.frontmatter.tags.join(", ") : "", (v) => updateFrontmatter("tags", v.split(",").map((s) => s.trim()).filter(Boolean)), { hint: "Separate tags with commas" })}
                <div className="admin-two-col">
                  {field("Live URL", str(document.frontmatter.url), (v) => updateFrontmatter("url", v))}
                  {field("Repository URL", str(document.frontmatter.repo), (v) => updateFrontmatter("repo", v))}
                </div>
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                  <input type="checkbox" checked={document.frontmatter.featured === true} onChange={(event) => updateFrontmatter("featured", event.target.checked)} className="size-4 accent-primary" /> Featured project
                </label>
                <h3 className="admin-section-title">The full story</h3>
                {field("Body", document.body, (v) => setDocument({ ...document, body: v }), { multiline: true, hint: "Markdown is supported. Include concrete work and results that the chat can cite." })}
              </div>
            )}

            <div className="mt-8 flex items-center justify-end border-t border-border pt-6">
              <button onClick={() => void publish()} disabled={busy || (!creating && !dirty)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55">
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {busy ? "Publishing…" : "Publish change"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
