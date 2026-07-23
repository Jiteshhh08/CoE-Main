export type YearFilter = 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH';

export type UidParts = {
  startYear: string;
  endYear: string;
  branchCode: string;
};

/** Parse a TCET UID like "24-COMPD13-28" → { startYear: "24", endYear: "28", branchCode: "COMP" } */
export const parseUid = (uid: string | null): UidParts | null => {
  if (!uid) return null;
  const normalized = uid.trim().toUpperCase();
  const parts = normalized.split('-');
  if (parts.length !== 3) return null;

  const [startYear, middle, endYear] = parts;
  if (startYear.length !== 2 || endYear.length !== 2) return null;

  const middleMatch = middle.match(/^([A-Z]+)(\d{1,3})$/);
  if (!middleMatch) return null;

  const letters = middleMatch[1];
  if (letters.length < 2) return null;

  // Branch code is all letters except the last digit-run discriminator
  const branchCode = letters.slice(0, -1);
  return { startYear, endYear, branchCode };
};

export const yearFilterMap: Record<YearFilter, { startYear: string; endYear: string }> = {
  FIRST: { startYear: '25', endYear: '29' },
  SECOND: { startYear: '24', endYear: '28' },
  THIRD: { startYear: '23', endYear: '27' },
  FOURTH: { startYear: '22', endYear: '26' },
};

export const matchesYearFilter = (parts: UidParts, filter: YearFilter) => {
  const expected = yearFilterMap[filter];
  return parts.startYear === expected.startYear && parts.endYear === expected.endYear;
};

/** Known department branch codes extracted from UIDs. */
export const BRANCH_CODES = [
  'AIDS',
  'AIML',
  'BVOC',
  'CIVIL',
  'COMP',
  'CSE',
  'ECS',
  'EXTC',
  'IOT',
  'IT',
  'MCA',
  'MECH',
  'MME',
] as const;

export type BranchCode = (typeof BRANCH_CODES)[number];
