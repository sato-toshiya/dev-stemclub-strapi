export type ImportRow = Record<string, unknown>;

export const JP = {
  name: '氏名',
  name_kana: 'フリガナ',
  birthday: '生年月日',
  gender: '性別',
  academic_year: 'クラス年度',
  className: 'クラス名',
  guardian_name: '保護者氏名',
  guardian_relationship: '続柄',
  guardian_phone: '連絡先電話番号',
  guardian_email: 'メールアドレス',
  address: '住所',
  emergency_phone: '緊急連絡先',
  enrollment_date: '入園日',
  notes: '備考',
} as const;

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const digitsOnly = (v: string) => v.replace(/[^\d]/g, '');

export function mapGender(raw: string): string {
  if (!raw) return '';
  if (raw === '男性') return 'male';
  if (raw === '女性') return 'female';
  if (raw === 'その他') return 'other';
  return raw;
}

export function mapGuardianRelationship(raw: string): string {
  if (!raw) return '';
  if (raw === '父') return 'father';
  if (raw === '母') return 'mother';
  if (raw === '祖父') return 'grandfather';
  if (raw === '祖母') return 'grandmother';
  if (raw === 'その他') return 'other';
  return raw;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const toYmdUtc = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

const excelSerialToDate = (serial: number) => {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
};

export function normalizeDate(raw: unknown): string {
  const v = raw;
  if (!v) return '';

  if (v instanceof Date && !isNaN(v.getTime())) return toYmdUtc(v);

  if (typeof v === 'number' && isFinite(v) && v > 0) {
    const d = excelSerialToDate(v);
    return isNaN(d.getTime()) ? '' : toYmdUtc(d);
  }

  const str = s(v);
  if (!str) return '';

  const m = str.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const iso = Date.parse(str);
  if (!Number.isNaN(iso)) return toYmdUtc(new Date(iso));

  return '';
}

export function pickStudentRowJP(r: ImportRow) {
  const name = s(r[JP.name]);
  const name_kana = s(r[JP.name_kana]);
  const birthday = normalizeDate(r[JP.birthday]);
  const gender = mapGender(s(r[JP.gender]));
  const academic_year = s(r[JP.academic_year]);
  const className = s(r[JP.className]);

  const guardian_name = s(r[JP.guardian_name]);
  const guardian_relationship = mapGuardianRelationship(s(r[JP.guardian_relationship]));
  const guardian_phone = digitsOnly(s(r[JP.guardian_phone]));
  const guardian_email = s(r[JP.guardian_email]);
  const address = s(r[JP.address]);
  const emergency_phone = digitsOnly(s(r[JP.emergency_phone]));
  const enrollment_date = normalizeDate(r[JP.enrollment_date]);
  const notes = s(r[JP.notes]);

  return {
    name,
    name_kana,
    birthday,
    gender,
    academic_year,
    className,
    guardian_name,
    guardian_relationship,
    guardian_phone,
    guardian_email,
    address,
    emergency_phone,
    enrollment_date,
    notes,
  };
}
