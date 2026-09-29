import { factories } from '@strapi/strapi';
import { getTenantSchoolAdmin } from '../../../utils/tenant';
import { toRecord } from '../../../utils/values/record';
import { parsePagination } from '../../../utils/http/pagination';
import { makeShareToken } from '../../../utils/tokens';
import { collectFileUrls, deleteS3ObjectsByUrls } from '../../../utils/s3-delete';
import { UID } from '../../../constants/uids';
import { ensureAuthUserId } from '../../../utils/auth/user';
import { ensureAutoUniqueTitleForOwner, ensureUniqueTitleForOwner } from '../services/title';
import { resolveActorByUserId } from '../../../utils/auth/resolve-actor';
import { getRelationJoinTable } from '../../../utils/strapi/relations';

const buildOrderBy = (sortKey: string | null) => {
  switch (sortKey) {
    case 'oldest':
      return { createdAt: 'asc' };
    case 'title_asc':
      return { title: 'asc' };
    case 'title_desc':
      return { title: 'desc' };
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
};

const isSixDigit = (v: unknown) => typeof v === 'string' && /^\d{6}$/.test(v.trim());
const dayFormat = /^\d{4}-\d{2}-\d{2}$/;
const DAY_SHARE_PREFIX = 'd.';
const DAY_SHARE_STORE = 'project-day-share';

type DayRangeUtc = { startIso: string; endIso: string };
type DaySharePayload = {
  classDocumentId: string;
  day: string;
  ownerSchoolAdminDocumentId: string;
  expires_at: string;
};

const getUtcDayRange = (day: string): DayRangeUtc | null => {
  if (!dayFormat.test(day)) return null;

  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  if (start.toISOString().slice(0, 10) !== day) return null;

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

export default factories.createCoreController(UID.project, ({ strapi }) => ({
  async uploadProjectMultipart(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const actor = await resolveActorByUserId(strapi, userId);
    if (!actor) return ctx.forbidden('この操作を行う権限がありません');

    const ownerType = actor.kind;
    const ownerId = ownerType === 'teacher' ? actor.teacher.id : actor.student.id;

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    if (!title) return ctx.badRequest('`title` は必須です');

    const description = typeof body.description === 'string' ? body.description : null;

    const files = ctx.request.files ?? {};
    const sjrFile = files.sjr_file;
    const thumbFile = files.thumbnail;

    if (!sjrFile) return ctx.badRequest('`sjr_file` は必須です');
    if (!thumbFile) return ctx.badRequest('`thumbnail` は必須です');

    const uploadService = strapi.plugin('upload').service('upload');

    const uploadedSjr = await uploadService.upload({
      data: { fileInfo: { folderPath: '/media/projects' } },
      files: sjrFile,
    });

    const sjrId = uploadedSjr?.[0]?.id as number | undefined;
    const uploadedSize = uploadedSjr?.[0]?.size as number | undefined;
    if (!sjrId) return ctx.internalServerError('sjr ファイルのアップロードに失敗しました');

    const uploadedThumb = await uploadService.upload({
      data: { fileInfo: { folderPath: '/media/thumbs' } },
      files: thumbFile,
    });

    const thumbId = (uploadedThumb?.[0]?.id as number | undefined) ?? null;
    if (!thumbId) return ctx.internalServerError('サムネイルのアップロードに失敗しました');

    const finalTitle = await ensureAutoUniqueTitleForOwner(strapi, {
      ownerType,
      ownerId,
      title,
    });

    const created = await strapi.documents(UID.project).create({
      data: {
        title: finalTitle,
        description,
        owner_type: ownerType,
        teacher: ownerType === 'teacher' ? ownerId : null,
        student: ownerType === 'student' ? ownerId : null,
        sjr_file: sjrId,
        thumbnail: thumbId,
        file_size: typeof uploadedSize === 'number' ? uploadedSize : null,
      },
      status: 'published',
      populate: {
        sjr_file: true,
        thumbnail: true,
        teacher: { fields: ['documentId', 'name'] },
        student: { fields: ['documentId', 'name'] },
      },
    });

    ctx.body = { data: created };
  },

  async myProjects(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const actor = await resolveActorByUserId(strapi, userId);
    if (!actor) return ctx.forbidden('この操作を行う権限がありません');

    const where =
      actor.kind === 'teacher'
        ? { owner_type: 'teacher', teacher: actor.teacher.id }
        : { owner_type: 'student', student: actor.student.id };

    const { page, pageSize, offset } = parsePagination(ctx, {
      maxPageSize: 100,
      defaultPageSize: 10,
    });

    const total = await strapi.db.query(UID.project).count({ where });

    const rows = await strapi.db.query(UID.project).findMany({
      where,
      offset,
      limit: pageSize,
      select: [
        'id',
        'documentId',
        'title',
        'description',
        'owner_type',
        'file_size',
        'createdAt',
        'updatedAt',
      ],
      populate: {
        thumbnail: true,
        sjr_file: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    ctx.body = {
      data: rows ?? [],
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: pageSize ? Math.ceil(total / pageSize) : 0,
          total,
        },
      },
    };
  },

  async editProjectMultipart(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const actor = await resolveActorByUserId(strapi, userId);
    if (!actor) return ctx.forbidden('この操作を行う権限がありません');

    const projectDocId = String(ctx.params?.id ?? '').trim();
    if (!projectDocId) return ctx.badRequest('project の documentId が指定されていません');

    const projectRow = await strapi.db.query(UID.project).findOne({
      where: { documentId: projectDocId },
      select: ['id', 'documentId', 'owner_type'],
      populate: {
        teacher: { select: ['id'] },
        student: { select: ['id'] },
        sjr_file: { select: ['id'] },
        thumbnail: { select: ['id'] },
      },
    });

    if (!projectRow?.id) return ctx.notFound('プロジェクトが見つかりません');

    if (actor.kind === 'teacher') {
      if (projectRow.owner_type !== 'teacher' || projectRow.teacher?.id !== actor.teacher.id) {
        return ctx.forbidden('この操作を行う権限がありません');
      }
    } else {
      if (projectRow.owner_type !== 'student' || projectRow.student?.id !== actor.student.id) {
        return ctx.forbidden('この操作を行う権限がありません');
      }
    }

    const oldSjrId = projectRow?.sjr_file?.id as number | undefined;
    const oldThumbId = projectRow?.thumbnail?.id as number | undefined;

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const titleRaw = body.title;
    const descRaw = body.description;

    const title = typeof titleRaw === 'string' ? titleRaw.trim() : undefined;
    const description = typeof descRaw === 'string' ? descRaw : undefined;

    const files = ctx.request.files ?? {};
    const sjrFile = files.sjr_file;
    const thumbFile = files.thumbnail;

    let finalTitle: string | undefined;

    if (typeof title === 'string' && title) {
      const ownerType = projectRow.owner_type as 'teacher' | 'student';
      const ownerId =
        ownerType === 'teacher' ? Number(projectRow.teacher?.id) : Number(projectRow.student?.id);

      if (!ownerId) return ctx.internalServerError('プロジェクトの所有者情報が見つかりません');

      finalTitle = await ensureAutoUniqueTitleForOwner(strapi, {
        ownerType,
        ownerId,
        title,
        excludeProjectId: Number(projectRow.id),
      });
    }

    if (!oldThumbId && !thumbFile) {
      return ctx.badRequest('`thumbnail` は必須です');
    }

    const uploadService = strapi.plugin('upload').service('upload');

    let sjrId: number | undefined;
    let uploadedSize: number | undefined;

    if (sjrFile) {
      const uploadedSjr = await uploadService.upload({
        data: { fileInfo: { folderPath: '/media/projects' } },
        files: sjrFile,
      });
      sjrId = uploadedSjr?.[0]?.id as number | undefined;
      uploadedSize = uploadedSjr?.[0]?.size as number | undefined;
      if (!sjrId) return ctx.internalServerError('sjr ファイルのアップロードに失敗しました');
    }

    let thumbId: number | null | undefined;
    if (thumbFile) {
      const uploadedThumb = await uploadService.upload({
        data: { fileInfo: { folderPath: '/media/thumbs' } },
        files: thumbFile,
      });
      thumbId = (uploadedThumb?.[0]?.id as number | undefined) ?? null;
      if (!thumbId) return ctx.internalServerError('サムネイルのアップロードに失敗しました');
    }

    const data: Record<string, unknown> = {};
    if (finalTitle !== undefined) data.title = finalTitle;
    if (description !== undefined) data.description = description;
    if (sjrId !== undefined) {
      data.sjr_file = sjrId;
      data.file_size = typeof uploadedSize === 'number' ? uploadedSize : null;
    }
    if (thumbId !== undefined) data.thumbnail = thumbId;

    if (Object.keys(data).length === 0) {
      return ctx.badRequest('更新対象の項目がありません');
    }

    const updated = await strapi.documents(UID.project).update({
      documentId: projectDocId,
      data,
      status: 'published',
      populate: {
        sjr_file: true,
        thumbnail: true,
        teacher: { fields: ['documentId', 'name'] },
        student: { fields: ['documentId', 'name'] },
      },
    });

    const upload = strapi.plugin('upload').service('upload');
    const bucket = process.env.AWS_S3_BUCKET || 'pionero-ste-strapi-dev';

    const loadUploadFile = async (id?: number) => {
      if (!id) return null;
      return strapi.db.query('plugin::upload.file').findOne({ where: { id } });
    };

    const removeOldFileHard = async (oldId?: number, label?: string) => {
      if (!oldId) return;

      try {
        const f = await loadUploadFile(oldId);
        const urls = f ? collectFileUrls(f) : [];

        if (urls.length) {
          await deleteS3ObjectsByUrls({
            bucket,
            urls,
            log: (msg, extra) => {
              if (extra) strapi.log.warn(msg, extra);
              else strapi.log.info(msg);
            },
          });
        }

        await upload.remove({ id: oldId });
      } catch (e) {
        strapi.log.error(`[project.edit] remove old ${label ?? 'file'} failed id=${oldId}`, e);
      }
    };

    if (sjrId && oldSjrId && oldSjrId !== sjrId) {
      await removeOldFileHard(oldSjrId, 'sjr_file');
    }

    if (thumbId != null && oldThumbId && oldThumbId !== thumbId) {
      await removeOldFileHard(oldThumbId, 'thumbnail');
    }

    ctx.body = { data: updated };
  },

  async listByStudent(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const q = toRecord(ctx.query);
    const studentDocId = typeof q.student === 'string' ? q.student.trim() : '';
    if (!studentDocId) return ctx.badRequest('`student` (documentId) は必須です');

    const student = await strapi.db.query(UID.student).findOne({
      where: { documentId: studentDocId },
      select: ['id', 'documentId', 'name'],
      populate: {
        school_admin: { select: ['documentId'] },
        class: { select: ['documentId', 'name'] },
      },
    });

    if (!student?.id) return ctx.badRequest('`student` (documentId) が不正です');

    const ownerSaDocId = student?.school_admin?.documentId;
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const { page, pageSize, offset } = parsePagination(ctx);

    const from = typeof q.from === 'string' ? q.from.trim() : '';
    const to = typeof q.to === 'string' ? q.to.trim() : '';
    const sortKey = typeof q.sortKey === 'string' ? q.sortKey.trim() : null;

    const where: Record<string, unknown> = {
      student: student.id,
    };

    if (from || to) {
      where.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const total = await strapi.db.query(UID.project).count({ where });

    const rows = await strapi.db.query(UID.project).findMany({
      where,
      offset,
      limit: pageSize,
      select: ['id', 'documentId', 'title', 'file_size', 'createdAt', 'updatedAt'],
      populate: {
        thumbnail: true,
        sjr_file: true,
      },
      orderBy: buildOrderBy(sortKey),
    });

    ctx.body = {
      data: rows ?? [],
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: pageSize ? Math.ceil(total / pageSize) : 0,
          total,
        },
        student: {
          documentId: student.documentId,
          name: student.name ?? '-',
          class: student.class
            ? { documentId: student.class.documentId, name: student.class.name ?? '-' }
            : null,
        },
      },
    };
  },

  async listByClass(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const q = toRecord(ctx.query);
    const classDocId = typeof q.class === 'string' ? q.class.trim() : '';
    if (!classDocId) return ctx.badRequest('`class` (documentId) は必須です');

    const cls = await strapi.db.query(UID.class).findOne({
      where: { documentId: classDocId },
      select: ['id', 'documentId', 'name'],
      populate: {
        academic_year: {
          select: ['id'],
          populate: {
            school_admin: { select: ['documentId'] },
          },
        },
      },
    });

    const classId = cls?.id as number | undefined;
    if (!classId) return ctx.badRequest('`class` (documentId) が不正です');

    const ownerSaDocId = cls?.academic_year?.school_admin?.documentId;
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const students = await strapi.db.query(UID.student).findMany({
      where: { class: classId },
      select: ['id'],
    });

    const studentIds = (students ?? [])
      .map((s) => (typeof s?.id === 'number' ? s.id : null))
      .filter((x): x is number => typeof x === 'number');

    if (!studentIds.length) {
      const { page, pageSize } = parsePagination(ctx);
      ctx.body = {
        data: [],
        meta: {
          pagination: { page, pageSize, pageCount: 0, total: 0 },
          class: { documentId: cls.documentId, name: cls.name ?? '-' },
        },
      };
      return;
    }

    const { page, pageSize, offset } = parsePagination(ctx);

    const from = typeof q.from === 'string' ? q.from.trim() : '';
    const to = typeof q.to === 'string' ? q.to.trim() : '';
    const sortKey = typeof q.sortKey === 'string' ? q.sortKey.trim() : null;

    const where: Record<string, unknown> = {
      owner_type: 'student',
      student: { id: { $in: studentIds } },
    };

    if (from || to) {
      where.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const total = await strapi.db.query(UID.project).count({ where });

    const rows = await strapi.db.query(UID.project).findMany({
      where,
      offset,
      limit: pageSize,
      select: ['id', 'documentId', 'title', 'file_size', 'createdAt', 'updatedAt'],
      populate: {
        thumbnail: true,
        sjr_file: true,
        student: { select: ['documentId', 'name', 'code'] },
      },
      orderBy: buildOrderBy(sortKey),
    });

    ctx.body = {
      data: rows ?? [],
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: pageSize ? Math.ceil(total / pageSize) : 0,
          total,
        },
        class: {
          documentId: cls.documentId,
          name: cls.name ?? '-',
        },
      },
    };
  },

  async listClassDaysByMonth(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const q = toRecord(ctx.query);

    const classDocId = typeof q.class === 'string' ? q.class.trim() : '';
    if (!classDocId) return ctx.badRequest('`class` (documentId) は必須です');

    const month = typeof q.month === 'string' ? q.month.trim() : '';
    if (!month) return ctx.badRequest('`month` (YYYY-MM) は必須です');
    if (!/^\d{4}-\d{2}$/.test(month)) return ctx.badRequest('`month` (YYYY-MM) が不正です');

    const cls = await strapi.db.query(UID.class).findOne({
      where: { documentId: classDocId },
      select: ['id', 'documentId', 'name'],
      populate: {
        academic_year: {
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        },
      },
    });

    const classId = cls?.id as number | undefined;
    if (!classId) return ctx.badRequest('`class` (documentId) が不正です');

    const ownerSaDocId = cls?.academic_year?.school_admin?.documentId;
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const startIso = `${month}-01T00:00:00.000Z`;
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return ctx.badRequest('`month` (YYYY-MM) が不正です');

    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const knex = strapi.db.connection;

    const jtProjectStudent = getRelationJoinTable(strapi, UID.project, 'student');
    const jtStudentClass = getRelationJoinTable(strapi, UID.student, 'class');

    const rows = (await knex('projects as p')
      .join(`${jtProjectStudent.table} as ps`, `ps.${jtProjectStudent.sourceCol}`, 'p.id')
      .join(
        `${jtStudentClass.table} as sc`,
        `sc.${jtStudentClass.sourceCol}`,
        `ps.${jtProjectStudent.targetCol}`
      )
      .where(`sc.${jtStudentClass.targetCol}`, classId)
      .andWhere('p.owner_type', 'student')
      .andWhere('p.created_at', '>=', start.toISOString())
      .andWhere('p.created_at', '<', end.toISOString())
      .groupByRaw(`to_char(timezone('utc', p.created_at), 'YYYY-MM-DD')`)
      .select([
        knex.raw(`to_char(timezone('utc', p.created_at), 'YYYY-MM-DD') as day`),
        knex.raw(`count(*)::int as count`),
      ])
      .orderBy([{ column: 'day', order: 'desc' }])) as Array<{
      day?: unknown;
      count?: unknown;
    }>;

    ctx.body = {
      data: rows.map((r) => ({
        day: String(r.day ?? ''),
        count: Number(r.count ?? 0),
      })),
      meta: {
        class: { documentId: cls.documentId, name: cls.name ?? '-' },
        month,
        range: { from: start.toISOString(), to: end.toISOString() },
      },
    };
  },

  async adminDelete(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const projectDocId = String(ctx.params?.id ?? '').trim();
    if (!projectDocId) return ctx.badRequest('project の documentId が指定されていません');

    const projectRow = await strapi.db.query(UID.project).findOne({
      where: { documentId: projectDocId },
      select: ['id', 'documentId', 'owner_type'],
      populate: {
        teacher: { select: ['id'], populate: { school_admin: { select: ['documentId'] } } },
        student: { select: ['id'], populate: { school_admin: { select: ['documentId'] } } },
        sjr_file: { select: ['id'] },
        thumbnail: { select: ['id'] },
      },
    });

    if (!projectRow?.id) return ctx.notFound('プロジェクトが見つかりません');

    const ownerSaDocId =
      projectRow.owner_type === 'teacher'
        ? projectRow.teacher?.school_admin?.documentId
        : projectRow.student?.school_admin?.documentId;

    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const oldSjrId = projectRow?.sjr_file?.id as number | undefined;
    const oldThumbId = projectRow?.thumbnail?.id as number | undefined;

    const sjrFile = oldSjrId
      ? await strapi.db.query('plugin::upload.file').findOne({ where: { id: oldSjrId } })
      : null;

    const thumbFile = oldThumbId
      ? await strapi.db.query('plugin::upload.file').findOne({ where: { id: oldThumbId } })
      : null;

    await strapi.documents(UID.project).delete({ documentId: projectDocId });

    const bucket = process.env.AWS_S3_BUCKET || 'pionero-ste-strapi-dev';

    try {
      const sjrUrls = sjrFile ? collectFileUrls(sjrFile) : [];
      const thumbUrls = thumbFile ? collectFileUrls(thumbFile) : [];

      await deleteS3ObjectsByUrls({
        bucket,
        urls: [...sjrUrls, ...thumbUrls],
        log: (msg, extra) => {
          if (extra) strapi.log.warn(msg, extra);
          else strapi.log.info(msg);
        },
      });
    } catch (e) {
      strapi.log.error('[adminDelete] S3 delete phase failed', e);
    }

    const upload = strapi.plugin('upload').service('upload');

    if (oldSjrId) {
      try {
        await upload.remove({ id: oldSjrId });
      } catch (e) {
        strapi.log.error(`[adminDelete] upload.remove sjr failed id=${oldSjrId}`, e);
      }
    }

    if (oldThumbId) {
      try {
        await upload.remove({ id: oldThumbId });
      } catch (e) {
        strapi.log.error(`[adminDelete] upload.remove thumb failed id=${oldThumbId}`, e);
      }
    }

    ctx.body = { data: { documentId: projectDocId } };
  },

  async adminRename(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const projectDocId = String(ctx.params?.id ?? '').trim();
    if (!projectDocId) return ctx.badRequest('project の documentId が指定されていません');

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    if (!title) return ctx.badRequest('`title` は必須です');

    const projectRow = await strapi.db.query(UID.project).findOne({
      where: { documentId: projectDocId },
      select: ['id', 'documentId', 'owner_type'],
      populate: {
        teacher: {
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        },
        student: {
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        },
      },
    });

    if (!projectRow?.id) return ctx.notFound('プロジェクトが見つかりません');

    const ownerSaDocId =
      projectRow.owner_type === 'teacher'
        ? projectRow.teacher?.school_admin?.documentId
        : projectRow.student?.school_admin?.documentId;

    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const ownerType = projectRow.owner_type as 'teacher' | 'student';
    const ownerId =
      ownerType === 'teacher' ? Number(projectRow.teacher?.id) : Number(projectRow.student?.id);
    if (!ownerId) return ctx.internalServerError('プロジェクトの所有者情報が見つかりません');

    try {
      await ensureUniqueTitleForOwner(strapi, {
        ownerType,
        ownerId,
        title,
        excludeProjectId: Number(projectRow.id),
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'DUPLICATE_TITLE') {
        return ctx.badRequest('同じタイトルが既に存在します');
      }
      throw e;
    }

    const updated = await strapi.documents(UID.project).update({
      documentId: projectDocId,
      data: { title },
      status: 'published',
    });

    ctx.body = { data: updated };
  },

  async adminTransferStudent(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const projectDocId = String(ctx.params?.id ?? '').trim();
    if (!projectDocId) return ctx.badRequest('project の documentId が指定されていません');

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const toStudentDocId = typeof body.toStudent === 'string' ? body.toStudent.trim() : '';
    if (!toStudentDocId) return ctx.badRequest('`toStudent` (documentId) は必須です');

    const projectRow = await strapi.db.query(UID.project).findOne({
      where: { documentId: projectDocId },
      select: ['id', 'documentId', 'title', 'owner_type'],
      populate: {
        student: {
          select: ['id', 'documentId'],
          populate: { school_admin: { select: ['documentId'] } },
        },
        sjr_file: { select: ['id'] },
        thumbnail: { select: ['id'] },
      },
    });

    if (!projectRow?.id) return ctx.notFound('プロジェクトが見つかりません');

    if (projectRow.owner_type !== 'student') {
      return ctx.badRequest('生徒所有のプロジェクトのみ移譲できます');
    }

    const currentStudentId = projectRow.student?.id;
    const currentStudentDocId = projectRow.student?.documentId;
    const ownerSaDocId = projectRow.student?.school_admin?.documentId;

    if (!currentStudentId || !currentStudentDocId) {
      return ctx.internalServerError('プロジェクトの生徒情報が見つかりません');
    }
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    if (String(currentStudentDocId) === toStudentDocId) {
      return ctx.badRequest('移譲先の生徒が現在の所有者と同一です');
    }

    const toStudent = await strapi.db.query(UID.student).findOne({
      where: { documentId: toStudentDocId },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['documentId'] } },
    });

    const toStudentId = toStudent?.id as number | undefined;
    if (!toStudentId) return ctx.badRequest('`toStudent` (documentId) が不正です');

    const toSaDocId = toStudent?.school_admin?.documentId as string | undefined;
    if (!toSaDocId || toSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const title = String(projectRow.title ?? '').trim();
    try {
      await ensureUniqueTitleForOwner(strapi, {
        ownerType: 'student',
        ownerId: toStudentId,
        title,
        excludeProjectId: Number(projectRow.id),
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'DUPLICATE_TITLE') {
        return ctx.badRequest('同じタイトルが既に存在します');
      }
      throw e;
    }

    const updated = await strapi.documents(UID.project).update({
      documentId: projectDocId,
      data: {
        owner_type: 'student',
        student: toStudentId,
        teacher: null,
      },
      status: 'published',
      populate: {
        sjr_file: true,
        thumbnail: true,
        teacher: { fields: ['documentId', 'name'] },
        student: { fields: ['documentId', 'name'] },
      },
    });

    ctx.body = { data: updated };
  },

  async adminCreateDayShare(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const classDocId = typeof body.class === 'string' ? body.class.trim() : '';
    const day = typeof body.day === 'string' ? body.day.trim() : '';

    if (!classDocId) return ctx.badRequest('`class` (documentId) は必須です');
    if (!getUtcDayRange(day)) return ctx.badRequest('`day` (YYYY-MM-DD) が不正です');

    const cls = await strapi.db.query(UID.class).findOne({
      where: { documentId: classDocId },
      select: ['id', 'documentId', 'name'],
      populate: {
        academic_year: {
          select: ['id'],
          populate: {
            school_admin: { select: ['documentId'] },
          },
        },
      },
    });
    if (!cls?.id) return ctx.badRequest('`class` (documentId) が不正です');

    const ownerSaDocId = cls?.academic_year?.school_admin?.documentId;
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const dayShareStore = strapi.store({ type: 'core', name: DAY_SHARE_STORE });

    let token = '';
    for (let i = 0; i < 5; i++) {
      const candidate = `${DAY_SHARE_PREFIX}${makeShareToken()}`;
      const exists = await dayShareStore.get({ key: candidate });
      if (!exists) {
        token = candidate;
        break;
      }
    }
    if (!token) return ctx.internalServerError('トークンの生成に失敗しました');

    const payload: DaySharePayload = {
      classDocumentId: cls.documentId,
      day,
      ownerSchoolAdminDocumentId: tenantSa.documentId,
      expires_at: expiresAt,
    };
    await dayShareStore.set({ key: token, value: payload });

    ctx.body = { token, expires_at: expiresAt };
  },

  async adminCreateShare(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const projectDocId = String(ctx.params?.id ?? '').trim();
    if (!projectDocId) return ctx.badRequest('project の documentId が指定されていません');

    const projectRow = await strapi.db.query(UID.project).findOne({
      where: { documentId: projectDocId },
      select: ['id', 'documentId', 'owner_type', 'share_token', 'share_expires_at'],
      populate: {
        teacher: { select: ['id'], populate: { school_admin: { select: ['documentId'] } } },
        student: { select: ['id'], populate: { school_admin: { select: ['documentId'] } } },
      },
    });
    if (!projectRow?.id) return ctx.notFound('プロジェクトが見つかりません');

    const ownerSaDocId =
      projectRow.owner_type === 'teacher'
        ? projectRow.teacher?.school_admin?.documentId
        : projectRow.student?.school_admin?.documentId;

    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const now = Date.now();
    const currentToken =
      typeof projectRow.share_token === 'string' ? projectRow.share_token.trim() : '';
    const expMs = projectRow.share_expires_at ? new Date(projectRow.share_expires_at).getTime() : 0;

    if (currentToken && expMs > now) {
      ctx.body = { token: currentToken, expires_at: new Date(expMs).toISOString() };
      return;
    }

    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

    let token = '';
    for (let i = 0; i < 5; i++) {
      const t = makeShareToken();
      const exists = await strapi.db.query(UID.project).findOne({
        where: { share_token: t },
        select: ['id'],
      });
      if (!exists?.id) {
        token = t;
        break;
      }
    }
    if (!token) return ctx.internalServerError('トークンの生成に失敗しました');

    await strapi.documents(UID.project).update({
      documentId: projectDocId,
      data: { share_token: token, share_expires_at: expiresAt },
      status: 'published',
    });

    ctx.body = { token, expires_at: expiresAt };
  },

  async publicResolveDayShare(ctx) {
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : '';

    if (!token || !token.startsWith(DAY_SHARE_PREFIX)) return ctx.badRequest('`token` は必須です');
    if (!isSixDigit(passcode)) return ctx.badRequest('`passcode` は6桁で入力してください');

    const dayShareStore = strapi.store({ type: 'core', name: DAY_SHARE_STORE });
    const payloadRaw = (await dayShareStore.get({ key: token })) as Partial<DaySharePayload> | null;

    if (!payloadRaw) return ctx.notFound('トークンが不正です');

    const classDocumentId = String(payloadRaw.classDocumentId ?? '').trim();
    const day = String(payloadRaw.day ?? '').trim();
    const ownerSchoolAdminDocumentId = String(payloadRaw.ownerSchoolAdminDocumentId ?? '').trim();
    const expiresAtRaw = String(payloadRaw.expires_at ?? '').trim();

    if (!classDocumentId || !day || !ownerSchoolAdminDocumentId || !expiresAtRaw) {
      return ctx.forbidden('有効期限が切れています');
    }

    const dayRange = getUtcDayRange(day);
    if (!dayRange) return ctx.forbidden('有効期限が切れています');

    const expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) return ctx.forbidden('有効期限が切れています');
    if (expiresAt.getTime() <= Date.now()) return ctx.forbidden('有効期限が切れています');

    const cls = await strapi.db.query(UID.class).findOne({
      where: { documentId: classDocumentId },
      select: ['id', 'documentId', 'name'],
      populate: {
        academic_year: {
          select: ['id'],
          populate: {
            school_admin: { select: ['documentId'] },
          },
        },
      },
    });

    if (!cls?.id) return ctx.notFound('トークンが不正です');

    const classOwnerSaDocId = cls?.academic_year?.school_admin?.documentId;
    if (!classOwnerSaDocId || classOwnerSaDocId !== ownerSchoolAdminDocumentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const student = await strapi.db.query(UID.student).findOne({
      where: {
        code: passcode,
        class: cls.id,
      },
      select: ['id', 'documentId', 'name'],
      populate: {
        school_admin: { select: ['documentId'] },
      },
    });

    if (!student?.id) return ctx.forbidden('パスコードが正しくありません');

    const studentSaDocId = student?.school_admin?.documentId;
    if (!studentSaDocId || studentSaDocId !== ownerSchoolAdminDocumentId) {
      return ctx.forbidden('パスコードが正しくありません');
    }

    const rows = await strapi.db.query(UID.project).findMany({
      where: {
        owner_type: 'student',
        student: student.id,
        createdAt: {
          $gte: dayRange.startIso,
          $lt: dayRange.endIso,
        },
      },
      select: ['id', 'documentId', 'title', 'createdAt', 'updatedAt'],
      populate: {
        sjr_file: { select: ['url'] },
        thumbnail: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      data: {
        day,
        expires_at: expiresAt.toISOString(),
        class: {
          documentId: cls.documentId,
          name: cls.name ?? '-',
        },
        student: {
          documentId: student.documentId,
          name: student.name ?? '-',
        },
        projects: (rows ?? []).map((r) => ({
          id: r.id,
          documentId: r.documentId,
          title: r.title ?? '-',
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          thumbnail: r.thumbnail,
          sjrUrl: r.sjr_file?.url ?? null,
        })),
      },
    };
  },

  async publicResolveShare(ctx) {
    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : '';

    if (!token) return ctx.badRequest('`token` は必須です');
    if (!isSixDigit(passcode)) return ctx.badRequest('`passcode` は6桁で入力してください');

    const project = await strapi.db.query(UID.project).findOne({
      where: { share_token: token },
      select: ['id', 'documentId', 'share_expires_at'],
      populate: {
        sjr_file: { select: ['url', 'name'] },
        student: { select: ['id', 'code'] },
      },
    });

    if (!project?.id) return ctx.notFound('トークンが不正です');

    const exp = project.share_expires_at ? new Date(project.share_expires_at) : null;
    if (!exp || Number.isNaN(exp.getTime())) return ctx.forbidden('有効期限が切れています');
    if (exp.getTime() <= Date.now()) return ctx.forbidden('有効期限が切れています');

    const studentCode =
      typeof project.student?.code === 'string' ? project.student.code.trim() : '';
    if (!studentCode || studentCode !== passcode)
      return ctx.forbidden('パスコードが正しくありません');

    const sjrUrl = project.sjr_file?.url;
    if (!sjrUrl) return ctx.internalServerError('sjr URL が設定されていません');

    ctx.body = {
      data: {
        project: { documentId: project.documentId },
        sjrUrl,
        expires_at: project.share_expires_at,
      },
    };
  },
}));
