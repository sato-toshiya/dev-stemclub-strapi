import { tokenExample, uuidExample } from './shared.mjs';

export function registerStudentOpenApi(registry, z, { UserSafe }) {
  const StudentLoginByQrRequest = registry.register(
    'StudentLoginByQrRequest',
    z
      .object({
        token: z.string().min(1).optional().openapi({
          description: 'QR token (preferred field name)',
          example: tokenExample(),
          maxLength: 255,
        }),
        qr_token: z.string().min(1).optional().openapi({
          description: 'QR token (legacy field name)',
          example: tokenExample(),
          maxLength: 255,
        }),
      })
      .refine((v) => Boolean(v.token || v.qr_token), {
        message: '`token` is required',
        path: ['token'],
      })
      .strict()
  );

  const StudentLoginStudent = registry.register(
    'StudentLoginStudent',
    z
      .object({
        id: z.number().int().openapi({ example: 26 }),
        documentId: z.string().openapi({ example: uuidExample(), maxLength: 64 }),

        name: z.string().openapi({ example: 'my full name', maxLength: 255 }),
        name_kana: z.string().openapi({ example: 'フリガナ', maxLength: 255 }),

        qr_token: z.string().openapi({ example: tokenExample(), maxLength: 255 }),

        users_permissions_user: UserSafe.openapi({
          description: 'Linked user (safe subset)',
        }),

        school_admin: z
          .object({
            id: z.number().int(),
            documentId: z.string(),
            name: z.string(),
          })
          .openapi({ description: 'Tenant school admin' }),

        class: z
          .object({
            id: z.number().int(),
            documentId: z.string(),
            name: z.string(),
          })
          .nullable()
          .optional()
          .openapi({ description: 'Student class (can be null)' }),
      })
      .catchall(z.unknown())
  );

  const StudentLoginByQrResponse = registry.register(
    'StudentLoginByQrResponse',
    z
      .object({
        jwt: z.string().openapi({ example: 'eyJhbGciOi...', description: 'JWT token' }),
        student: StudentLoginStudent,
      })
      .strict()
  );

  registry.registerPath({
    method: 'post',
    path: '/students/login-by-qr',
    summary: 'Login student by QR token',
    description: 'Accept token (or qr_token). Return JWT + student + user (without secrets).',
    tags: ['student'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: StudentLoginByQrRequest,
            example: { token: tokenExample() },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful login',
        content: {
          'application/json': {
            schema: StudentLoginByQrResponse,
            example: {
              jwt: 'eyJhbGciOi...',
              student: {
                id: 26,
                documentId: uuidExample(),
                name: 'my full name',
                name_kana: 'フリガナ',
                qr_token: tokenExample(),
                users_permissions_user: {
                  id: 55,
                  documentId: uuidExample(),
                  email: 'student_...@local.invalid',
                  phone: null,
                  blocked: false,
                },
                school_admin: {
                  id: 29,
                  documentId: uuidExample(),
                  name: 'School Admin 123',
                },
                class: {
                  id: 63,
                  documentId: uuidExample(),
                  name: 'class 10',
                },
              },
            },
          },
        },
      },
      400: { description: '`token` is required' },
      401: { description: 'Invalid QR / User is blocked' },
      500: { description: 'Internal server error' },
    },
  });

  const StudentMarkSeenRequest = registry.register(
    'StudentMarkSeenRequest',
    z
      .object({
        status: z.enum(['online', 'offline']).optional().openapi({
          description:
            'Optional presence hint. If omitted, defaults to "online". Use "offline" when app is backgrounded/logged out (best-effort).',
          example: 'online',
        }),
      })
      .strict()
  );

  const StudentMarkSeenResponse = registry.register(
    'StudentMarkSeenResponse',
    z
      .object({
        updated: z.boolean().openapi({
          description:
            'True if last_seen_at was updated in DB; false if throttled (e.g. called within 30s window). For status="offline", usually true.',
          example: true,
        }),
        status: z.enum(['online', 'offline']).openapi({
          description: 'Effective status processed by server.',
          example: 'online',
        }),
      })
      .strict()
  );

  registry.registerPath({
    method: 'post',
    path: '/students/mark-seen',
    summary: 'Mark student as recently active (last seen) or offline (best-effort)',
    description:
      'Update student.last_seen_at (throttled by server, e.g. once per 30 seconds). If status="offline", server forces last_seen_at older than threshold so presence becomes offline immediately.',
    tags: ['student'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: false,
        content: {
          'application/json': {
            schema: StudentMarkSeenRequest,
            example: { status: 'online' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: StudentMarkSeenResponse,
            examples: {
              online: { value: { updated: true, status: 'online' } },
              offline: { value: { updated: true, status: 'offline' } },
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
      404: { description: 'Student not found' },
      500: { description: 'Internal server error' },
    },
  });
}
