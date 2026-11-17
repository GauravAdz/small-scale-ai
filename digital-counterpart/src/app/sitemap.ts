import type { MetadataRoute } from "next";

import { loadProfile } from "@/lib/knowledge/loader";
import { canonicalSiteUrl } from "@/lib/seo/structured-data";

export default function sitemap(): MetadataRoute.Sitemap {
  let siteUrl: URL;
  try {
    siteUrl = canonicalSiteUrl(loadProfile());
  } catch {
    siteUrl = canonicalSiteUrl();
  }

  return [{
    url: new URL("/", siteUrl).toString(),
    changeFrequency: "monthly",
    priority: 1,
  }];
}
