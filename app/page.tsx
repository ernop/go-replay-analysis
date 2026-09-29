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
import { filterGames, gameHref, type LibraryData, type LibraryFilters } from "@/lib/library";
import { saveProgress, withViewerProgress } from "@/lib/progress";
import { SITE_MODE } from "@/lib/site-mode";
import type { GameStatus, GameSummary } from "@/lib/types";

// Only analyzed games by default: on the phone the owner almost always wants
// a game whose review is ready.
const DEFAULT_FILTERS: LibraryFilters = {
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

/** DGS stores "start,end" and SGF allows "start..end"; the start date is what "Date played" sorts by. */
function playedOn(g: GameSummary): string {
  return g.datePlayed.split(/,|\.\./)[0] || "—";
}

/** DGS names players "Real Name (handle)"; the library shows the handle. */
function handleOf(player: string): string {
  return /\(([^()]+)\)\s*$/.exec(player)?.[1].trim() || player;
}

/**
 * One side of a game in fixed-width slots (name, rank, and for Black the
 * handicap), so they line up down the table. A tracked person shows by name
 * in a chip of their stone's colour; the negative margin keeps chip text in
 * line with the plain handles above and below.
 */
function PlayerCell({ side, g }: { side: "W" | "B"; g: GameSummary }) {
  const name = side === "W" ? g.white : g.black;
  const rank = side === "W" ? g.whiteRank : g.blackRank;
  const person = side === "W" ? g.whitePerson : g.blackPerson;
  return (
    <span className="inline-flex items-baseline gap-[1ch]" title={rank ? `${name} ${rank}` : name}>
      {person ? (
        <span className="inline-block w-[12ch]">
          <span
            className={
              side === "W"
                ? "-ml-1 rounded-sm bg-white px-1 font-bold text-black"
                : "-ml-[5px] rounded-sm border border-white/60 bg-black px-1 font-bold"
            }
          >
            {person}
          </span>
        </span>
      ) : (
        <span className="inline-block w-[12ch] truncate align-bottom">{handleOf(name)}</span>
      )}
      <span className="inline-block w-[3ch]">{rank}</span>
      {side === "B" && <span className="inline-block w-[3ch] text-gold">{g.handicap > 0 ? `H${g.handicap}` : ""}</span>}
    </span>
  );
}

const TH = "py-1 pr-4 fs-caption font-bold text-gold uppercase tracking-wide";
const TD = "py-1.5 pr-4";
// text-xs rather than fs-fine: cn() only replaces the components' own
// text-sm with a size class it recognises.
const CTL = "h-7 px-2 text-xs font-normal md:text-xs";

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

export default function LibraryPage() {
  const router = useRouter();
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [queueCounts, setQueueCounts] = useState<Record<string, number> | null>(null);
  const [revealUpNext, setRevealUpNext] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/library.json")
      .then((r) => r.json())
      .then((d: LibraryData) => {
        if (!cancelled) setLibrary(d);
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            SITE_MODE === "lan" ? "Could not load games — is the server running?" : "Could not load the game library."
          );
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const games = useMemo(
    () => (library ? filterGames(library.games.map(withViewerProgress), filters) : null),
    [library, filters]
  );

  // poll analysis queue; refresh the table while work is in flight
  useEffect(() => {
    // The public copy is a snapshot; its analysis never changes in place.
    if (SITE_MODE === "public") return;
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

  const people = library?.people ?? [];

  const upNext = useMemo(
    () => (games ?? []).find((g) => g.status === "new") ?? null,
    [games]
  );

  const setStatus = useCallback(
    async (id: number, status: GameStatus) => {
      await saveProgress(id, { status });
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

  const setF = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Up next */}
      {upNext && (
        <section className="fs-caption flex items-center gap-3 rounded border border-[#2a2a2a] px-2 py-1 sm:gap-4">
          <h2 className="whitespace-nowrap font-bold uppercase tracking-wider text-gold">Up next</h2>
          <span className="flex min-w-0 gap-4 overflow-hidden whitespace-nowrap">
            <PlayerCell side="W" g={upNext} />
            <PlayerCell side="B" g={upNext} />
          </span>
          <span className="hidden whitespace-nowrap tabular-nums sm:inline">{playedOn(upNext)}</span>
          {revealUpNext ? (
            <span className="hidden whitespace-nowrap font-bold sm:inline">{upNext.result || "?"}</span>
          ) : (
            <button
              className="hidden whitespace-nowrap underline hover:text-gold sm:inline"
              onClick={() => setRevealUpNext(true)}
            >
              reveal result
            </button>
          )}
          <div className="ml-auto flex flex-none gap-1">
            <Button size="xs" title="Approve & watch" onClick={() => router.push(gameHref(upNext.id))}>
              <Eye /> <span className="hidden xl:inline">Approve &amp; watch</span>
            </Button>
            <Button
              size="xs"
              variant="secondary"
              title="Skip"
              onClick={() => {
                setRevealUpNext(false);
                setStatus(upNext.id, "skipped");
              }}
            >
              <SkipForward /> <span className="hidden xl:inline">Skip</span>
            </Button>
          </div>
        </section>
      )}

      {/* toolbar */}
      {/* One swipeable row on a phone; wrapped rows from 640px. */}
      <section className="flex items-center gap-1.5 overflow-x-auto [&>*]:shrink-0 sm:flex-wrap">
        <button
          type="button"
          aria-pressed={filters.analysis === "done"}
          onClick={() => setF({ analysis: filters.analysis === "done" ? "all" : "done" })}
          className={`${CTL} rounded-lg border whitespace-nowrap ${
            filters.analysis === "done" ? "border-gold text-gold" : "border-input hover:bg-accent"
          }`}
          title="Show only games whose analysis is finished"
        >
          {filters.analysis === "done" ? "✓ analysis done" : "analysis done"}
        </button>
        <Select value={filters.status} onValueChange={(v) => setF({ status: v })}>
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
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
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
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
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any result</SelectItem>
            <SelectItem value="B">Black wins</SelectItem>
            <SelectItem value="W">White wins</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.source} onValueChange={(v) => setF({ source: v })}>
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
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
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
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
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
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
          className={`w-[14rem] ${CTL}`}
        />
        <Select value={filters.sort} onValueChange={(v) => setF({ sort: v })}>
          <SelectTrigger size="sm" className={`w-auto ${CTL}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added">Newest added</SelectItem>
            <SelectItem value="date">Date played</SelectItem>
            <SelectItem value="moves">Longest</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {SITE_MODE === "lan" && (
          <>
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
            <Button size="xs" variant="secondary" onClick={() => fileInput.current?.click()}>
              <Upload /> Upload SGF
            </Button>
            <Button size="xs" variant="secondary" onClick={beginAnalysis}>
              <Cpu /> Begin analysis
            </Button>
          </>
        )}
      </section>

      {queueCounts && (queueCounts.queued > 0 || queueCounts.running > 0) && (
        <p className="fs-caption">
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
        <p className="fs-caption text-gold" onClick={() => setNotice("")}>
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
              ? "No analyzed games match. Turn off \u201canalysis done\u201d to see every game" +
                (SITE_MODE === "lan" ? ", or queue analysis." : ".")
              : "No games match these filters." +
                (SITE_MODE === "lan" ? " Upload SGF files or fetch games from the Accounts tab." : "")}
          </p>
        ) : (
          // Rows stay one line. White comes first; every column before the
          // last keeps its content's fixed width, and the last takes the rest.
          // Tapping a row opens the game.
          <table className="w-full border-collapse whitespace-nowrap text-left">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>White</th>
                <th className={TH}>Black</th>
                <th className={`${TH} hidden sm:table-cell`}>Result</th>
                <th className={`${TH} hidden sm:table-cell`}>Date</th>
                <th className={`${TH} hidden lg:table-cell`} />
                <th className="w-full" />
              </tr>
            </thead>
            <tbody className="fs-caption sm:fs-ui">
              {games.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => router.push(gameHref(g.id))}
                  className="cursor-pointer border-b border-border hover:bg-accent/60"
                >
                  <td className={TD}>
                    <PlayerCell side="W" g={g} />
                  </td>
                  <td className={TD}>
                    <PlayerCell side="B" g={g} />
                  </td>
                  <td className={`${TD} hidden sm:table-cell`}>{resultChip(g)}</td>
                  <td className={`${TD} hidden tabular-nums sm:table-cell`}>{playedOn(g)}</td>
                  <td className={`${TD} hidden lg:table-cell`}>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(gameHref(g.id));
                      }}
                    >
                      Watch
                    </Button>
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
