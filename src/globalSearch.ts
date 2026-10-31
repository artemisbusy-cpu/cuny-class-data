import type { Day, Meeting, Mode, Section, Status } from "./types.js";

/**
 * CUNY Global Class Search (globalsearch.cuny.edu): public, no login, plain HTTP. One results page
 * per subject lists every section with days/times, instructor, mode, status and meeting dates.
 */

const BASE = "https://globalsearch.cuny.edu/CFGlobalSearchTool";
const DAY: Record<string, Day> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
const text = (h: string) => decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** Cell HTML split on <br> (one entry per meeting row), cleaned. */
const lines = (h: string) => h.split(/<br\s*\/?>/i).map(text).filter(Boolean);

export function to24h(t: string): string {
  const m = t.match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
  if (!m) return "";
  const h = (Number(m[1]) % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function modeFrom(mode: string): Mode {
  if (/hybrid|blended/i.test(mode)) return "hybrid";
  if (/online.*asynch/i.test(mode) || /^online$/i.test(mode.trim())) return "async";
  if (/online/i.test(mode)) return "online"; // "Online Synchronous"
  return "inperson";
}

/** "MoWe 9:05AM - 10:20AM" lines (+ matching room lines) -> meetings; "Online-..." rooms mark online days. */
export function parseMeetings(dayLines: string[], roomLines: string[], mode: Mode): Meeting[] {
  const out: Meeting[] = [];
  dayLines.forEach((l, i) => {
    const m = l.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (!m) return; // "TBA"
    const online = mode === "online" || /^online/i.test(roomLines[i] ?? "");
    for (const d of m[1].match(/Mo|Tu|We|Th|Fr|Sa|Su/g) ?? [])
      out.push({ day: DAY[d], start: to24h(m[2]), end: to24h(m[3]), ...(online ? { online: true as const } : {}) });
  });
  return out;
}

/** "01/28/2027 - 05/27/2027" -> ["2027-01-28", "2027-05-27"] (first meeting row wins). */
export function parseDates(cell: string): [string, string] | null {
  const m = cell.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? [`${m[3]}-${m[1]}-${m[2]}`, `${m[6]}-${m[4]}-${m[5]}`] : null;
}

export function statusFrom(alt: string): Status {
  if (/^open$/i.test(alt)) return "open";
  return /wait/i.test(alt) ? "waitlist" : "closed";
}

/** Parse a subject results page into one Section per row, keyed to its "FIN 3000" course header. */
export function parseResults(html: string): Section[] {
  const rows: Section[] = [];
  for (const block of html.split(/class="testing_msg"/).slice(1)) {
    const head = text(block.slice(0, block.indexOf("</span>") + 7)).match(/([A-Z]{2,5})\s+(\d{3,5}[A-Z]?)\s*-\s*(.*)$/);
    if (!head) continue;
    const code = `${head[1]} ${head[2]}`;
    for (const tr of block.split(/<tr>/i).slice(1)) {
      const cell = (label: string) => (tr.match(new RegExp(`data-label="${label}"[^>]*>([\\s\\S]*?)</td>`, "i")) || [])[1] ?? "";
      const classNumber = text(cell("Class"));
      if (!/^\d{4,5}$/.test(classNumber)) continue;
      const sectionText = text(cell("Section")); // "BMWB-LEC Regular"
      const mode = modeFrom(text(cell("Instruction Mode")));
      const roomLines = lines(cell("Room"));
      const instructor = [...new Set(lines(cell("Instructor")))].filter((n) => !/^(Staff|TBA)$/i.test(n)).join(" / ");
      rows.push({
        code,
        title: text(cell("Course Topic")) || head[3],
        classNumber,
        section: sectionText.split("-")[0].trim(),
        component: (sectionText.match(/-([A-Z]{3})\b/) || [])[1] ?? "LEC",
        mode,
        instructor,
        meetings: parseMeetings(lines(cell("DaysAndTimes")), roomLines, mode),
        regular: /\bRegular\b/i.test(sectionText),
        status: statusFrom((cell("Status").match(/alt="([^"]+)"/) || [])[1] ?? ""),
        dates: parseDates(text(cell("Meeting Dates"))),
        room: [...new Set(roomLines)].join(" / "),
      });
    }
  }
  return rows;
}

/** `<option value='1272'>2027 Spring Term</option>` -> [{id:"1272", label:"2027 Spring Term", name:"Spring 2027"}]. */
export function listTerms(searchPage: string): { id: string; label: string; name: string }[] {
  return [...searchPage.matchAll(/<option value='(\d+)'>((\d{4}) (\w+) Term)<\/option>/g)].map((m) => ({
    id: m[1],
    label: m[2],
    name: `${m[4]} ${m[3]}`,
  }));
}

/** Subject codes from the subject dropdown on the page shown after picking college + term. */
export function listSubjects(html: string): string[] {
  const i = html.indexOf('name="subject_name"');
  if (i < 0) return [];
  const select = html.slice(i, html.indexOf("</select>", i));
  return [...new Set([...select.matchAll(/<option value='([A-Z0-9]{2,6})'>/g)].map((m) => m[1]))];
}

/**
 * The undergraduate career option from the subject page. Most colleges use UGRD, but some use
 * their own code (Kingsborough: UKCC "Undergraduate Kingsborough CC").
 */
export function undergradCareer(html: string): { value: string; name: string } {
  const i = html.indexOf('name="courseCareer"');
  const select = i < 0 ? "" : html.slice(i, html.indexOf("</select>", i));
  const opts = [...select.matchAll(/<option value=['"]?([A-Z0-9]+)['"]?>\s*([^<]*?)\s*</g)].map((m) => ({ value: m[1], name: m[2] }));
  return opts.find((o) => o.value === "UGRD") ?? opts.find((o) => /^undergraduate/i.test(o.name)) ?? { value: "UGRD", name: "Undergraduate" };
}

/** Minimal cookie-keeping HTTP session (the search is a 2-step JSP form tied to JSESSIONID). */
export class GlobalSearch {
  private cookie = "";
  private career = { value: "UGRD", name: "Undergraduate" };
  constructor(private pauseMs = 300) {}

  private async req(path: string, form?: Record<string, string>): Promise<string> {
    const res = await fetch(`${BASE}/${path}`, {
      method: form ? "POST" : "GET",
      headers: { cookie: this.cookie, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => c.split("=") as [string, string]));
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (!res.ok) throw new Error(`Global Search ${path.split("?")[0]} -> HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, this.pauseMs));
    return res.text();
  }

  /** Terms on offer right now (e.g. Fall 2026, Spring 2027, Summer 2027). */
  async terms() {
    return listTerms(await this.req("search.jsp"));
  }

  /** Pick college + term; returns the subject codes offered. */
  async start(term: { id: string; label: string }, inst: string, instName: string): Promise<string[]> {
    const html = await this.req("CFSearchToolController", {
      selectedInstName: `${instName} | `, inst_selection: inst,
      selectedTermName: term.label, term_value: term.id, next_btn: "Next",
    });
    this.career = undergradCareer(html);
    return listSubjects(html);
  }

  /** Every undergraduate section in one subject (e.g. "FINA"), open and closed. */
  async subject(subjectValue: string): Promise<Section[]> {
    const html = await this.req("CFSearchToolController", {
      selectedSubjectName: subjectValue, subject_name: subjectValue,
      selectedCCareerName: this.career.name, courseCareer: this.career.value,
      selectedCAttrName: "", courseAttr: "", selectedCAttrVName: "", courseAttValue: "",
      selectedReqDName: "", reqDesignation: "", selectedSessionName: "", class_session: "",
      selectedModeInsName: "",
      meetingStart: "LT", selectedMeetingStartName: "less than", meetingStartText: "", AndMeetingStartText: "",
      meetingEnd: "LE", selectedMeetingEndName: "less than or equal to", meetingEndText: "", AndMeetingEndText: "",
      daysOfWeek: "I", selectedDaysOfWeekName: "include only these days",
      instructor: "B", selectedInstructorName: "begins with", instructorName: "",
      search_btn_search: "Search",
    }); // open_class omitted = show closed classes too
    return parseResults(html);
  }
}
