export function registerUserSafe(registry, z) {
  return registry.register(
    'UserSafe',
    z
      .object({
        id: z.number().int().openapi({ example: 10, description: 'User id' }),
        documentId: z.string().openapi({
          example: 's7p63bl9yuju6nzc1t53pvxf',
          description: 'User documentId',
          maxLength: 64,
        }),
        username: z.string().openapi({ example: 'student_xxx@local.invalid', maxLength: 255 }),
        email: z.email().openapi({ example: 'student_xxx@local.invalid', maxLength: 255 }),
        provider: z.string().nullable().optional().openapi({ example: 'local' }),
        confirmed: z.boolean().openapi({ example: true }),
        blocked: z.boolean().openapi({ example: false }),
        phone: z.string().nullable().optional().openapi({ example: null }),
        createdAt: z.string().optional().openapi({ example: '2026-01-07T07:25:43.755Z' }),
        updatedAt: z.string().optional().openapi({ example: '2026-01-07T07:25:43.755Z' }),
        publishedAt: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '2026-01-07T07:25:43.756Z' }),
        locale: z.string().nullable().optional().openapi({ example: null }),
      })
      .catchall(z.unknown())
  );
}

export function registerPagination(registry, z) {
  const Pagination = registry.register(
    'Pagination',
    z
      .object({
        page: z.number().int().openapi({ example: 1, description: 'Current page (1-based).' }),
        pageSize: z.number().int().openapi({ example: 10, description: 'Items per page.' }),
        pageCount: z.number().int().openapi({ example: 3, description: 'Total number of pages.' }),
        total: z.number().int().openapi({ example: 55, description: 'Total number of items.' }),
      })
      .strict()
  );

  return Pagination;
}

export function registerMetaWithPagination(registry, z) {
  const Pagination = registerPagination(registry, z);

  const MetaWithPagination = registry.register(
    'MetaWithPagination',
    z
      .object({
        pagination: Pagination,
      })
      .strict()
  );

  return MetaWithPagination;
}

export function uuidExample() {
  return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
}

export function tokenExample() {
  return 'a5b5750df98fdb069fb70dc556d70813';
}

export const STRAPI_UUID_PATTERN =
  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$';
