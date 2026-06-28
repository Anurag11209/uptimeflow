import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * Allow crawlers to index public status pages while keeping the authenticated
 * dashboard and auth flows out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/status/"],
      disallow: ["/dashboard/", "/sign-in", "/sign-up", "/two-factor", "/verify-email"],
    },
    ...(APP_URL ? { host: APP_URL } : {}),
  };
}
