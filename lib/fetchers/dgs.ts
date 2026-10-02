import type Database from "better-sqlite3";
import { ingestSgf } from "../db";

const DGS = "https://www.dragongoserver.net";
// DGS archives go back decades; page through everything up to this safety cap.
const MAX_GAMES = 400;
const PAGE_SIZE = 100; // DGS quick-suite maximum per page

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * DGS game ids already in the library. Games fetched here are keyed
 * "dgs:<gid>", but copies can sit under other keys (the games copied from
 * tvnik are "tvnik:<id>"), so the id also comes from the game's name, which
 * DGS writes as "white-black-<gid>-<yyyymmdd>".
 */
function knownDgsGames(db: Database.Database): Set<number> {
  const known = new Set<number>();
  const rows = db.prepare("SELECT source_key, event FROM games").all() as {
    source_key: string | null;
    event: string;
  }[];
  for (const r of rows) {
    const m = /^dgs:(\d+)$/.exec(r.source_key ?? "") ?? /-(\d+)-\d{8}$/.exec(r.event);
    if (m) known.add(Number(m[1]));
  }
  return known;
}

/**
 * Dragon Go Server "quick suite" client.
 *
 * DGS removed all anonymous list/status access (only sgf.php is public), so
 * fetching anyone's game archive requires logging in with YOUR OWN DGS
 * account. Set DGS_USERID and DGS_PASSWD in .env.local (they never leave the
 * server; DGS quick-mode login is used once per fetch).
 *
 * Protocol (specs/quick_suite.txt in the DGS source):
 *   login.php?quick_mode=1&userid=H&passwd=P            -> session cookies
 *   quick_do.php?obj=user&cmd=info&user=H               -> { id, handle, ... }
 *   quick_do.php?obj=game&cmd=list&view=finished&uid=N  -> { list_result: [...] }
 *   sgf.php?gid=N                                       -> SGF (public)
 */
export async function fetchDgsGames(
  db: Database.Database,
  username: string
): Promise<{ added: number; skipped: number; note: string }> {
  const userid = process.env.DGS_USERID;
  const passwd = process.env.DGS_PASSWD;
  if (!userid || !passwd) {
    return {
      added: 0,
      skipped: 0,
      note:
        "DGS requires a login for archive access — put DGS_USERID and DGS_PASSWD " +
        "(your own DGS account) in .env.local and restart the server",
    };
  }

  // 1. quick-mode login, collect session cookies
  const loginRes = await fetch(
    `${DGS}/login.php?quick_mode=1&userid=${encodeURIComponent(userid)}&passwd=${encodeURIComponent(passwd)}`
  );
  const loginBody = await loginRes.text();
  const errMatch = /#Error:\s*([a-z_]+)/i.exec(loginBody);
  if (errMatch) {
    return { added: 0, skipped: 0, note: `DGS login failed: ${errMatch[1]}` };
  }
  const cookie = loginRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) {
    return { added: 0, skipped: 0, note: "DGS login returned no session cookie" };
  }
  const headers = { Cookie: cookie };

  const quickDo = async (params: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${DGS}/quick_do.php?${params}`, { headers });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`DGS returned non-JSON: ${text.slice(0, 120)}`);
    }
  };

  // 2. resolve handle -> uid
  const info = await quickDo(`obj=user&cmd=info&user=${encodeURIComponent(username)}`);
  if (info.error) {
    const msg =
      info.error === "unknown_user"
        ? `user "${username}" does not exist on DGS`
        : `DGS user lookup failed: ${info.error}`;
    return { added: 0, skipped: 0, note: msg };
  }
  const uid = Number(info.id);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { added: 0, skipped: 0, note: "DGS user lookup returned no user id" };
  }

  // 3. page through the user's complete finished-games archive
  const items: { id: number; time_lastmove?: string }[] = [];
  for (let off = 0; items.length < MAX_GAMES; off += PAGE_SIZE) {
    const list = await quickDo(
      `obj=game&cmd=list&view=finished&uid=${uid}&lstyle=json&limit=${PAGE_SIZE}&off=${off}`
    );
    if (list.error) {
      if (items.length === 0) {
        return { added: 0, skipped: 0, note: `DGS game list failed: ${list.error}` };
      }
      break; // keep what we already have
    }
    const page = (list.list_result ?? []) as { id: number; time_lastmove?: string }[];
    items.push(...page);
    if (!list.list_has_next || page.length === 0) break;
    await sleep(400);
  }
  items.sort((a, b) => String(b.time_lastmove ?? "").localeCompare(String(a.time_lastmove ?? "")));

  if (items.length === 0) {
    return { added: 0, skipped: 0, note: `no finished games found for ${username} on DGS` };
  }

  // 4. download SGFs (public endpoint)
  const known = knownDgsGames(db);
  let added = 0;
  let skipped = 0;
  for (const item of items.slice(0, MAX_GAMES)) {
    const gid = Number(item.id);
    if (!Number.isFinite(gid) || gid <= 0 || known.has(gid)) {
      skipped++;
      continue;
    }
    const res = await fetch(`${DGS}/sgf.php?gid=${gid}`);
    if (!res.ok) {
      skipped++;
      continue;
    }
    const sgf = await res.text();
    const result = ingestSgf(db, sgf, "dgs", `dgs:${gid}`);
    if (result.added) {
      added++;
      known.add(gid);
    } else skipped++;
    await sleep(300); // be polite; DGS rate-limits aggressively
  }
  return {
    added,
    skipped,
    note: `checked ${items.length} finished games for ${String(info.handle ?? username)}`,
  };
}
