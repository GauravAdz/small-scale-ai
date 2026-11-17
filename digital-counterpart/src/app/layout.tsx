import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import counterpartConfig from "../../counterpart.config";
import { ThemeProvider } from "@/components/theme-provider";
import { readEnv } from "@/lib/config";
import { loadProfile } from "@/lib/knowledge/loader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const { site } = counterpartConfig;
  const { siteUrl: configuredSiteUrl } = readEnv();

  // Metadata must not take down the page — an unconfigured profile.json is a
  // setup problem, and the error belongs on the page itself, not in <head>.
  let name = site.name;
  let siteUrl = configuredSiteUrl;
  const description = site.description;
  let firstName = "Gaurav";
  let lastName = "Adhikari";
  let authorUrl: string | undefined;
  let twitterCreator: string | undefined;

  try {
    const profile = loadProfile();
    name = profile.name;
    const nameParts = profile.name.trim().split(/\s+/);
    firstName = nameParts[0] ?? firstName;
    lastName = nameParts.slice(1).join(" ") || lastName;
    authorUrl = profile.contact.website;
    const xProfile = profile.links.find(link => link.icon === "x")?.href ?? profile.contact.x;
    twitterCreator = xProfile ? `@${new URL(xProfile).pathname.split("/").filter(Boolean)[0]}` : undefined;
    // The authored portfolio URL is a safe production fallback when the
    // deployment-specific value is absent (for example during local builds).
    siteUrl ??= profile.contact.website;
  } catch {
    /* fall through to config defaults */
  }

  const title = site.titleTemplate.replaceAll("{name}", name);

  return {
    metadataBase: siteUrl ? new URL(siteUrl) : undefined,
    title,
    description,
    alternates: { canonical: "/" },
    authors: [{ name, ...(authorUrl ? { url: authorUrl } : {}) }],
    creator: name,
    publisher: name,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title,
      description,
      type: "profile",
      url: "/",
      siteName: name,
      locale: "en_US",
      firstName,
      lastName,
    },
    twitter: { card: "summary_large_image", title, description, creator: twitterCreator },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined,
      other: process.env.BING_SITE_VERIFICATION?.trim()
        ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION.trim() }
        : undefined,
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    // Must track --background in globals.css, or the browser chrome and the
    // page disagree at the top edge on mobile.
    { media: "(prefers-color-scheme: light)", color: "#fcfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#131211" },
  ],
  width: "device-width",
  initialScale: 1,
  // No `maximumScale`: locking zoom stops anyone who needs to enlarge text from
  // doing so, and the composer no longer relies on it to avoid iOS auto-zoom
  // (its font-size is at the 16px threshold).
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
