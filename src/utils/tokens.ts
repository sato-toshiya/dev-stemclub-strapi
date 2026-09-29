import crypto from 'crypto';

export const genTokenHex = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');

export const generateUniqueFieldToken = async (
  strapi,
  uid: string,
  field: string,
  opts?: {
    bytes?: number;
    maxTry?: number;
    generator?: () => string;
  }
) => {
  const bytes = opts?.bytes ?? 16;
  const maxTry = opts?.maxTry ?? 30;
  const gen = opts?.generator ?? (() => genTokenHex(bytes));

  for (let i = 0; i < maxTry; i++) {
    const token = gen();

    const exists = await strapi.db.query(uid).findOne({
      where: { [field]: token },
      select: ['id'],
    });

    if (!exists) return token;
  }

  throw new Error(`${field} の一意な値を生成できませんでした`);
};

export const genDigits = (len: number) => String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');

export const generateUniqueDigitsField = async (
  strapi,
  uid: string,
  field: string,
  len: number,
  maxTry = 50
) => {
  for (let i = 0; i < maxTry; i++) {
    const code = genDigits(len);
    const exists = await strapi.db.query(uid).findOne({
      where: { [field]: code },
      select: ['id'],
    });
    if (!exists) return code;
  }
  throw new Error(`${field} の一意な値を生成できませんでした`);
};

export const makeShareToken = () => crypto.randomBytes(32).toString('base64url');
