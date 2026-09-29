import { registerPagination, uuidExample } from './shared.mjs';

export function registerTeacherOpenApi(registry, z, { UserSafe }) {
  const TeacherLoginByPasscodeRequest = registry.register(
    'TeacherLoginByPasscodeRequest',
    z
      .object({
        passcode: z
          .string()
          .regex(/^\d{6}$/)
          .openapi({
            description: '6-digit passcode',
            example: '123456',
            maxLength: 6,
          }),
      })
      .strict()
  );

  const TeacherLoginTeacher = registry.register(
    'TeacherLoginTeacher',
    z
      .object({
        id: z.number().int().openapi({ example: 34, description: 'Teacher internal numeric id' }),
        documentId: z
          .uuid()
          .openapi({ example: uuidExample(), description: 'Teacher documentId (UUID)' }),
        name: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: 'Nguyen Van A', maxLength: 255, description: 'Teacher name' }),
        passcode: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '123456', maxLength: 6, description: '6-digit passcode' }),
      })
      .catchall(z.unknown())
  );

  const TeacherLoginByPasscodeResponse = registry.register(
    'TeacherLoginByPasscodeResponse',
    z
      .object({
        jwt: z.string().openapi({ example: 'eyJhbGciOi...', description: 'JWT token' }),
        teacher: TeacherLoginTeacher,
        user: UserSafe,
      })
      .strict()
  );

  registry.registerPath({
    method: 'post',
    path: '/teachers/login-by-passcode',
    summary: 'Login teacher by 6-digit passcode',
    description: 'Return JWT + teacher + user (without secrets).',
    tags: ['teacher'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: TeacherLoginByPasscodeRequest,
            example: { passcode: '123456' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful login',
        content: {
          'application/json': {
            schema: TeacherLoginByPasscodeResponse,
            example: {
              jwt: 'eyJhbGciOi...',
              teacher: {
                id: 34,
                documentId: uuidExample(),
                name: 'Nguyen Van A',
                passcode: '123456',
              },
              user: {
                id: 12,
                email: 'teacher@example.com',
                username: 'teacher@example.com',
                phone: '0900000000',
                blocked: false,
                confirmed: true,
                provider: 'local',
              },
            },
          },
        },
      },
      400: { description: '`passcode` must be 6 digits' },
      401: { description: 'Invalid passcode / User is blocked' },
      500: { description: 'Internal server error' },
    },
  });

  const TeacherStudentPresenceStatus = registry.register(
    'TeacherStudentPresenceStatus',
    z.enum(['online', 'offline', 'unknown']).openapi({
      description: 'Presence computed from last_seen_age_seconds',
      example: 'online',
    })
  );

  const TeacherStudentPresenceItem = registry.register(
    'TeacherStudentPresenceItem',
    z
      .object({
        id: z.number().int().openapi({ example: 26 }),
        documentId: z.string().openapi({ example: 'oqvag31avils00sje3703l7f', maxLength: 64 }),
        name: z.string().openapi({ example: 'my full name 211', maxLength: 255 }),
        name_kana: z.string().openapi({ example: 'フリガナ', maxLength: 255 }),
        last_seen_at: z
          .string()
          .datetime()
          .nullable()
          .openapi({ example: '2026-01-21T02:02:25.361Z', description: 'UTC timestamp' }),
        last_seen_age_seconds: z
          .number()
          .int()
          .nullable()
          .openapi({ example: 2, description: 'Seconds since last_seen_at (server computed)' }),
        presence_status: TeacherStudentPresenceStatus,
      })
      .strict()
  );

  const Pagination = registerPagination(registry, z);

  const TeacherClassStudentsPresenceResponse = registry.register(
    'TeacherClassStudentsPresenceResponse',
    z
      .object({
        data: z.array(TeacherStudentPresenceItem),
        meta: z
          .object({
            server_time: z
              .string()
              .datetime()
              .openapi({ example: '2026-01-21T09:02:28.122Z', description: 'Server time (UTC)' }),
            presence: z
              .object({
                online_threshold_seconds: z.number().int().openapi({ example: 120 }),
                online_count: z.number().int().openapi({
                  example: 1,
                  description: 'Online students in the whole class (not paginated)',
                }),
                total_count: z.number().int().openapi({
                  example: 3,
                  description: 'Total students in the whole class (not paginated)',
                }),
              })
              .strict(),

            pagination: Pagination,
            class: z
              .object({
                documentId: z
                  .string()
                  .openapi({ example: 'zig0ji0e5a40vw9uxo1m19e2', maxLength: 64 }),
                name: z.string().openapi({ example: 'class 10', maxLength: 255 }),
              })
              .strict(),
          })
          .strict(),
      })
      .strict()
  );

  registry.registerPath({
    method: 'get',
    path: '/teachers/class-students-presence',
    summary: 'Poll students presence in a class',
    description:
      'Return students in a class with computed presence status based on last_seen_at. Requires teacher JWT.',
    tags: ['teacher'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z
        .object({
          class: z.string().min(1).openapi({
            description: 'Class documentId',
            example: 'zig0ji0e5a40vw9uxo1m19e2',
            maxLength: 64,
          }),
          online_threshold: z.union([z.string(), z.number()]).optional().openapi({
            description: 'Online threshold in seconds (default 120).',
            example: 120,
          }),
          'pagination[page]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ description: 'Page (1-based).', example: 1 }),
          'pagination[pageSize]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ description: 'Page size.', example: 10 }),
        })
        .catchall(z.unknown()),
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: TeacherClassStudentsPresenceResponse,
            example: {
              data: [
                {
                  id: 26,
                  documentId: 'oqvag31avils00sje3703l7f',
                  name: 'my full name 211',
                  name_kana: 'フリガナ',
                  last_seen_at: '2026-01-21T02:02:25.361Z',
                  last_seen_age_seconds: 2,
                  presence_status: 'online',
                },
              ],
              meta: {
                server_time: '2026-01-21T09:02:28.122Z',
                presence: { online_threshold_seconds: 120, online_count: 1, total_count: 3 },
                pagination: { page: 1, pageSize: 50, pageCount: 1, total: 3 },
                class: { documentId: 'zig0ji0e5a40vw9uxo1m19e2', name: 'class 10' },
              },
            },
          },
        },
      },
      400: { description: 'Invalid query (missing/invalid class documentId)' },
      401: { description: 'Unauthorized' },
      403: { description: 'Not allowed (teacher not linked to class / tenant mismatch)' },
      500: { description: 'Internal server error' },
    },
  });
}
