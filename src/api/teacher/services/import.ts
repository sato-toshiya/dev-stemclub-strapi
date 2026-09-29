import { toRecord } from '../../../utils/values/record';

type TeacherImportRowJP = {
  name?: string;
  name_kana?: string;
  birthday?: string;
  gender?: string;
  phone?: string;
  email?: string;
  academic_year?: string;
  classNames: string[];
};

const JP_HEADER = {
  name: '氏名',
  teacherName: '先生氏名',
  plainName: '名前',
  nameKana: 'フリガナ',
  kanaName: 'カナ名',
  fullNameKana: '氏名（カナ）',
  className: 'クラス名',
  assignedClass: '担当クラス',
  classAcademicYear: 'クラス年度',
  birthday: '生年月日',
  gender: '性別',
  phone: '電話番号',
  email: 'メールアドレス',
} as const;

const pickStr = (row: Record<string, unknown>, key: string) => {
  const v = row[key];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).trim();
  return '';
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const toYmdUtc = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const excelSerialToDate = (serial: number) => {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
};

const pickDate = (row: Record<string, unknown>, key: string): string => {
  const v = row[key];

  if (v instanceof Date && !isNaN(v.getTime())) return toYmdUtc(v);

  if (typeof v === 'number' && isFinite(v) && v > 0) {
    const d = excelSerialToDate(v);
    return isNaN(d.getTime()) ? '' : toYmdUtc(d);
  }

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
    if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const iso = Date.parse(s);
    if (!Number.isNaN(iso)) return toYmdUtc(new Date(iso));
  }

  return '';
};

const splitClassNames = (raw: string) =>
  raw
    .split(/[,\n、]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

export const pickTeacherRowJP = (v: unknown): TeacherImportRowJP => {
  const r = toRecord(v);

  const name =
    pickStr(r, JP_HEADER.name) ||
    pickStr(r, JP_HEADER.teacherName) ||
    pickStr(r, JP_HEADER.plainName);
  const name_kana =
    pickStr(r, JP_HEADER.nameKana) ||
    pickStr(r, JP_HEADER.kanaName) ||
    pickStr(r, JP_HEADER.fullNameKana);

  const classRaw = pickStr(r, JP_HEADER.className) || pickStr(r, JP_HEADER.assignedClass);
  const academicYearRaw = pickStr(r, JP_HEADER.classAcademicYear);

  return {
    name: name || undefined,
    name_kana: name_kana || undefined,
    birthday: pickDate(r, JP_HEADER.birthday) || pickStr(r, 'birthday') || undefined,
    gender: pickStr(r, JP_HEADER.gender) || undefined,
    phone: pickStr(r, JP_HEADER.phone) || undefined,
    email: pickStr(r, JP_HEADER.email) || undefined,
    academic_year: academicYearRaw || undefined,
    classNames: classRaw ? splitClassNames(classRaw) : [],
  };
};
