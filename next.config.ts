import type { NextConfig } from "next";
import { SITE_MODE } from "./lib/site-mode";

const shared: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The dev badge floats over review text on a phone; errors still show.
  devIndicators: false,
};

const lan: NextConfig = {
  ...shared,
  // Dev-only: Next blocks cross-origin requests to dev assets except from
  // localhost. This app is meant to be opened from a phone on the same LAN
  // (and via 127.0.0.1), so allow loopback and private-network hostnames.
  allowedDevOrigins: [
    "127.0.0.1",
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
  ],
  // Game pages moved from /game/<id> to /game?id=<id> so the public copy needs
  // one page; saved links keep working.
  async redirects() {
    return [{ source: "/game/:id(\\d+)", destination: "/game?id=:id", permanent: false }];
  },
};

// scripts/publish-public.mjs builds this from its private copy of the repo,
// which sits inside the checkout; without an explicit root, Turbopack picks
// the checkout's lockfile and compiles for minutes instead of seconds.
const publicCopy: NextConfig = {
  ...shared,
  output: "export",
  trailingSlash: true,
  turbopack: { root: process.cwd() },
  // A random build id would make every export differ; chunk names already
  // carry content hashes, and the site revalidates every file (no-cache).
  generateBuildId: async () => "public",
};

export default SITE_MODE === "lan" ? lan : publicCopy;
