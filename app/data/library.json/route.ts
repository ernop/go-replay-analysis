import { getDb } from "@/lib/db";
import { libraryData } from "@/lib/game-data";

// Written once by the public copy's static export; the LAN dev server
// answers it from the live database on every request.
export const dynamic = "force-static";

export function GET() {
  return Response.json(libraryData(getDb()));
}
