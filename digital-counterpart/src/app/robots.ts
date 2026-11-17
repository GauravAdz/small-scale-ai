import type { MetadataRoute } from "next";

import { loadProfile } from "@/lib/knowledge/loader";
import { canonicalSiteUrl } from "@/lib/seo/structured-data";

export default function robots(): MetadataRoute.Robots {
  let siteUrl: URL;
  try {
    siteUrl = canonicalSiteUrl(loadProfile());
  } catch {
    siteUrl = canonicalSiteUrl();
  }

  const publicRules = { allow: "/", disallow: ["/api/", "/preview/"] };
  return {
    rules: [
      { userAgent: "*", ...publicRules },
      { userAgent: "OAI-SearchBot", ...publicRules },
    ],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
    host: siteUrl.origin,
  };
}
