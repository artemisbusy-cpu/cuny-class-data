import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GlobalSearch } from "./globalSearch.js";
import { fetchSchoolTeachers, fillFromOtherCampuses, ratingsFor } from "./rmp.js";
import { notPostedYet, passesSanity } from "./sanity.js";
import type { College, RatingsFile, Section, TermFile } from "./types.js";

/**
 * Usage: tsx src/scrape.ts <CODE> [term name, e.g. "Spring 2027"]
 * Writes data/<CODE>/<term-slug>.json for every term Global Search lists (or just the one given),
 * then data/ratings/<CODE>.json. A term that fails the sanity gate keeps its old file and the run
 * exits 1 at the end.
 */

export const slug = (term: string) => term.toLowerCase().replace(/\s+/g, "-");

export function toTermFile(college: string, term: string, sections: Section[], now = new Date()): TermFile {
  const courses: TermFile["courses"] = {};
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.classNumber)) continue; // a class listed under two subjects (cross-listed)
    seen.add(s.classNumber);
    (courses[s.code] ||= { title: s.title, sections: [] }).sections.push(s);
  }
  return { college, term, slug: slug(term), updatedAt: now.toISOString(), sections: seen.size, courses };
}

async function main() {
  const [code, onlyTerm] = process.argv.slice(2);
  const colleges = JSON.parse(readFileSync("colleges.json", "utf8")) as College[];
  const college = colleges.find((c) => c.code === code);
  if (!college) throw new Error(`Unknown college code "${code}". See colleges.json.`);

  let failed = false;
  const instructors: string[] = [];
  const terms = (await new GlobalSearch().terms()).filter((t) => !onlyTerm || t.name === onlyTerm);
  if (!terms.length) throw new Error(`Global Search lists no matching term (${onlyTerm ?? "any"}).`);

  for (const term of terms) {
    const t0 = Date.now();
    const gs = new GlobalSearch(300);
    await gs.terms(); // opens the session
    const subjects = await gs.start(term, college.code, college.name);
    const sections: Section[] = [];
    for (const subj of subjects) {
      try {
        sections.push(...(await gs.subject(subj)));
      } catch (e) {
        console.error(`${college.code} ${term.name} ${subj}: ${String(e)}`);
      }
    }
    const file = toTermFile(college.code, term.name, sections);
    const path = `data/${college.code}/${file.slug}.json`;
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as TermFile).sections : null;
    const secs = Math.round((Date.now() - t0) / 1000);
    if (notPostedYet(prev, file.sections)) {
      console.log(`${college.code} ${term.name}: no classes posted yet, skipped`);
      continue;
    }
    if (!passesSanity(prev, file.sections)) {
      console.error(`SANITY FAIL ${college.code} ${term.name}: ${file.sections} sections vs ${prev} last time. Not published.`);
      failed = true;
      continue;
    }
    mkdirSync(`data/${college.code}`, { recursive: true });
    writeFileSync(path, JSON.stringify(file));
    for (const s of sections) instructors.push(s.instructor);
    console.log(`${college.code} ${term.name}: ${file.sections} sections, ${subjects.length} subjects, ${secs}s`);
  }

  if (college.rmpId && instructors.length) {
    const edges = await fetchSchoolTeachers(college.rmpId);
    const ratings = ratingsFor(instructors, edges);
    const own = Object.values(ratings).filter(Boolean).length;
    for (const other of colleges) {
      if (other.code === college.code || !other.rmpId) continue;
      try {
        fillFromOtherCampuses(ratings, await fetchSchoolTeachers(other.rmpId, 300));
      } catch (e) {
        console.error(`${college.code} ratings from ${other.code}: ${String(e)}`); // a missed campus only costs coverage
      }
    }
    const out: RatingsFile = { college: college.code, rmpId: college.rmpId, updatedAt: new Date().toISOString(), ratings };
    mkdirSync("data/ratings", { recursive: true });
    writeFileSync(`data/ratings/${college.code}.json`, JSON.stringify(out));
    const rated = Object.values(ratings).filter(Boolean).length;
    console.log(`${college.code} ratings: ${rated}/${Object.keys(ratings).length} instructors rated (${own} on its own RMP page, ${edges.length} listed there)`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1]?.endsWith("scrape.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
