const GTP_COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export function vertexToGtp(vertex: [number, number] | null, size: number): string {
  if (!vertex) return "pass";
  return GTP_COLS[vertex[0]] + String(size - vertex[1]);
}

export function gtpToVertex(gtp: string, size: number): [number, number] | null {
  const s = gtp.trim().toUpperCase();
  if (s === "PASS" || s === "") return null;
  const col = GTP_COLS.indexOf(s[0]);
  const row = parseInt(s.slice(1), 10);
  if (col < 0 || !Number.isFinite(row) || row < 1 || row > size) return null;
  return [col, size - row];
}
