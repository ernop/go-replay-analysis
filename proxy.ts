import { NextResponse, type NextRequest } from "next/server";

// The LAN app has no login and listens on 0.0.0.0:4517. With DNS rebinding a web
// page re-points its own domain at this machine, then reads and writes the app
// with that domain as Host; another site's page can also post to it directly.
// Rebinding needs a public DNS name, so IP addresses (how the phone and the
// analyzer reach the app) and names that only resolve locally pass.
// scripts/publish-public.mjs deletes this file: the public copy is static files.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal"];
const MAX_LOGGED_REFUSALS = 20;
let loggedRefusals = 0;

function isLocalName(name: string): boolean {
  const host = name.toLowerCase().replace(/\.$/, "");
  if (host === "") return false;
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[") ||
    host === "localhost" ||
    !host.includes(".") ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

function hostWithoutPort(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

function problem(request: NextRequest): string | null {
  if (!isLocalName(hostWithoutPort(request.headers.get("host") ?? ""))) return "host";
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get("origin");
  if (origin !== null) return URL.canParse(origin) && isLocalName(new URL(origin).hostname) ? null : "origin";
  return request.headers.get("sec-fetch-site") === "cross-site" ? "cross-site" : null;
}

export function proxy(request: NextRequest) {
  const refused = problem(request);
  if (refused === null) return NextResponse.next();
  if (loggedRefusals < MAX_LOGGED_REFUSALS) {
    loggedRefusals += 1;
    console.warn(
      `Refused ${request.method} ${request.nextUrl.pathname} (${refused}): ` +
        `Host ${request.headers.get("host")}, Origin ${request.headers.get("origin") ?? "none"}`,
    );
  }
  return NextResponse.json(
    { error: "This LAN app answers only its own pages, by IP address or local name." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
