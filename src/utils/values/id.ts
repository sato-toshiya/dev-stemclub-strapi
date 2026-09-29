export type StrapiID = string | number;

export const toIdNumber = (id: unknown): number | null => {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim()) {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
