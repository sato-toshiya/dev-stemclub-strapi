export const getDocumentIdParam = (ctx, keys = ['id', 'studentId'] as const) =>
  keys.map((k) => String(ctx.params?.[k] ?? '').trim()).find(Boolean) ?? '';
