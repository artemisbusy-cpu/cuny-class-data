import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passesSanity } from "../src/sanity.js";
import { shouldRun } from "../src/season.js";
import { slug, toTermFile } from "../src/scrape.js";
import { buildIndex } from "../src/build-index.js";
import type { Section } from "../src/types.js";

const sec = (code: string, classNumber: string): Section => ({
  code, title: "T", classNumber, section: "A", component: "LEC", mode: "inperson", instructor: "",
  meetings: [], regular: true, status: "open", dates: null, room: "",
});

describe("sanity gate", () => {
  it("blocks drops over 50% and empty runs", () => {
    expect(passesSanity(1000, 499)).toBe(false);
    expect(passesSanity(1000, 500)).toBe(true);
    expect(passesSanity(null, 10)).toBe(true);
    expect(passesSanity(10, 0)).toBe(false);
  });
});

describe("season", () => {
  it("nightly in registration windows, Sundays otherwise", () => {
    expect(shouldRun(new Date("2026-11-03T07:00:00Z"))).toBe(true);  // Tue, Spring window
    expect(shouldRun(new Date("2027-02-15T07:00:00Z"))).toBe(true);  // last day of window
    expect(shouldRun(new Date("2026-03-03T07:00:00Z"))).toBe(false); // Tue, off-season
    expect(shouldRun(new Date("2026-03-08T07:00:00Z"))).toBe(true);  // Sun, off-season
    expect(shouldRun(new Date("2026-09-15T07:00:00Z"))).toBe(true);
    expect(shouldRun(new Date("2026-10-06T07:00:00Z"))).toBe(false); // Tue, gap before Oct 15
  });
});

describe("term file + index", () => {
  it("groups by course and drops cross-listed duplicates", () => {
    const f = toTermFile("BAR01", "Spring 2027", [sec("FIN 3000", "1"), sec("FIN 3000", "2"), sec("ECO 1001", "1")]);
    expect(f.slug).toBe("spring-2027");
    expect(f.sections).toBe(2);
    expect(Object.keys(f.courses)).toEqual(["FIN 3000"]);
    expect(slug("Summer 2027")).toBe("summer-2027");
  });
  it("index lists only colleges with data, terms in calendar order", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccd-"));
    mkdirSync(join(dir, "BAR01"));
    for (const t of ["Summer 2027", "Fall 2026", "Spring 2027"])
      writeFileSync(join(dir, "BAR01", `${slug(t)}.json`), JSON.stringify(toTermFile("BAR01", t, [sec("A 1", "1")])));
    const idx = buildIndex([{ code: "BAR01", name: "Baruch College", rmpId: null }, { code: "HTR01", name: "Hunter College", rmpId: null }], dir);
    expect(idx.colleges.map((c) => c.code)).toEqual(["BAR01"]);
    expect(idx.colleges[0].terms.map((t) => t.name)).toEqual(["Fall 2026", "Spring 2027", "Summer 2027"]);
  });
});
