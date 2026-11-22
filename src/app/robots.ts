import type { MetadataRoute } from "next";

// A CE install is an internal tool: nothing should be indexed. App routes are
// also noindex'd via the root layout metadata; this is the belt to that
// suspender.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
