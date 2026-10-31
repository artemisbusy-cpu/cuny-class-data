import type { Rating } from "./types.js";

/**
 * RateMyProfessors GraphQL. One school's professors come back in pages of 1,000
 * (Baruch: 4,147 professors = 5 requests), so a whole college is a handful of calls.
 */

const ENDPOINT = "https://www.ratemyprofessors.com/graphql";
// Public token shipped in RMP's own web client ("test:test"); override via env if it rotates.
const TOKEN = process.env.RMP_AUTH_TOKEN || "dGVzdDp0ZXN0";

export interface RmpNode {
  firstName: string;
  lastName: string;
  avgRating: number;
  avgDifficulty: number;
  wouldTakeAgainPercent: number;
  numRatings: number;
  legacyId?: number;
  school?: { name?: string };
}
export interface RmpEdge {
  node: RmpNode;
}

/** A node with zero reviews is not a rating (null). */
export function parseRmpTeacher(node: RmpNode): Rating | null {
  if (!(Number(node.numRatings) > 0)) return null;
  return {
    q: Number(node.avgRating) || 0,
    d: Number(node.avgDifficulty) || 0,
    ta: node.wouldTakeAgainPercent >= 0 ? Math.round(Number(node.wouldTakeAgainPercent)) : null,
    n: Number(node.numRatings) || 0,
    id: Number(node.legacyId) || 0,
  };
}

/**
 * Best teacher edge for a name. Priority: last-name match -> school match -> first-name match ->
 * most ratings. Returns null when no last name matches.
 */
export function pickBestMatch(name: string, edges: RmpEdge[], school?: string): RmpEdge | null {
  const parts = name.trim().toLowerCase().split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  let pool = edges.filter((e) => e.node.lastName?.toLowerCase() === last);
  if (pool.length === 0) return null;
  if (school) {
    const s = pool.filter((e) => e.node.school?.name?.toLowerCase() === school.toLowerCase());
    if (s.length) pool = s;
  }
  const firstMatch = pool.filter((e) => e.node.firstName?.toLowerCase() === first);
  // Only fall back to a last-name-only match when it is unambiguous.
  if (!firstMatch.length && pool.length > 1) return null;
  const chosen = firstMatch.length ? firstMatch : pool;
  return [...chosen].sort((a, b) => (b.node.numRatings || 0) - (a.node.numRatings || 0))[0];
}

/** Ratings for each instructor string ("A / B" = co-taught: the first name with a rating wins). */
export function ratingsFor(names: string[], edges: RmpEdge[]): Record<string, Rating | null> {
  const out: Record<string, Rating | null> = {};
  for (const full of new Set(names)) {
    if (!full) continue;
    let r: Rating | null = null;
    for (const one of full.split(" / ")) {
      const e = pickBestMatch(one, edges);
      r = e ? parseRmpTeacher(e.node) : null;
      if (r) break;
    }
    out[full] = r;
  }
  return out;
}

const QUERY = `query($s:ID!,$after:String){newSearch{teachers(query:{text:"",schoolID:$s},first:1000,after:$after){pageInfo{hasNextPage endCursor} edges{node{firstName lastName avgRating avgDifficulty wouldTakeAgainPercent numRatings legacyId}}}}}`;

/** Every professor RMP lists for one school. */
export async function fetchSchoolTeachers(rmpId: string, pauseMs = 500): Promise<RmpEdge[]> {
  const all: RmpEdge[] = [];
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${TOKEN}`, "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ query: QUERY, variables: { s: rmpId, after } }),
    });
    if (!res.ok) throw new Error(`RMP HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { newSearch?: { teachers?: { edges?: RmpEdge[]; pageInfo?: { hasNextPage: boolean; endCursor: string } } } };
    };
    const t = json.data?.newSearch?.teachers;
    if (!t?.edges) throw new Error("RMP response had no teachers");
    all.push(...t.edges);
    if (!t.pageInfo?.hasNextPage) break;
    after = t.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  return all;
}
