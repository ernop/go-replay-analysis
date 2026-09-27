"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Cpu, Eye, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account, GameSummary } from "@/lib/types";

interface Filters {
  analysis: string;
  status: string;
  person: string;
  winner: string;
  source: string;
  size: string;
  kind: string;
  q: string;
  sort: string;
}

// Only analyzed games by default: on the phone the owner almost always wants
// a game whose review is ready.
const DEFAULT_FILTERS: Filters = {
  analysis: "done",
  status: "all",
  person: "all",
  winner: "any",
  source: "all",
  size: "all",
  kind: "all",
  q: "",
  sort: "added",
};

/** DGS stores "start,end"; the start date is what "Date played" sorts by. */
function playedOn(g: GameSummary): string {
  return g.datePlayed.split(",")[0] || "—";
}

/** Black first, as everywhere in Go notation. */
function playersOf(g: GameSummary): string {
  const b = g.blackRank ? `${g.black} ${g.blackRank}` : g.black;
  const w = g.whiteRank ? `${g.white} ${g.whiteRank}` : g.white;
  return `${b} vs ${w}`;
}

const TH = "py-2 pr-4 text-sm font-bold text-gold uppercase tracking-wide";

const STATUS_OPTIONS = ["new", "skipped", "played", "done"];

function resultChip(g: GameSummary) {
  if (!g.result) return <span className="font-mono font-bold">?</span>;
  if (g.winner === "B") {
    return (
      <span className="inline-block rounded bg-black border border-white/50 text-white font-mono font-bold text-sm px-1.5 py-0.5">
        {g.result}
      </span>
    );
  }
  if (g.winner === "W") {
    return (
      <span className="inline-block rounded bg-white text-black font-mono font-bold text-sm px-1.5 py-0.5">
        {g.result}
      </span>
    );
  }
  return <span className="font-mono font-bold text-sm">{g.result}</span>;
}

function analysisBadge(g: GameSummary) {
  const pct =
    g.analysisTotal > 0 ? Math.round((g.analysisProgress / g.analysisTotal) * 100) : 0;
  switch (g.analysisState) {
    case "done":
      return (
        <span className="font-bold text-sm" style={{ color: "#99dd55" }}>
          analyzed
        </span>
      );
    case "running":
      return (
        <span className="font-bold text-sm" style={{ color: "#77dddd" }}>
          running {pct}%
        </span>
      );
    case "queued":
      return (
        <span className="font-bold text-sm" style={{ color: "#e0b872" }}>
          queued
        </span>
      );
    case "error":
      return (
        <span className="font-bold text-sm" style={{ color: "#ff7777" }}>
          error
        </span>
      );
    default:
      return <span className="font-semibold text-sm">—</span>;
  }
}

export default function LibraryPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [queueCounts, setQueueCounts] = useState<Record<string, number> | null>(null);
  const [revealUpNext, setRevealUpNext] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== "all" && v !== "any") p.set(k, v);
    }
    if (filters.sort) p.set("sort", filters.sort);
    return p.toString();
  }, [filters]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/games?${query}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setGames(d.games);
      })
      .catch(() => {
        if (!cancelled) setNotice("Could not load games — is the server running?");
      });
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts))
      .catch(() => {});
  }, []);

  // poll analysis queue; refresh the table while work is in flight
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/analysis/queue");
        const d = await r.json();
        if (!active) return;
        setQueueCounts(d.counts);
        if ((d.counts.queued ?? 0) > 0 || (d.counts.running ?? 0) > 0) refresh();
      } catch {}
    };
    tick();
    const t = setInterval(tick, 6000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [refresh]);

  const people = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) set.add(a.person);
    return [...set];
  }, [accounts]);

  const upNext = useMemo(
    () => (games ?? []).find((g) => g.status === "new") ?? null,
    [games]
  );

  const patchGame = useCallback(
    async (id: number, body: object) => {
      await fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      refresh();
    },
    [refresh]
  );

  const beginAnalysis = useCallback(async () => {
    const r = await fetch("/api/analysis/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "unanalyzed" }),
    });
    const d = await r.json();
    setQueueCounts(d.counts);
    setNotice(
      d.queued > 0
        ? `Queued ${d.queued} game${d.queued === 1 ? "" : "s"}. Start the worker on the GPU machine: npm run analyze`
        : "Nothing to queue — everything is already analyzed or in progress."
    );
    refresh();
  }, [refresh]);

  const onUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const payload = await Promise.all(
        [...files].map(async (f) => ({ name: f.name, content: await f.text() }))
      );
      const r = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const d = await r.json();
      setNotice(
        `Uploaded ${d.added} game${d.added === 1 ? "" : "s"}` +
          (d.skipped.length ? ` (skipped: ${d.skipped.join("; ")})` : "")
      );
      refresh();
    },
    [refresh]
  );

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Up next */}
      {upNext && (
        <section className="rounded border border-primary/60 bg-card px-3 py-2 sm:px-4 sm:py-3 flex items-center gap-3 sm:gap-4">
          <h2 className="text-sm font-bold text-gold uppercase tracking-wider whitespace-nowrap">Up next</h2>
          <span className="min-w-0 flex-1 truncate fs-body font-bold" title={playersOf(upNext)}>
            {playersOf(upNext)}
          </span>
          <span className="hidden fs-body whitespace-nowrap sm:inline">{playedOn(upNext)}</span>
          {upNext.handicap > 0 && (
            <span className="hidden fs-body whitespace-nowrap text-gold sm:inline">H{upNext.handicap}</span>
          )}
          {revealUpNext ? (
            <span className="hidden fs-body font-bold whitespace-nowrap sm:inline">{upNext.result || "?"}</span>
          ) : (
            <button
              className="hidden fs-body underline font-bold whitespace-nowrap hover:text-gold sm:inline"
              onClick={() => setRevealUpNext(true)}
            >
              reveal result
            </button>
          )}
          <div className="flex flex-none gap-2">
            <Button
              size="lg"
              className="font-bold"
              title="Approve & watch"
              onClick={() => router.push(`/game/${upNext.id}`)}
            >
              <Eye /> <span className="hidden xl:inline">Approve &amp; watch</span>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="font-bold"
              title="Skip"
              onClick={() => {
                setRevealUpNext(false);
                patchGame(upNext.id, { status: "skipped" });
              }}
            >
              <SkipForward /> <span className="hidden xl:inline">Skip</span>
            </Button>
          </div>
        </section>
      )}

      {/* toolbar */}
      <section className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filters.analysis === "done"}
          onClick={() => setF({ analysis: filters.analysis === "done" ? "all" : "done" })}
          className={`h-9 rounded border px-3 font-bold whitespace-nowrap ${
            filters.analysis === "done"
              ? "border-gold bg-gold text-black"
              : "border-border text-white hover:bg-accent"
          }`}
          title="Show only games whose analysis is finished"
        >
          {filters.analysis === "done" ? "✓ analysis done" : "analysis done"}
        </button>
        <Select value={filters.status} onValueChange={(v) => setF({ status: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.person} onValueChange={(v) => setF({ person: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All people</SelectItem>
            {people.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.winner} onValueChange={(v) => setF({ winner: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any result</SelectItem>
            <SelectItem value="B">Black wins</SelectItem>
            <SelectItem value="W">White wins</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={(v) => setF({ source: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="seed">seed</SelectItem>
            <SelectItem value="ogs">ogs</SelectItem>
            <SelectItem value="kgs">kgs</SelectItem>
            <SelectItem value="upload">upload</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.size} onValueChange={(v) => setF({ size: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sizes</SelectItem>
            <SelectItem value="19">19×19</SelectItem>
            <SelectItem value="13">13×13</SelectItem>
            <SelectItem value="9">9×9</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.kind} onValueChange={(v) => setF({ kind: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Even + HC</SelectItem>
            <SelectItem value="even">Even only</SelectItem>
            <SelectItem value="handicap">Handicap only</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={filters.q}
          onChange={(e) => setF({ q: e.target.value })}
          placeholder="Search player, event, tag…"
          className="w-[220px] font-semibold"
        />
        <Select value={filters.sort} onValueChange={(v) => setF({ sort: v })}>
          <SelectTrigger className="w-auto font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added">Newest added</SelectItem>
            <SelectItem value="date">Date played</SelectItem>
            <SelectItem value="moves">Longest</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <input
          ref={fileInput}
          type="file"
          accept=".sgf"
          multiple
          className="hidden"
          onChange={(e) => {
            onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" className="font-bold" onClick={() => fileInput.current?.click()}>
          <Upload /> Upload SGF
        </Button>
        <Button className="font-bold" onClick={beginAnalysis}>
          <Cpu /> Begin analysis
        </Button>
      </section>

      {queueCounts && (queueCounts.queued > 0 || queueCounts.running > 0) && (
        <p className="text-base font-bold">
          Analysis queue:{" "}
          <span className="font-mono" style={{ color: "#e0b872" }}>
            {queueCounts.queued} queued
          </span>{" "}
          ·{" "}
          <span className="font-mono" style={{ color: "#77dddd" }}>
            {queueCounts.running} running
          </span>{" "}
          ·{" "}
          <span className="font-mono" style={{ color: "#99dd55" }}>
            {queueCounts.done} done
          </span>{" "}
          — worker command: <code className="text-gold">npm run analyze</code>
        </p>
      )}

      {notice && (
        <p className="text-base font-bold text-gold" onClick={() => setNotice("")}>
          {notice}
        </p>
      )}

      {/* games table */}
      <section className="w-full overflow-x-auto">
        {games === null ? (
          <p className="text-lg font-semibold py-8 text-center">Loading library…</p>
        ) : games.length === 0 ? (
          <p className="text-lg font-semibold py-8 text-center">
            {filters.analysis === "done"
              ? "No analyzed games match. Turn off \u201canalysis done\u201d to see every game, or queue analysis."
              : "No games match these filters. Upload SGF files or fetch games from the Accounts tab."}
          </p>
        ) : (
          // Rows stay one line: players take the leftover width and end in "…"
          // when too long. Tapping them opens the game.
          <table className="w-full table-fixed text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-b-2 border-border">
                <th className={TH}>Players</th>
                <th className={`${TH} hidden w-[7rem] lg:table-cell`}>People</th>
                <th className={`${TH} hidden w-[8.5rem] lg:table-cell`}>Result</th>
                <th className={`${TH} hidden w-[7.5rem] sm:table-cell`}>Date</th>
                <th className={`${TH} hidden w-[7rem] lg:table-cell`}>Status</th>
                <th className={`${TH} hidden w-[7rem] xl:table-cell`}>Analysis</th>
                <th className={`${TH} hidden w-[6rem] xl:table-cell`} />
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id} className="border-b border-border hover:bg-accent/60">
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => router.push(`/game/${g.id}`)}
                      title={playersOf(g)}
                      className="block w-full truncate text-left text-sm font-bold hover:text-gold sm:text-base"
                    >
                      {playersOf(g)}
                      {g.handicap > 0 && <span className="ml-3 text-gold">H{g.handicap}</span>}
                    </button>
                  </td>
                  <td className="hidden py-2 pr-4 lg:table-cell">
                    {g.people.map((p) => (
                      <span
                        key={p}
                        className="inline-block rounded bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 mr-1"
                      >
                        {p}
                      </span>
                    ))}
                  </td>
                  <td className="hidden py-2 pr-4 lg:table-cell">{resultChip(g)}</td>
                  <td className="hidden py-2 pr-4 font-bold text-sm tabular-nums sm:table-cell">{playedOn(g)}</td>
                  <td className="hidden py-2 pr-4 lg:table-cell">
                    <select
                      value={g.status}
                      onChange={(e) => patchGame(g.id, { status: e.target.value })}
                      className="bg-secondary text-foreground font-semibold text-sm rounded px-1 py-0.5 border border-border"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="hidden py-2 pr-4 xl:table-cell">{analysisBadge(g)}</td>
                  <td className="hidden py-2 xl:table-cell">
                    <Button size="sm" className="font-bold" onClick={() => router.push(`/game/${g.id}`)}>
                      Watch
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
