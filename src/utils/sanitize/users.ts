import { isPlainObject, type PlainObject } from '../http/payload';

export type SafeUser = PlainObject;

const SECRET_KEYS = new Set(['password', 'resetPasswordToken', 'confirmationToken']);

export const sanitizeUser = (raw: unknown): SafeUser | null => {
  if (!isPlainObject(raw)) return null;

  const out: PlainObject = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SECRET_KEYS.has(k)) out[k] = v;
  }
  return out;
};

export const sanitizeEntityUser = <T extends PlainObject>(
  entity: T,
  userKey: string = 'users_permissions_user'
): T => {
  const userRaw = entity[userKey];
  const safe = sanitizeUser(userRaw);
  if (!safe) return entity;
  return { ...entity, [userKey]: safe };
};
