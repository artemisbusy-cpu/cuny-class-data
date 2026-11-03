import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { courseHeader, listSubjects, listTerms, modeFrom, parseDates, parseResults, to24h } from "../src/globalSearch.js";
import { fillFromOtherCampuses, parseRmpTeacher, pickBestMatch, ratingsFor, type RmpEdge } from "../src/rmp.js";

const results = readFileSync("tests/fixtures/globalsearch-fin.html", "utf8");
const rmp = JSON.parse(readFileSync("tests/fixtures/rmp-response.json", "utf8"));
const edges = rmp.data.newSearch.teachers.edges;

describe("Global Search results parser (real Spring 2027 Baruch FIN 3000 page)", () => {
  const rows = parseResults(results);
  const by = (n: string) => rows.find((r) => r.classNumber === n)!;

  it("reads every FIN 3000 section", () => {
    expect(rows.length).toBe(17);
    expect(rows.every((r) => r.code === "FIN 3000")).toBe(true);
  });
  it("in-person two-day section with meeting dates", () => {
    const s = by("23112");
    expect(s.instructor).toBe("Shuai Hao");
    expect(s.mode).toBe("inperson");
    expect(s.meetings).toEqual([{ day: "Tue", start: "09:05", end: "10:20" }, { day: "Thu", start: "09:05", end: "10:20" }]);
    expect(s.regular).toBe(true);
    expect(s.section).toMatch(/^[A-Z0-9]+$/);
    expect(s.dates).toEqual(["2027-01-28", "2027-05-27"]);
    expect(["open", "waitlist", "closed"]).toContain(s.status);
  });
  it("hybrid: the online meeting day needs no campus trip", () => {
    const s = by("23111");
    expect(s.mode).toBe("hybrid");
    expect(s.meetings.find((m) => m.day === "Wed")?.online).toBe(true);
    expect(s.meetings.find((m) => m.day === "Mon")?.online).toBeUndefined();
  });
  it("async online has no meetings; Winter is not regular session", () => {
    expect(by("23101").mode).toBe("async");
    expect(by("23101").meetings).toEqual([]);
    expect(by("23104").regular).toBe(false);
  });
  it("modes, times and dates", () => {
    expect(modeFrom("Online Synchronous")).toBe("online");
    expect(modeFrom("Hybrid Asynchronous")).toBe("hybrid");
    expect(modeFrom("In Person")).toBe("inperson");
    expect(to24h("12:00PM")).toBe("12:00");
    expect(to24h("7:05PM")).toBe("19:05");
    expect(parseDates("TBA")).toBeNull();
  });
});

describe("term and subject dropdowns", () => {
  it("reads terms", () => {
    const html = "<option value='1276'>2027 Summer Term</option><option value='1272'>2027 Spring Term</option>";
    expect(listTerms(html)).toEqual([
      { id: "1276", label: "2027 Summer Term", name: "Summer 2027" },
      { id: "1272", label: "2027 Spring Term", name: "Spring 2027" },
    ]);
  });
  it("reads subjects from the subject select only", () => {
    const html = `<select name="subject_name" id="subject_ld"><option value=""><option value='ACCT'>Accounting</option>
<option value='FINA'>Finance</option></select><select name="other"><option value='XXXX'>x</option></select>`;
    expect(listSubjects(html)).toEqual(["ACCT", "FINA"]);
  });
});

describe("RateMyProfessors", () => {
  it("parses a rated teacher", () => {
    const r = parseRmpTeacher(edges[0].node)!;
    expect(r.q).toBe(2.6);
    expect(r.d).toBe(3.6);
    expect(r.ta).toBe(39);
    expect(r.n).toBe(33);
  });
  it("zero reviews = no rating; -1 take-again = null", () => {
    const base = { firstName: "No", lastName: "Data", avgRating: 3, avgDifficulty: 3, wouldTakeAgainPercent: -1 };
    expect(parseRmpTeacher({ ...base, numRatings: 0 })).toBeNull();
    expect(parseRmpTeacher({ ...base, numRatings: 4 })!.ta).toBeNull();
  });
  it("prefers the school match, then the first name", () => {
    const best = pickBestMatch("Dhruva Bhaskar", edges, "Baruch College");
    expect(best?.node.firstName).toBe("Dhruva");
    expect(pickBestMatch("Nobody Here", edges)).toBeNull();
  });
  it("matches names CUNY and RMP write differently", () => {
    const e = (firstName: string, lastName: string, numRatings = 5): RmpEdge => ({
      node: { firstName, lastName, numRatings, avgRating: 4, avgDifficulty: 3, wouldTakeAgainPercent: 80 },
    });
    const pool = [e("Mohsin ", " Ahmed", 15), e("Kazi", "Ahmed", 9), e("Ron", "Kopp", 15), e("Nalani", "Kopp", 0),
      e("Manal", "Abu Shaheen"), e("Patricia", "Cohen"), e("José", "Ruiz"), e("A.H.", "Khan"), e("Yang", "He"), e("Ye", "He")];
    const who = (n: string) => { const m = pickBestMatch(n, pool)?.node; return m ? `${m.firstName.trim()} ${m.lastName.trim()}` : null; };
    expect(who("Mohsin Ahmed")).toBe("Mohsin Ahmed"); // stray spaces on RMP
    expect(who("Ronald Kopp")).toBe("Ron Kopp"); // nickname
    expect(who("Manal Abu Shaheen")).toBe("Manal Abu Shaheen"); // two-word last name
    expect(who("Patricia Sutherland-Cohen")).toBe("Patricia Cohen"); // hyphenated
    expect(who("Jose Ruiz")).toBe("José Ruiz"); // accents
    expect(who("Amir Khan")).toBe("A.H. Khan"); // RMP initial
    expect(who("Muyuan He")).toBeNull(); // last name shared, no first-name match
    expect(who("Kevin Kopp")).toBeNull();
    expect(who("Naomi Cohen")).toBeNull(); // the only Cohen is someone else

  });
  it("fills unrated names from other campuses on an exact name match only", () => {
    const node = (firstName: string, lastName: string, numRatings: number) =>
      ({ node: { firstName, lastName, numRatings, avgRating: 4.5, avgDifficulty: 2, wouldTakeAgainPercent: 90, legacyId: 7 } });
    const r = fillFromOtherCampuses({ "Amy  Crumly": null, "Ron Kopp": null, "Kept Here": { q: 1, d: 1, ta: null, n: 1, id: 1 } },
      [node("Amy", "Crumly", 3), node("Ronald", "Kopp", 9), node("Kept", "Here", 50)]);
    expect(r["Amy  Crumly"]?.n).toBe(3);
    expect(r["Ron Kopp"]).toBeNull();
    expect(r["Kept Here"]?.n).toBe(1);
  });
  it("ratingsFor: co-taught falls through to the first rated name; unknown = null", () => {
    const r = ratingsFor(["Nobody Here / Dhruva Bhaskar", "Someone Else"], edges);
    expect(r["Nobody Here / Dhruva Bhaskar"]?.q).toBe(2.6);
    expect(r["Someone Else"]).toBeNull();
  });
});

describe("undergradCareer", () => {
  it("uses the college's own undergraduate code when it isn't UGRD", async () => {
    const { undergradCareer } = await import("../src/globalSearch.js");
    const html = (await import("node:fs")).readFileSync("tests/fixtures/globalsearch-career-kcc.html", "utf8");
    expect(undergradCareer(html)).toEqual({ value: "UKCC", name: "Undergraduate Kingsborough CC" });
    expect(undergradCareer('<select name="courseCareer"><option value="UGRD">Undergraduate</option></select>').value).toBe("UGRD");
    expect(undergradCareer("").value).toBe("UGRD");
  });
});

describe("course headers across colleges", () => {
  it.each([
    ["FIN 3000 - Principles of Finance", "FIN 3000"],
    ["ENGL. 1010 - English Composition I", "ENGL 1010"],
    ["ENG 10 - Accelerated Writing Skills", "ENG 10"],
    ["ENG 8 - Non-Native Writing", "ENG 8"],
    ["ENG 100.5 - Intensive English Composition", "ENG 100.5"],
    ["MAT 100SI - Intro College Math (SI)", "MAT 100SI"],
    ["ENG 12A0 - Composition I ALP", "ENG 12A0"],
    ["ENG 1101CO - ENGL Composition I Corequisite", "ENG 1101CO"],
    ["ENG CL100 - CLIP Writing -Low-Intermediate", "ENG CL100"],
    ["ENG-W ES01 - English Start", "ENG-W ES01"],
    ["MTH-W 23/23.5 - MTH 23/23.5 Workshop", "MTH-W 23/23.5"],
    ["STABD 1001 - Study Abroad", "STABD 1001"],
  ])("%s", (line, code) => expect(courseHeader(line)?.[0]).toBe(code));
  it("keeps the title and ignores page chrome", () => {
    expect(courseHeader("CL100 - x")).toBeNull();
    expect(courseHeader("Brooklyn College | 2026 Fall Term | 159 class section(s) found")).toBeNull();
    expect(courseHeader("ENG CL100 - CLIP Writing -Low-Intermediate")?.[1]).toBe("CLIP Writing -Low-Intermediate");
  });
});
