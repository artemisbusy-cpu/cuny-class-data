export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
// "online" = synchronous online (set times, no campus trip); "async" = online with no set times.
export type Mode = "inperson" | "hybrid" | "online" | "async";
export type Status = "open" | "waitlist" | "closed";

export interface Meeting {
  day: Day;
  start: string; // "HH:MM" 24h
  end: string;
  online?: true; // the online day of a hybrid section: no campus trip
}

export interface Section {
  code: string;        // "FIN 3000"
  title: string;
  classNumber: string; // "23112"
  section: string;     // "BMWB" (lecture/recitation pairs share a prefix)
  component: string;   // "LEC"
  mode: Mode;
  instructor: string;  // "" when not assigned
  meetings: Meeting[];
  regular: boolean;    // false for Winter / seven-week sessions
  status: Status;
  dates: [string, string] | null; // ISO start/end of the section's meetings
  room: string;
}

export interface TermFile {
  college: string;
  term: string;      // "Spring 2027"
  slug: string;      // "spring-2027"
  updatedAt: string; // ISO timestamp
  sections: number;
  courses: Record<string, { title: string; sections: Section[] }>;
}

export interface Rating {
  q: number;          // quality 1-5
  d: number;          // difficulty 1-5
  ta: number | null;  // would take again %
  n: number;          // number of ratings
  id: number;         // RMP legacy id (ratemyprofessors.com/professor/<id>)
}

export interface RatingsFile {
  college: string;
  rmpId: string | null;
  updatedAt: string;
  ratings: Record<string, Rating | null>; // by instructor name as Global Search prints it
}

export interface College {
  code: string;
  name: string;
  rmpId: string | null;
}
