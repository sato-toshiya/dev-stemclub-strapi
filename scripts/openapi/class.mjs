import { registerMetaWithPagination, uuidExample } from './shared.mjs';

export function registerClassOpenApi(registry, z) {
  const MetaWithPagination = registerMetaWithPagination(registry, z);
  const ClassMyAcademicYear = registry.register(
    'ClassMyAcademicYear',
    z
      .object({
        id: z.number().int().openapi({
          example: 12,
          description: 'AcademicYear internal numeric id',
        }),
        documentId: z.uuid().openapi({
          example: uuidExample(),
          description: 'AcademicYear documentId (UUID)',
        }),
        name: z.string().openapi({
          example: '2025年度',
          maxLength: 255,
          description: 'AcademicYear name',
        }),
      })
      .catchall(z.unknown())
  );

  const ClassMyItem = registry.register(
    'ClassMyItem',
    z
      .object({
        id: z.number().int().openapi({
          example: 101,
          description: 'Class internal numeric id',
        }),
        documentId: z.uuid().openapi({
          example: uuidExample(),
          description: 'Class documentId (UUID)',
        }),
        name: z.string().openapi({
          example: 'Class A',
          maxLength: 255,
          description: 'Class name',
        }),
        academic_year: ClassMyAcademicYear.nullable()
          .optional()
          .openapi({ description: 'Related academic year (populated).' }),

        studentsCount: z.number().int().min(0).openapi({
          example: 12,
          description: 'Number of students currently assigned to this class',
        }),
      })
      .catchall(z.unknown())
  );

  const ClassMyResponse = registry.register(
    'ClassMyResponse',
    z
      .object({
        data: z.array(ClassMyItem).openapi({
          description:
            'Classes of the current teacher in the ACTIVE academic year only (paginated). ' +
            'If there is no active academic year, returns an empty array.',
        }),
        meta: MetaWithPagination,
      })
      .strict()
  );

  const ClassMyQuery = registry.register(
    'ClassMyQuery',
    z
      .object({
        'pagination[page]': z.coerce.number().int().min(1).optional().openapi({
          description: 'Page number (1-based). Default: 1',
          example: 1,
        }),
        'pagination[pageSize]': z.coerce.number().int().min(1).max(100).optional().openapi({
          description: 'Items per page. Default: 10. Max: 100',
          example: 10,
        }),
      })
      .strict()
      .openapi({
        description:
          'Pagination params for infinite scroll. Use querystring format only: ' +
          '`?pagination[page]=1&pagination[pageSize]=10`.',
      })
  );

  registry.registerPath({
    method: 'get',
    path: '/classes/my',
    summary: 'List classes of current teacher (active academic year only, paginated)',
    description:
      "Return classes assigned to the currently authenticated teacher, restricted to the tenant's ACTIVE academic year. " +
      'Supports pagination for infinite scroll. ' +
      'Stop fetching when `page >= meta.pagination.pageCount` or when `data.length === 0`.',
    tags: ['class'],
    security: [{ bearerAuth: [] }],
    request: {
      query: ClassMyQuery,
    },
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: ClassMyResponse,
            examples: {
              normal: {
                value: {
                  data: [
                    {
                      id: 101,
                      documentId: uuidExample(),
                      name: 'Class A',
                      academic_year: {
                        id: 12,
                        documentId: uuidExample(),
                        name: '2025年度',
                      },
                      studentsCount: 12,
                    },
                    {
                      id: 102,
                      documentId: uuidExample(),
                      name: 'Class B',
                      academic_year: {
                        id: 12,
                        documentId: uuidExample(),
                        name: '2025年度',
                      },
                      studentsCount: 0,
                    },
                  ],
                  meta: {
                    pagination: {
                      page: 1,
                      pageSize: 10,
                      pageCount: 3,
                      total: 55,
                    },
                  },
                },
              },
              noActiveAcademicYear: {
                value: {
                  data: [],
                  meta: {
                    pagination: {
                      page: 1,
                      pageSize: 0,
                      pageCount: 0,
                      total: 0,
                    },
                  },
                },
              },
            },
          },
        },
      },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: {
        description:
          'Not allowed (authenticated user is not linked to a teacher record, or teacher has no tenant school_admin link).',
      },
      500: { description: 'Internal server error' },
    },
  });
}
