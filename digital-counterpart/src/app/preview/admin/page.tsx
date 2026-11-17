import { notFound } from "next/navigation";

import { ContentManager } from "@/components/admin/content-manager";

/** Fixture surface for browser checks; unavailable in production. */
export default function AdminPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ContentManager />;
}
