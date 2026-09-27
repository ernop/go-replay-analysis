import { getDb } from "@/lib/db";
import { gameDetail, gameIds } from "@/lib/game-data";

// One file per game, /data/games/<id>.json: written once by the public copy's
// static export; the LAN dev server answers from the live database.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return gameIds(getDb()).map((id) => ({ file: `${id}.json` }));
}

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const id = /^(\d+)\.json$/.exec(file);
  const detail = id && gameDetail(getDb(), Number(id[1]));
  if (!detail) return Response.json({ error: "game not found" }, { status: 404 });
  return Response.json(detail);
}
