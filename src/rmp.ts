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

/** "  José  Ruiz. " -> "jose ruiz": RMP names often carry stray spaces, accents and periods. */
export const normName = (s = "") =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\./g, " ").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Last names worth trying for a CUNY name, best first. "Carlos Encina Oleart" -> ["encina oleart", "oleart"];
 * "Ann Sutherland-Cohen" -> ["sutherland-cohen", "sutherland cohen", "cohen", "sutherland"].
 */
function lastNames(parts: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join(" "));
  const last = parts[parts.length - 1];
  if (last.includes("-")) out.push(last.replace(/-/g, " "), ...last.split("-").reverse());
  return [...new Set(out)];
}

/** First names: exact, nickname prefix (Ron / Ronald), or an RMP initial (A / A.H.). */
function firstMatches(cuny: string, rmp: string): boolean {
  if (!cuny || !rmp) return false;
  if (cuny === rmp) return true;
  const a = cuny.split(" ")[0], b = rmp.split(" ")[0];
  if (a === b) return true;
  if (b.length === 1) return a[0] === b; // RMP "A" / "A.H."
  return Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)); // Ron / Ronald
}

/**
 * Best teacher edge for a name. Priority: last-name match (multi-word and hyphenated last names
 * included) -> school match -> first-name match (exact, then nickname/initial) -> most ratings.
 * Returns null unless the first name fits too: a last-name-only match is often a different person
 * (CUNY "Naomi Fischer" vs the only RMP Fischer, "Stephanie").
 */
export function pickBestMatch(name: string, edges: RmpEdge[], school?: string): RmpEdge | null {
  const parts = normName(name).split(" ");
  if (parts.length < 2) return null;
  const first = parts[0];
  const byRating = (l: RmpEdge[]) => [...l].sort((a, b) => (b.node.numRatings || 0) - (a.node.numRatings || 0))[0];
  for (const last of lastNames(parts)) {
    let pool = edges.filter((e) => normName(e.node.lastName) === last);
    if (pool.length === 0) continue;
    if (school) {
      const s = pool.filter((e) => e.node.school?.name?.toLowerCase() === school.toLowerCase());
      if (s.length) pool = s;
    }
    const exact = pool.filter((e) => normName(e.node.firstName) === first);
    if (exact.length) return byRating(exact);
    const loose = pool.filter((e) => firstMatches(first, normName(e.node.firstName)));
    if (loose.length) return byRating(loose);
  }
  return null;
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

/**
 * Fill unrated names from other CUNY campuses' RMP pages (many professors teach at two, but RMP
 * lists them under one). Exact full-name match only: across 20 campuses, nickname matching would
 * pair the wrong "John Smith". Mutates and returns `ratings`.
 */
export function fillFromOtherCampuses(ratings: Record<string, Rating | null>, edges: RmpEdge[]) {
  const best = new Map<string, Rating>();
  for (const e of edges) {
    const r = parseRmpTeacher(e.node);
    const k = normName(`${e.node.firstName} ${e.node.lastName}`);
    if (r && (!best.has(k) || best.get(k)!.n < r.n)) best.set(k, r);
  }
  for (const full of Object.keys(ratings)) {
    if (ratings[full]) continue;
    for (const one of full.split(" / ")) {
      const r = best.get(normName(one));
      if (r) { ratings[full] = r; break; }
    }
  }
  return ratings;
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
