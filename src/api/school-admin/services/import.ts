import { toRecord } from '../../../utils/values/record';

export type SchoolAdminImportRowJP = {
  name?: string;
  name_kana?: string;
  representor?: string;
  establishment_date?: string;
  postal_code?: string;
  email?: string;
  address?: string;
  admin_password?: string;
  phone?: string;
  blocked?: boolean;
  notes?: string;
};

const pickStr = (row: Record<string, unknown>, key: string) => {
  const v = row[key];
  return typeof v === 'string' ? v.trim() : '';
};

const pickStrOrNum = (row: Record<string, unknown>, key: string) => {
  const v = row[key];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && isFinite(v)) return String(v);
  return '';
};

const normalizeDigits = (v: string) => v.replace(/[^\d]/g, '');

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

const pickBool = (row: Record<string, unknown>, key: string): boolean | undefined => {
  const v = row[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return undefined;
    if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  }
  return undefined;
};

export const pickSchoolAdminRowJP = (v: unknown): SchoolAdminImportRowJP => {
  const r = toRecord(v);

  const name = pickStr(r, '法人名') || pickStr(r, 'name');
  const name_kana = pickStr(r, '法人名（フリガナ）') || pickStr(r, 'name_kana');

  const representor = pickStr(r, '代表者名（理事長）') || pickStr(r, 'representor');

  const establishment_date = pickDate(r, '設立年月日') || pickStr(r, 'establishment_date');

  const postal_code = normalizeDigits(pickStrOrNum(r, '郵便番号') || pickStr(r, 'postal_code'));
  const email = pickStr(r, 'メールアドレス') || pickStr(r, 'email');
  const address = pickStr(r, '所在地（住所）') || pickStr(r, 'address');

  const admin_password = pickStr(r, 'パスワード') || pickStr(r, 'admin_password');
  const phone = normalizeDigits(pickStrOrNum(r, '電話番号') || pickStr(r, 'phone'));

  const activeRaw = pickBool(r, 'Active');
  const blocked = typeof activeRaw === 'boolean' ? !activeRaw : undefined;

  const notes = pickStr(r, 'その他') || pickStr(r, 'notes');

  return {
    name: name || undefined,
    name_kana: name_kana || undefined,
    representor: representor || undefined,
    establishment_date: establishment_date || undefined,
    postal_code: postal_code || undefined,
    email: email || undefined,
    address: address || undefined,
    admin_password: admin_password || undefined,
    phone: phone || undefined,
    blocked,
    notes: notes || undefined,
  };
};
