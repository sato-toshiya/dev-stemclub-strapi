export type PlainObject = Record<string, unknown>;

export const isPlainObject = (v: unknown): v is PlainObject =>
  Object.prototype.toString.call(v) === '[object Object]';

export const hasOwn = <T extends object>(obj: T, key: PropertyKey): key is keyof T =>
  Object.prototype.hasOwnProperty.call(obj, key);

export const readPayload = (ctx: { request?: { body?: unknown } }): PlainObject => {
  const body = ctx?.request?.body;

  if (isPlainObject(body) && isPlainObject(body.data)) return body.data;
  if (isPlainObject(body)) return body;

  return {};
};
