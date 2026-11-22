// Crucible CE.
//
// Plain ESM JavaScript ON PURPOSE (not next.config.ts): the production server
// loads this file at boot, and Next can only load a .ts config with the
// `typescript` package installed (it otherwise tries to `npm install` it,
// which fails in the runtime image, where npm is removed). typescript is a dev
// dependency, so a .ts config would work only while some other package
// happens to pull typescript into production node_modules.
//
// Carried over from the platform build because each line encodes a solved
// production failure:
//   - serverExternalPackages: native bindings / worker bundles that webpack
//     cannot process. Bundling them produced runtime crashes on the host.
//   - per-request CSP nonce is set in src/middleware.ts, so script-src is NOT
//     declared here; the other static security headers are.
/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "socket.io",
    "bcryptjs",
  ],
  // No X-Powered-By fingerprint.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
          },
          // Strict-Transport-Security is NOT set here: src/middleware.ts sends
          // it only when the request arrived over HTTPS, so a plain-HTTP LAN /
          // localhost install is never pinned to https.
        ],
      },
    ];
  },
};

export default nextConfig;
