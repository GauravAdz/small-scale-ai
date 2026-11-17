import type { Profile } from "@/lib/knowledge/schema";

const PRODUCTION_URL = "https://gauravadhikari.info.np";

export function canonicalSiteUrl(profile?: Profile): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return new URL(
    configured ||
      (vercelProduction ? `https://${vercelProduction}` : "") ||
      profile?.contact.website ||
      PRODUCTION_URL,
  );
}

export function profileStructuredData(profile: Profile): Record<string, unknown> {
  const siteUrl = canonicalSiteUrl(profile);
  const pageUrl = new URL("/", siteUrl).toString();
  const personId = `${pageUrl}#person`;
  const websiteId = `${pageUrl}#website`;
  const image = profile.avatar ? new URL(profile.avatar, siteUrl).toString() : undefined;
  const sameAs = [...new Set([
    profile.contact.github,
    profile.contact.linkedin,
    profile.contact.x,
    ...profile.links
      .filter(link => link.icon !== "mail" && link.icon !== "file")
      .map(link => link.href),
  ].filter((href): href is string => Boolean(href?.startsWith("http"))))]
    .filter(href => href !== pageUrl && href !== siteUrl.toString());

  const person = {
    "@type": "Person",
    "@id": personId,
    name: profile.name,
    url: pageUrl,
    ...(image ? { image } : {}),
    jobTitle: profile.title,
    ...(profile.headline ? { description: profile.headline } : {}),
    ...(profile.location ? { homeLocation: { "@type": "Place", name: profile.location } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": pageUrl,
        url: pageUrl,
        name: `${profile.name} — ${profile.title}`,
        mainEntity: { "@id": personId },
        about: { "@id": personId },
        isPartOf: { "@id": websiteId },
      },
      person,
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: pageUrl,
        name: profile.name,
        alternateName: "GauravGPT",
        publisher: { "@id": personId },
      },
    ],
  };
}

/** Escape HTML-significant characters before embedding JSON in a script tag. */
export function serializeJsonLd(value: Record<string, unknown>): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
