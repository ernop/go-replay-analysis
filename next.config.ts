import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Dev-only: Next blocks cross-origin requests to dev assets except from
  // localhost. This app is meant to be opened from a phone on the same LAN
  // (and via 127.0.0.1), so allow loopback and private-network hostnames.
  allowedDevOrigins: [
    "127.0.0.1",
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
  ],
};

export default nextConfig;
