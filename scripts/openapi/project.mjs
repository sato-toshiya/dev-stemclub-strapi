import { registerMetaWithPagination } from './shared.mjs';

export function registerProjectOpenApi(registry, z) {
  const MetaWithPagination = registerMetaWithPagination(registry, z);

  const UploadFile = registry.register(
    'UploadFile',
    z
      .object({
        id: z
          .number()
          .int()
          .openapi({ example: 15, description: 'Upload file internal numeric id' }),
        documentId: z.string().openapi({
          example: 'yable8qc4u3dzyk991x398ng',
          description: 'Upload file documentId',
        }),
        name: z.string().openapi({ example: 'project.sjr', description: 'Original file name' }),
        ext: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: '.sjr', description: 'File extension' }),
        mime: z
          .string()
          .nullable()
          .optional()
          .openapi({ example: 'application/octet-stream', description: 'MIME type' }),
        size: z.number().openapi({
          example: 12.49,
          description: 'File size reported by upload plugin (often KB, may be float)',
        }),
        url: z.string().openapi({
          example: 'http://localhost:4566/pionero-ste-strapi-dev/project_hash.sjr',
          description: 'Public URL (built using baseUrl) or origin URL',
        }),
        provider: z.string().optional().openapi({
          example: '@strapi/provider-upload-aws-s3',
          description: 'Upload provider name',
        }),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      })
      .catchall(z.unknown())
  );

  const ProjectOwnerType = registry.register(
    'ProjectOwnerType',
    z.enum(['teacher', 'student']).openapi({ description: 'Who owns the project' })
  );

  const ProjectTeacher = registry.register(
    'ProjectTeacher',
    z
      .object({
        id: z.number().int().openapi({ example: 136 }),
        documentId: z.string().openapi({ example: 'xgwidpnpuhrcb9sjcbbswguf' }),
        name: z.string().openapi({ example: 'Name 3' }),
      })
      .catchall(z.unknown())
  );

  const ProjectStudent = registry.register(
    'ProjectStudent',
    z
      .object({
        id: z.number().int().openapi({ example: 88 }),
        documentId: z.string().openapi({ example: 'stu_doc_123' }),
        name: z.string().openapi({ example: 'Student A' }),
      })
      .catchall(z.unknown())
  );

  const ProjectItem = registry.register(
    'ProjectItem',
    z
      .object({
        id: z.number().int().openapi({ example: 4, description: 'Project internal numeric id' }),
        documentId: z
          .string()
          .openapi({ example: 'l5oo1h6coklygtqn7tagpyna', description: 'Project documentId' }),
        title: z.string().openapi({ example: 'title', description: 'Project title' }),
        description: z.string().nullable().optional().openapi({ example: null }),
        owner_type: ProjectOwnerType.openapi({ description: 'teacher|student' }),
        file_size: z.number().int().nullable().optional().openapi({
          example: 12490,
          description: 'File size in bytes (integer).',
        }),
        createdAt: z.string().openapi({ example: '2026-01-14T03:56:51.917Z' }),
        updatedAt: z.string().openapi({ example: '2026-01-14T03:56:51.917Z' }),
        publishedAt: z.string().nullable().optional(),
        sjr_file: UploadFile.openapi({ description: 'Uploaded .sjr file (media relation)' }),
        thumbnail: UploadFile.nullable()
          .optional()
          .openapi({ description: 'Thumbnail (optional)' }),
        teacher: ProjectTeacher.nullable()
          .optional()
          .openapi({ description: 'Populated when owner_type=teacher' }),
        student: ProjectStudent.nullable()
          .optional()
          .openapi({ description: 'Populated when owner_type=student' }),
      })
      .catchall(z.unknown())
  );

  const ProjectUploadResponse = registry.register(
    'ProjectUploadResponse',
    z
      .object({
        data: ProjectItem.openapi({ description: 'Created project' }),
      })
      .strict()
  );

  const ProjectEditResponse = registry.register(
    'ProjectEditResponse',
    z
      .object({
        data: ProjectItem.openapi({ description: 'Updated project' }),
      })
      .strict()
  );

  const ProjectsMyResponse = registry.register(
    'ProjectsMyResponse',
    z
      .object({
        data: z.array(ProjectItem).openapi({
          description: 'List projects owned by current user (teacher or student)',
        }),
        meta: MetaWithPagination,
      })
      .strict()
  );

  const ProjectEditMultipart = registry.register(
    'ProjectEditMultipart',
    z
      .object({
        title: z.string().optional().openapi({
          example: 'Updated title',
          description: 'New project title (optional)',
        }),
        description: z.string().optional().openapi({
          example: 'Updated description',
          description: 'New project description (optional)',
        }),
        sjr_file: z.any().optional().openapi({
          type: 'string',
          format: 'binary',
          description: '.sjr file (optional). If provided, replaces current sjr_file',
        }),
        thumbnail: z.any().optional().openapi({
          type: 'string',
          format: 'binary',
          description: 'thumbnail (optional). If provided, replaces current thumbnail',
        }),
      })
      .strict()
  );

  const ProjectUploadMultipart = registry.register(
    'ProjectUploadMultipart',
    z
      .object({
        title: z.string().openapi({ example: 'My Scratch Project', description: 'Project title' }),
        description: z.string().optional().openapi({ example: 'optional description' }),

        sjr_file: z
          .any()
          .openapi({ type: 'string', format: 'binary', description: '.sjr file (required)' }),
        thumbnail: z
          .any()
          .optional()
          .openapi({ type: 'string', format: 'binary', description: 'thumbnail (optional)' }),
      })
      .strict()
  );

  registry.registerPath({
    method: 'post',
    path: '/projects/upload',
    summary: 'Upload a project (.sjr + optional thumbnail) and create Project record',
    description:
      'Multipart upload endpoint. Server detects owner_type based on authenticated user: teacher -> owner_type=teacher, otherwise student -> owner_type=student. Stores media in S3/localstack via Strapi upload provider.',
    tags: ['project'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: ProjectUploadMultipart,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Created project',
        content: {
          'application/json': {
            schema: ProjectUploadResponse,
          },
        },
      },
      400: { description: 'ValidationError (missing title/sjr_file, invalid payload)' },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (user is not linked to teacher/student record)' },
      500: { description: 'Internal server error' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/projects/my',
    summary: 'List projects of current user',
    description:
      'Teacher gets teacher-owned projects, student gets student-owned projects. Supports pagination via pagination[page] & pagination[pageSize].',
    tags: ['project'],
    security: [{ bearerAuth: [] }],
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
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: ProjectsMyResponse,
          },
        },
      },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (user is not linked to teacher/student record)' },
      500: { description: 'Internal server error' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/projects/{id}/edit',
    summary: 'Edit a project (multipart) - replace sjr_file/thumbnail and/or update fields',
    description:
      'Path param {id} is project documentId. Only project owner (teacher/student) can edit. If sjr_file is uploaded, project.sjr_file is replaced. Note: class-assignment snapshots (assigned_*) are not modified.',
    tags: ['project'],
    security: [{ bearerAuth: [] }],
    request: {
      params: z
        .object({
          id: z.string().openapi({
            example: 'l5oo1h6coklygtqn7tagpyna',
            description: 'Project documentId',
          }),
        })
        .strict(),
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: ProjectEditMultipart,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated project',
        content: {
          'application/json': {
            schema: ProjectEditResponse,
          },
        },
      },
      400: { description: 'ValidationError (nothing to update / invalid payload)' },
      401: { description: 'Missing/invalid JWT (unauthorized)' },
      403: { description: 'Not allowed (not owner)' },
      404: { description: 'Project not found' },
      500: { description: 'Internal server error' },
    },
  });
}
