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
import { TagEditor } from "@/components/tag-editor";
import type { Account, GameSummary } from "@/lib/types";

interface Filters {
  status: string;
  person: string;
  winner: string;
  source: string;
  size: string;
  kind: string;
  q: string;
  sort: string;
}

const DEFAULT_FILTERS: Filters = {
  status: "all",
  person: "all",
  winner: "any",
  source: "all",
  size: "all",
  kind: "all",
  q: "",
  sort: "added",
};

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
  const fileInput = useRef<HTMLInputElement>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== "all" && v !== "any") p.set(k, v);
    }
    if (filters.sort) p.set("sort", filters.sort);
    return p.toString();
  }, [filters]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/games?${query}`);
      const d = await r.json();
      setGames(d.games);
    } catch {
      setNotice("Could not load games — is the server running?");
    }
  }, [query]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
        <section className="rounded border border-primary/60 bg-card p-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-sm font-bold text-gold uppercase tracking-wider">Up next</h2>
            <p className="text-2xl font-bold">
              {upNext.black}
              {upNext.blackRank ? ` ${upNext.blackRank}` : ""} (B) vs {upNext.white}
              {upNext.whiteRank ? ` ${upNext.whiteRank}` : ""} (W)
            </p>
            <p className="text-base font-semibold">
              {[
                upNext.event,
                upNext.datePlayed,
                `${upNext.boardSize}×${upNext.boardSize}`,
                upNext.handicap > 0 ? `HA ${upNext.handicap}` : "even",
                upNext.source,
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              ·{" "}
              {revealUpNext ? (
                <span className="font-mono">{upNext.result || "?"}</span>
              ) : (
                <button
                  className="underline font-bold hover:text-gold"
                  onClick={() => setRevealUpNext(true)}
                >
                  reveal result
                </button>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="lg"
              className="font-bold"
              onClick={() => router.push(`/game/${upNext.id}`)}
            >
              <Eye /> Approve &amp; watch
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="font-bold"
              onClick={() => {
                setRevealUpNext(false);
                patchGame(upNext.id, { status: "skipped" });
              }}
            >
              <SkipForward /> Skip
            </Button>
          </div>
        </section>
      )}

      {/* toolbar */}
      <section className="flex flex-wrap items-center gap-2">
        <Select value={filters.status} onValueChange={(v) => setF({ status: v })}>
          <SelectTrigger className="w-[120px] font-semibold">
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
          <SelectTrigger className="w-[130px] font-semibold">
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
          <SelectTrigger className="w-[120px] font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any result</SelectItem>
            <SelectItem value="B">Black wins</SelectItem>
            <SelectItem value="W">White wins</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={(v) => setF({ source: v })}>
          <SelectTrigger className="w-[120px] font-semibold">
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
          <SelectTrigger className="w-[110px] font-semibold">
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
          <SelectTrigger className="w-[120px] font-semibold">
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
          <SelectTrigger className="w-[140px] font-semibold">
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
            No games match these filters. Upload SGF files or fetch games from the Accounts
            tab.
          </p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border">
                {["Players", "People", "Result", "Board", "Date", "Source", "Moves", "Status", "Analysis", "Tags", ""].map(
                  (h) => (
                    <th key={h} className="py-2 pr-3 text-sm font-bold text-gold uppercase tracking-wide">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id} className="border-b border-border hover:bg-accent/60">
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => router.push(`/game/${g.id}`)}
                      className="text-left text-base font-bold hover:text-gold"
                    >
                      {g.black}
                      {g.blackRank ? ` ${g.blackRank}` : ""} vs {g.white}
                      {g.whiteRank ? ` ${g.whiteRank}` : ""}
                    </button>
                    {g.event && <div className="text-sm font-semibold">{g.event}</div>}
                  </td>
                  <td className="py-2 pr-3">
                    {g.people.map((p) => (
                      <span
                        key={p}
                        className="inline-block rounded bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 mr-1"
                      >
                        {p}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 pr-3">{resultChip(g)}</td>
                  <td className="py-2 pr-3 font-mono font-bold text-sm">
                    {g.boardSize}×{g.boardSize}
                    {g.handicap > 0 ? ` H${g.handicap}` : ""}
                  </td>
                  <td className="py-2 pr-3 font-mono font-bold text-sm">{g.datePlayed || "—"}</td>
                  <td className="py-2 pr-3 font-semibold text-sm">{g.source}</td>
                  <td className="py-2 pr-3 font-mono font-bold text-sm">
                    {g.moveCount}
                    {g.watchedToEnd ? " ✓" : g.lastViewedMove > 0 ? ` @${g.lastViewedMove}` : ""}
                  </td>
                  <td className="py-2 pr-3">
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
                  <td className="py-2 pr-3">{analysisBadge(g)}</td>
                  <td className="py-2 pr-3 min-w-[120px]">
                    <TagEditor compact tags={g.tags} onChange={(tags) => patchGame(g.id, { tags })} />
                  </td>
                  <td className="py-2">
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
