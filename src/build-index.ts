import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { College, TermFile } from "./types.js";

/** data/index.json: which colleges and terms have data, with counts and dates. The site reads this first. */

const SEASON_ORDER: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
const termKey = (name: string) => {
  const [season, year] = name.split(" ");
  return Number(year) * 10 + (SEASON_ORDER[season] ?? 0);
};

export function buildIndex(colleges: College[], dataDir = "data") {
  return {
    updatedAt: new Date().toISOString(),
    colleges: colleges
      .map((c) => {
        const dir = `${dataDir}/${c.code}`;
        const terms = existsSync(dir)
          ? readdirSync(dir)
              .filter((f) => f.endsWith(".json"))
              .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as TermFile)
              .map((t) => ({ name: t.term, slug: t.slug, sections: t.sections, updatedAt: t.updatedAt }))
              .sort((a, b) => termKey(a.name) - termKey(b.name))
          : [];
        return { code: c.code, name: c.name, ratings: existsSync(`${dataDir}/ratings/${c.code}.json`), terms };
      })
      .filter((c) => c.terms.length > 0),
  };
}

if (process.argv[1]?.endsWith("build-index.ts")) {
  const colleges = JSON.parse(readFileSync("colleges.json", "utf8")) as College[];
  const index = buildIndex(colleges);
  writeFileSync("data/index.json", JSON.stringify(index, null, 1));
  console.log(`index: ${index.colleges.length} colleges`);
}
