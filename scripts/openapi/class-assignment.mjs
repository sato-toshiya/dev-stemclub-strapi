import { registerMetaWithPagination } from './shared.mjs';

export function registerClassAssignmentOpenApi(registry, z) {
  const MetaWithPagination = registerMetaWithPagination(registry, z);

  const UploadFile = registry.register(
    'UploadFile_CA',
    z
      .object({
        id: z.number().int().openapi({ example: 16 }),
        documentId: z.string().openapi({ example: 'dzri6bxrhvp0zh67penppge0' }),
        name: z.string().openapi({ example: 'thumb.png' }),
        url: z
          .string()
          .openapi({ example: 'http://localhost:4566/pionero-ste-strapi-dev/thumb.png' }),
        size: z.number().openapi({ example: 0.81 }),
      })
      .catchall(z.unknown())
  );

  const ClassLite = registry.register(
    'ClassLite',
    z
      .object({
        id: z.number().int().openapi({ example: 20 }),
        documentId: z.string().openapi({ example: 'h17se30sf6d15ha6qlxz7hx7' }),
        name: z.string().openapi({ example: 'class 1' }),
      })
      .catchall(z.unknown())
  );

  const TeacherLite = registry.register(
    'TeacherLite',
    z
      .object({
        id: z.number().int().openapi({ example: 136 }),
        documentId: z.string().openapi({ example: 'xgwidpnpuhrcb9sjcbbswguf' }),
        name: z.string().openapi({ example: 'Name 3' }),
      })
      .catchall(z.unknown())
  );

  const ProjectLite = registry.register(
    'ProjectLite',
    z
      .object({
        id: z.number().int().openapi({ example: 4 }),
        documentId: z.string().openapi({ example: 'l5oo1h6coklygtqn7tagpyna' }),
        title: z.string().openapi({ example: 'Project Title' }),
        thumbnail: UploadFile.nullable()
          .optional()
          .openapi({ description: 'Project thumbnail (optional)' }),
        sjr_file: UploadFile.nullable().optional().openapi({
          description:
            'Project sjr file (optional populate). NOTE: students should use assigned_sjr_file from class-assignment (snapshot) instead.',
        }),
      })
      .catchall(z.unknown())
  );

  const ClassAssignmentItem = registry.register(
    'ClassAssignmentItem',
    z
      .object({
        id: z.number().int().openapi({ example: 101 }),
        documentId: z.string().openapi({ example: 'ca_doc_123' }),
        assigned_at: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '2026-01-14T03:56:51.917Z' }),

        assigned_title: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: 'Project Title (snapshot)' }),

        assigned_sjr_file: UploadFile.openapi({
          description: 'Snapshot sjr file at assign time (student must use this)',
        }),

        assigned_thumbnail: UploadFile.nullable()
          .optional()
          .openapi({ description: 'Snapshot thumbnail at assign time (optional)' }),

        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),

        class: ClassLite.openapi({ description: 'Target class' }),
        project: ProjectLite.openapi({
          description:
            'Source teacher project (may be edited later; student should not rely on project.sjr_file)',
        }),
        teacher: TeacherLite.optional().openapi({
          description: 'Assigning teacher (sometimes populated)',
        }),
      })
      .catchall(z.unknown())
  );

  const ClassAssignmentItemStudent = registry.register(
    'ClassAssignmentItemStudent',
    z
      .object({
        id: z.number().int().openapi({ example: 101 }),
        documentId: z.string().openapi({ example: 'ca_doc_123' }),
        assigned_at: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '2026-02-04T09:25:23.198Z' }),

        assigned_title: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: 'Project Title (snapshot)' }),

        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),

        class: ClassLite.openapi({ description: 'Target class' }),
        teacher: TeacherLite.optional().openapi({ description: 'Assigning teacher' }),

        assigned_sjr_file: UploadFile.openapi({
          description: 'Snapshot sjr file at assign time (student must use this)',
        }),
        assigned_thumbnail: UploadFile.nullable().optional().openapi({
          description: 'Snapshot thumbnail at assign time (optional)',
        }),
      })
      .catchall(z.unknown())
  );

  const AssignRequest = registry.register(
    'ClassAssignmentAssignRequest',
    z
      .object({
        class: z
          .string()
          .openapi({ example: 'h17se30sf6d15ha6qlxz7hx7', description: 'Class documentId' }),
        projectIds: z
          .array(z.string())
          .min(1)
          .openapi({
            example: ['proj_doc_1', 'proj_doc_2'],
            description: 'Teacher project documentIds',
          }),
      })
      .strict()
  );

  const AssignResponse = registry.register(
    'ClassAssignmentAssignResponse',
    z
      .object({
        data: z.array(ClassAssignmentItem).openapi({
          description: 'Created or existing class-assignment rows (duplicates skipped)',
        }),
      })
      .strict()
  );

  const MyClassAssignmentsResponse = registry.register(
    'MyClassAssignmentsResponse',
    z
      .object({
        data: z.array(ClassAssignmentItem),
        meta: MetaWithPagination.openapi({ description: 'Pagination info (Strapi-like)' }),
      })
      .strict()
  );

  const StudentClassAssignmentsResponse = registry.register(
    'StudentClassAssignmentsResponse',
    z
      .object({
        data: z.array(ClassAssignmentItemStudent).openapi({
          description: "Assignments for student's current class (uses snapshot fields assigned_*)",
        }),
        meta: MetaWithPagination.openapi({ description: 'Pagination info (Strapi-like)' }),
      })
      .strict()
  );

  const SubmitRequest = registry.register(
    'ClassAssignmentSubmitRequest',
    z
      .object({
        project: z.string().openapi({
          example: 'student_project_doc_123',
          description: 'Student project documentId to submit',
        }),
      })
      .strict()
  );

  const SubmissionItem = registry.register(
    'AssignmentSubmissionItem',
    z
      .object({
        id: z.number().int().openapi({ example: 5001 }),
        documentId: z.string().openapi({ example: 'sub_doc_abc' }),
        submitted_at: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '2026-01-14T03:56:51.917Z' }),
        student: z.any().optional().openapi({
          description: 'Populated student (shape depends on your populate)',
        }),
        class_assignment: z.any().optional().openapi({
          description: 'Populated class-assignment (optional; includes assigned_* snapshot fields)',
        }),
        project: z.any().optional().openapi({
          description: 'Populated submitted project (optional)',
        }),
      })
      .catchall(z.unknown())
  );

  const SubmitResponse = registry.register(
    'ClassAssignmentSubmitResponse',
    z
      .object({
        data: SubmissionItem.openapi({ description: 'Created or updated submission' }),
      })
      .strict()
  );

  registry.registerPath({
    method: 'post',
    path: '/class-assignments/assign',
    summary: 'Teacher assigns 1..n teacher projects to 1 class',
    description:
      'Body contains class documentId and an array of teacher project documentIds. Server validates: class belongs to teacher, class is in active academic year, projects belong to teacher (owner_type=teacher). Server snapshots assigned_sjr_file/assigned_title/assigned_thumbnail at assign time so later project edits do not affect students.',
    tags: ['class-assignment'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: AssignRequest,
            example: {
              class: 'h17se30sf6d15ha6qlxz7hx7',
              projectIds: ['proj_doc_1', 'proj_doc_2'],
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Created/Existing class assignments',
        content: { 'application/json': { schema: AssignResponse } },
      },
      400: { description: 'ValidationError (invalid class/projectIds, no active AY, etc.)' },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (not a teacher, tenant mismatch, etc.)' },
      500: { description: 'Internal server error' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/class-assignments/my',
    summary: 'Teacher lists class assignments they created',
    description:
      'Optional query: ?class=<classDocumentId> to filter. Supports pagination via pagination[page] & pagination[pageSize]. Returns snapshot fields assigned_* to show what was assigned at the time.',
    tags: ['class-assignment'],
    security: [{ bearerAuth: [] }],
    request: {
      query: z
        .object({
          class: z.string().optional().openapi({
            example: 'h17se30sf6d15ha6qlxz7hx7',
            description: 'Optional class documentId filter',
          }),
          'pagination[page]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ example: 1, description: 'Page number (>=1). Default 1.' }),
          'pagination[pageSize]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ example: 10, description: 'Items per page (1..100). Default 10.' }),
        })
        .partial(),
    },
    responses: {
      200: {
        description: 'Successful response',
        content: { 'application/json': { schema: MyClassAssignmentsResponse } },
      },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (not a teacher)' },
      500: { description: 'Internal server error' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/class-assignments/for-student',
    request: {
      query: z
        .object({
          'pagination[page]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ example: 1, description: 'Page number (>=1). Default 1.' }),
          'pagination[pageSize]': z
            .union([z.string(), z.number()])
            .optional()
            .openapi({ example: 10, description: 'Items per page (1..100). Default 10.' }),
        })
        .partial(),
    },
    summary: 'Student lists assignments for their class',
    description:
      "Returns class assignments where class = student's current class. Student must use assigned_sjr_file (snapshot) instead of project.sjr_file. Supports pagination via pagination[page] & pagination[pageSize].",
    tags: ['class-assignment'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Successful response',
        content: { 'application/json': { schema: StudentClassAssignmentsResponse } },
      },
      400: { description: 'Student has no class' },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (not a student)' },
      500: { description: 'Internal server error' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/class-assignments/{id}/submit',
    summary: 'Student submits a project to a class assignment',
    description:
      'Path param {id} is class-assignment documentId. Body contains student project documentId. Server validates class membership and project ownership (owner_type=student). Upserts submission by (student + class_assignment).',
    tags: ['class-assignment'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z
        .object({
          id: z
            .string()
            .openapi({ example: 'ca_doc_123', description: 'class-assignment documentId' }),
        })
        .strict(),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: SubmitRequest,
            example: { project: 'student_project_doc_123' },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Created/updated submission',
        content: { 'application/json': { schema: SubmitResponse } },
      },
      400: {
        description:
          'ValidationError (missing params/body, student has no class, invalid project, etc.)',
      },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (not in class, not student, etc.)' },
      404: { description: 'Class assignment not found' },
      500: { description: 'Internal server error' },
    },
  });
}
