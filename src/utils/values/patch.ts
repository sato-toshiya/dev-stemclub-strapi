import { hasOwn } from '../http/payload';
import { digitsOnly } from './string';

export type PatchField<T> = { has: false } | { has: true; value: T | null };

export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const readNullableString = (
  src: Record<string, unknown>,
  key: string
): PatchField<string> => {
  if (!hasOwn(src, key)) return { has: false };

  const raw = src[key];
  if (raw === null) return { has: true, value: null };
  if (typeof raw !== 'string') throw new Error(`\`${key}\` は文字列で指定してください`);

  const s = raw.trim();
  return { has: true, value: s === '' ? null : s };
};

export const readNullableYmd = (src: Record<string, unknown>, key: string): PatchField<string> => {
  const r = readNullableString(src, key);
  if (!r.has) return r;
  if (r.value && !isYmd(r.value))
    throw new Error('形式が不正です。yyyy-MM-dd 形式で入力してください');
  return r;
};

export const readNullableDigits = (
  src: Record<string, unknown>,
  key: string,
  opts?: { minLen?: number; maxLen?: number; exactLen?: number }
): PatchField<string> => {
  const r = readNullableString(src, key);
  if (!r.has) return r;

  const v = r.value;
  if (!v) return r;

  if (!digitsOnly(v)) throw new Error(`\`${key}\` は数字のみで入力してください`);

  if (opts?.exactLen && v.length !== opts.exactLen)
    throw new Error(`\`${key}\` は ${opts.exactLen} 桁で入力してください`);
  if (opts?.minLen && v.length < opts.minLen) throw new Error(`\`${key}\` が短すぎます`);
  if (opts?.maxLen && v.length > opts.maxLen) throw new Error(`\`${key}\` が長すぎます`);

  return r;
};
