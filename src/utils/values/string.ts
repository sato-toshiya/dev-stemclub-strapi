export const toTrimmedString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const digitsOnly = (s: string): boolean => /^\d+$/.test(s);

const NAME_FORBIDDEN_CHARS_RE = /[-'"?`~!@#$%^&*()_+=\\|;:,.<>/]/;
const NAME_HAS_LETTER_RE = /\p{L}/u;

export const isRealPersonName = (v: string): boolean => {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) return false;
  if (!NAME_HAS_LETTER_RE.test(name)) return false;
  if (/\d/.test(name)) return false;
  if (NAME_FORBIDDEN_CHARS_RE.test(name)) return false;
  return true;
};

export const hasNonAsciiChars = (v: string): boolean => {
  const s = typeof v === 'string' ? v : String(v ?? '');
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return true;
  }
  return false;
};
