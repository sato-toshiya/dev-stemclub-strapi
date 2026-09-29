import { toRecord } from '../values/record';

export const parsePagination = (ctx, opts?: { maxPageSize?: number; defaultPageSize?: number }) => {
  const q = toRecord(ctx.query);
  const pagination = toRecord(q.pagination);

  const pageRaw = pagination.page ?? q['pagination[page]'];
  const pageSizeRaw = pagination.pageSize ?? q['pagination[pageSize]'];

  const page = Math.max(1, Number(pageRaw ?? 1) || 1);
  const max = opts?.maxPageSize ?? 100;
  const def = opts?.defaultPageSize ?? 10;

  const pageSize = Math.max(1, Math.min(max, Number(pageSizeRaw ?? def) || def));
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
};
