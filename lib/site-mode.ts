/**
 * Which build this is. "lan" is the owner's app on the home network: it reads
 * and writes the SQLite library through /api. "public" is the read-only static
 * copy at https://go-replayer.fuseki.net/: every visitor sees every game and
 * keeps their own viewing progress in their browser. Only
 * scripts/publish-public.mjs builds "public", by rewriting this line in its
 * private build copy.
 */
export const SITE_MODE = "lan" as "lan" | "public";
