"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadCloud, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FETCHABLE_SERVERS,
  KNOWN_PEOPLE,
  SERVERS,
  type Account,
} from "@/lib/types";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [server, setServer] = useState<string>("OGS");
  const [username, setUsername] = useState("");
  const [person, setPerson] = useState<string>("Me");
  const [customPerson, setCustomPerson] = useState("");
  const [notice, setNotice] = useState("");
  const [fetching, setFetching] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts))
      .catch(() => setNotice("Could not load accounts."));
  }, []);

  const add = useCallback(async () => {
    const effectivePerson = person === "Other" ? customPerson.trim() : person;
    if (!username.trim() || !effectivePerson) {
      setNotice("Enter a username and pick who it belongs to.");
      return;
    }
    const r = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server, username: username.trim(), person: effectivePerson }),
    });
    const d = await r.json();
    if (!r.ok) {
      setNotice(d.error ?? "Could not add account.");
      return;
    }
    setAccounts(d.accounts);
    setUsername("");
    setCustomPerson("");
    setNotice(`Added ${username.trim()} on ${server}.`);
  }, [server, username, person, customPerson]);

  const remove = useCallback(async (id: number) => {
    const r = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    const d = await r.json();
    setAccounts(d.accounts);
  }, []);

  const fetchGames = useCallback(async (a: Account) => {
    setFetching(a.id);
    setNotice(`Fetching recent games for ${a.username} on ${a.server}…`);
    try {
      const r = await fetch(`/api/accounts/${a.id}/fetch`, { method: "POST" });
      const d = await r.json();
      setNotice(
        r.ok ? `${a.username} on ${a.server}: ${d.note}` : (d.error ?? "Fetch failed.")
      );
      const list = await fetch("/api/accounts").then((x) => x.json());
      setAccounts(list.accounts);
    } catch (err) {
      setNotice(`Fetch failed: ${String(err)}`);
    } finally {
      setFetching(null);
    }
  }, []);

  const canFetch = (s: string) => (FETCHABLE_SERVERS as readonly string[]).includes(s);

  return (
    <div className="flex flex-col gap-6 w-full">
      <section className="rounded bg-card p-4">
        <h1 className="text-xl font-bold mb-1">Tracked accounts</h1>
        <p className="text-base font-semibold mb-4">
          Register usernames per server so games get labeled with who played them, and so
          their recent games can be pulled into the library. Automatic fetching works for{" "}
          <span className="text-gold font-bold">OGS</span> and{" "}
          <span className="text-gold font-bold">KGS</span> today; other servers are stored
          for name-matching only.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-sm font-bold mb-1">Server</label>
            <Select value={server} onValueChange={setServer}>
              <SelectTrigger className="w-[160px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="username on that server"
              className="w-[220px] font-semibold"
            />
          </div>
          <div>
            <label className="block text-sm font-bold mb-1">Belongs to</label>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger className="w-[130px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWN_PEOPLE.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                <SelectItem value="Other">Other…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {person === "Other" && (
            <div>
              <label className="block text-sm font-bold mb-1">Name</label>
              <Input
                value={customPerson}
                onChange={(e) => setCustomPerson(e.target.value)}
                placeholder="e.g. Ernie"
                className="w-[140px] font-semibold"
              />
            </div>
          )}
          <Button className="font-bold" onClick={add}>
            Add account
          </Button>
        </div>
      </section>

      {notice && <p className="text-base font-bold text-gold">{notice}</p>}

      <section className="w-full overflow-x-auto">
        {accounts === null ? (
          <p className="text-lg font-semibold py-8 text-center">Loading accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="text-lg font-semibold py-8 text-center">
            No accounts yet. Add your usernames (and Carl&apos;s, Adam&apos;s, and
            Gary&apos;s) above, then fetch their games.
          </p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-border">
                {["Person", "Server", "Username", "Last fetch", ""].map((h) => (
                  <th
                    key={h}
                    className="py-2 pr-3 text-sm font-bold text-gold uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-border hover:bg-accent/60">
                  <td className="py-2 pr-3 text-base font-bold">{a.person}</td>
                  <td className="py-2 pr-3 font-semibold">{a.server}</td>
                  <td className="py-2 pr-3 font-mono font-bold">{a.username}</td>
                  <td className="py-2 pr-3 text-sm font-semibold max-w-[420px]">
                    {a.lastFetchNote
                      ? `${a.lastFetchNote} (${a.lastFetchAt?.slice(0, 16).replace("T", " ")})`
                      : "never"}
                  </td>
                  <td className="py-2 flex gap-2">
                    <Button
                      size="sm"
                      className="font-bold"
                      disabled={!canFetch(a.server) || fetching === a.id}
                      title={
                        canFetch(a.server)
                          ? "Fetch this player's recent games"
                          : `Fetching from ${a.server} is not implemented yet`
                      }
                      onClick={() => fetchGames(a)}
                    >
                      <DownloadCloud />
                      {fetching === a.id ? "Fetching…" : "Fetch games"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => remove(a.id)}
                      title="Remove account"
                    >
                      <Trash2 />
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
