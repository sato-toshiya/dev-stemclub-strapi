import { factories } from '@strapi/strapi';
import { readPayload } from '../../../utils/http/payload';
import { UID } from '../../../constants/uids';
import { parsePagination } from '../../../utils/http/pagination';
import { ensureAuthUserId } from '../../../utils/auth/user';

const resolveTeacherByUserId = async (strapi, userId: number) => {
  return (
    (await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: userId },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['id', 'documentId'] } },
    })) ??
    (await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: { id: userId } },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['id', 'documentId'] } },
    }))
  );
};

const resolveStudentByUserId = async (strapi, userId: number) => {
  return (
    (await strapi.db.query(UID.student).findOne({
      where: { users_permissions_user: userId },
      select: ['id', 'documentId', 'name'],
      populate: { class: { select: ['id', 'documentId'] } },
    })) ??
    (await strapi.db.query(UID.student).findOne({
      where: { users_permissions_user: { id: userId } },
      select: ['id', 'documentId', 'name'],
      populate: { class: { select: ['id', 'documentId'] } },
    }))
  );
};

const resolveActiveAcademicYearId = async (strapi, tenantSchoolAdminDocId: string) => {
  const ay = await strapi.db.query(UID.academicYear).findOne({
    where: {
      academic_status: 'active',
      school_admin: { documentId: tenantSchoolAdminDocId },
    },
    select: ['id'],
  });
  return ay?.id ?? null;
};

export default factories.createCoreController(UID.classAssignment, ({ strapi }) => ({
  async assignProjectsToClass(ctx) {
    const reqId = `ca_assign_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const logWarn = (reason: string, extra: Record<string, unknown> = {}) => {
      strapi.log.warn(`[${reqId}] assignProjectsToClass 403: ${reason} | ${JSON.stringify(extra)}`);
    };

    const logInfo = (msg: string, extra: Record<string, unknown> = {}) => {
      strapi.log.info(`[${reqId}] assignProjectsToClass: ${msg} | ${JSON.stringify(extra)}`);
    };

    const userId = ensureAuthUserId(ctx);
    if (!userId) {
      strapi.log.warn(`[${reqId}] assignProjectsToClass 401: 認証ユーザー情報がありません`);
      return ctx.unauthorized('認証ユーザー情報がありません');
    }

    const teacher = await resolveTeacherByUserId(strapi, userId);
    if (!teacher?.id) {
      logWarn('AUTH_USER_NOT_LINKED_TO_TEACHER', { userId });
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const tenantSchoolAdminDocId = teacher.school_admin?.documentId;
    if (!tenantSchoolAdminDocId) {
      logWarn('TEACHER_MISSING_SCHOOL_ADMIN', { userId, teacherId: teacher.id });
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const payload = readPayload(ctx);

    const classDocId = String(payload.class ?? '').trim();
    if (!classDocId) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: class documentId が不足しています | userId=${userId}`
      );
      return ctx.badRequest('`class` (documentId) は必須です');
    }

    const projectDocIdsRaw = Array.isArray(payload.projectIds) ? payload.projectIds : [];
    const projectDocIds = projectDocIdsRaw.map((v) => String(v ?? '').trim()).filter(Boolean);
    if (projectDocIds.length === 0) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: Empty projectIds | ${JSON.stringify({
          userId,
          teacherId: teacher.id,
          classDocId,
        })}`
      );
      return ctx.badRequest('`projectIds` は project documentId の空でない配列で指定してください');
    }

    const activeAyId = await resolveActiveAcademicYearId(strapi, tenantSchoolAdminDocId);
    if (!activeAyId) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: active の年度が見つかりません | ${JSON.stringify({
          userId,
          teacherId: teacher.id,
          tenantSchoolAdminDocId,
        })}`
      );
      return ctx.badRequest('active の年度が見つかりません');
    }

    const classRow = await strapi.db.query(UID.class).findOne({
      where: { documentId: classDocId },
      select: ['id'],
      populate: {
        teacher: { select: ['id'] },
        academic_year: {
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        },
      },
    });

    if (!classRow?.id) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: class documentId が不正です | ${JSON.stringify({
          userId,
          teacherId: teacher.id,
          classDocId,
        })}`
      );
      return ctx.badRequest('`class` が不正です');
    }

    if (classRow.teacher?.id !== teacher.id) {
      logWarn('CLASS_BELONGS_TO_ANOTHER_TEACHER', {
        userId,
        teacherId: teacher.id,
        classDocId,
        classTeacherId: classRow.teacher?.id ?? null,
      });
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const classAySchoolAdminDocId = classRow.academic_year?.school_admin?.documentId ?? null;
    if (classAySchoolAdminDocId !== tenantSchoolAdminDocId) {
      logWarn('TENANT_MISMATCH_CLASS_ACADEMIC_YEAR_SCHOOL_ADMIN', {
        userId,
        teacherId: teacher.id,
        classDocId,
        tenantSchoolAdminDocId,
        classAySchoolAdminDocId,
      });
      return ctx.forbidden('この操作を行う権限がありません');
    }

    if (classRow.academic_year?.id !== activeAyId) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: Class not in active AY | ${JSON.stringify({
          userId,
          teacherId: teacher.id,
          classDocId,
          classAyId: classRow.academic_year?.id ?? null,
          activeAyId,
        })}`
      );
      return ctx.badRequest('クラスが active の年度に属していません');
    }

    const projects = await strapi.db.query(UID.project).findMany({
      where: {
        documentId: { $in: projectDocIds },
        owner_type: 'teacher',
        teacher: teacher.id,
      },
      select: ['id', 'documentId', 'title'],
      populate: {
        sjr_file: { select: ['id'] },
        thumbnail: { select: ['id'] },
      },
    });

    if (!projects?.length) {
      strapi.log.warn(
        `[${reqId}] assignProjectsToClass 400: 有効な教師プロジェクトが見つかりません | ${JSON.stringify(
          {
            userId,
            teacherId: teacher.id,
            classDocId,
            projectDocIds,
          }
        )}`
      );
      return ctx.badRequest('割り当て可能な教師プロジェクトが見つかりません');
    }

    logInfo('validated', {
      userId,
      teacherId: teacher.id,
      tenantSchoolAdminDocId,
      classDocId,
      projectCount: projects.length,
    });

    const now = new Date().toISOString();
    const createdOrExisting = [];

    for (const p of projects) {
      const existing = await strapi.db.query(UID.classAssignment).findOne({
        where: { class: classRow.id, project: p.id, teacher: teacher.id },
        select: ['id', 'documentId', 'assigned_at', 'assigned_title', 'createdAt', 'updatedAt'],
        populate: {
          assigned_sjr_file: true,
          assigned_thumbnail: true,
          class: { select: ['name', 'documentId'] },
          project: { select: ['title', 'documentId'] },
          teacher: { select: ['name', 'documentId'] },
        },
      });

      if (existing?.documentId) {
        createdOrExisting.push(existing);
        continue;
      }

      const sjrId = p?.sjr_file?.id as number | undefined;
      if (!sjrId) {
        strapi.log.warn(
          `[${reqId}] assignProjectsToClass 400: プロジェクトに sjr_file がありません | ${JSON.stringify(
            {
              userId,
              teacherId: teacher.id,
              classDocId,
              projectDocId: p?.documentId ?? null,
            }
          )}`
        );
        return ctx.badRequest('プロジェクトに sjr_file が設定されていません');
      }

      const created = await strapi.documents(UID.classAssignment).create({
        data: {
          class: classRow.id,
          project: p.id,
          teacher: teacher.id,
          assigned_at: now,

          assigned_sjr_file: sjrId,
          assigned_title: p?.title ?? null,
          assigned_thumbnail: p?.thumbnail?.id ?? null,
        },
        populate: {
          class: { fields: ['name', 'documentId'] },
          project: { fields: ['title', 'documentId'] },
          teacher: { fields: ['name', 'documentId'] },

          assigned_sjr_file: true,
          assigned_thumbnail: true,
        },
      });

      createdOrExisting.push(created);
    }

    ctx.body = { data: createdOrExisting, meta: { reqId } };
  },
  async myClassAssignments(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const teacher = await resolveTeacherByUserId(strapi, userId);
    if (!teacher?.id) return ctx.forbidden('この操作を行う権限がありません');

    const classDocId = String((ctx.query as any)?.class ?? '').trim();

    const where: any = { teacher: teacher.id };
    if (classDocId) where.class = { documentId: classDocId };

    const { page, pageSize, offset } = parsePagination(ctx, {
      maxPageSize: 100,
      defaultPageSize: 10,
    });

    const total = await strapi.db.query(UID.classAssignment).count({ where });

    const rows = await strapi.db.query(UID.classAssignment).findMany({
      where,
      offset,
      limit: pageSize,
      select: ['id', 'documentId', 'assigned_at', 'assigned_title', 'createdAt', 'updatedAt'],
      populate: {
        class: { select: ['name', 'documentId'] },
        project: { select: ['title', 'documentId'], populate: { thumbnail: true } },
        assigned_sjr_file: true,
        assigned_thumbnail: true,
      },
      orderBy: { assigned_at: 'desc' },
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
  async studentClassAssignments(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const student = await resolveStudentByUserId(strapi, userId);
    if (!student?.id) return ctx.forbidden('この操作を行う権限がありません');

    const studentClassId = student.class?.id;
    if (typeof studentClassId !== 'number')
      return ctx.badRequest('生徒にクラスが設定されていません');

    const { page, pageSize, offset } = parsePagination(ctx, {
      maxPageSize: 100,
      defaultPageSize: 10,
    });

    const where = { class: studentClassId };

    const total = await strapi.db.query(UID.classAssignment).count({ where });

    const rows = await strapi.db.query(UID.classAssignment).findMany({
      where,
      offset,
      select: ['id', 'documentId', 'assigned_at', 'assigned_title', 'createdAt'],
      populate: {
        teacher: { select: ['name', 'documentId'] },
        class: { select: ['name', 'documentId'] },
        assigned_sjr_file: true,
        assigned_thumbnail: true,
      },
      orderBy: { assigned_at: 'desc' },
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
  async submitToClassAssignment(ctx) {
    const userId = ensureAuthUserId(ctx);
    if (!userId) return ctx.unauthorized('認証ユーザー情報がありません');

    const student = await resolveStudentByUserId(strapi, userId);
    if (!student?.id) return ctx.forbidden('この操作を行う権限がありません');

    const { id } = ctx.params as { id?: string };
    const classAssignDocId = String(id ?? '').trim();
    if (!classAssignDocId)
      return ctx.badRequest('class-assignment の documentId が指定されていません');

    const payload = readPayload(ctx);
    const studentProjectDocId = String(payload.project ?? '').trim();
    if (!studentProjectDocId)
      return ctx.badRequest('`project` (生徒プロジェクト documentId) は必須です');

    const ca = await strapi.documents(UID.classAssignment).findOne({
      documentId: classAssignDocId,
      populate: {
        class: { fields: ['id'] },
        project: { fields: ['id', 'documentId', 'title'] },

        assigned_sjr_file: true,
        assigned_thumbnail: true,
      },
    });

    if (!ca?.id) return ctx.notFound('クラス課題が見つかりません');

    const classId = ca.class?.id;
    if (typeof classId !== 'number')
      return ctx.internalServerError('クラス課題にクラス情報が設定されていません');

    const knex = strapi.db.connection;
    const membership = await knex('classes_students_lnk')
      .where({ class_id: classId, student_id: student.id })
      .first();

    if (!membership) return ctx.forbidden('この操作を行う権限がありません');

    const stuProj = await strapi.db.query(UID.project).findOne({
      where: { documentId: studentProjectDocId, owner_type: 'student', student: student.id },
      select: ['id', 'documentId', 'title'],
      populate: { sjr_file: true, thumbnail: true },
    });

    if (!stuProj?.id) return ctx.badRequest('生徒の `project` が不正です');

    const existing = await strapi.db.query(UID.assignmentSubmission).findOne({
      where: { student: student.id, class_assignment: ca.id },
      select: ['id', 'documentId'],
    });

    const now = new Date().toISOString();

    if (existing?.documentId) {
      const updated = await strapi.documents(UID.assignmentSubmission).update({
        documentId: existing.documentId,
        data: {
          project: stuProj.id,
          submitted_at: now,
        },
        populate: {
          project: { populate: { sjr_file: true, thumbnail: true } },
          class_assignment: {
            populate: {
              project: true,
              class: true,
              assigned_sjr_file: true,
              assigned_thumbnail: true,
            },
          },
          student: true,
        },
      });

      ctx.body = { data: updated };
      return;
    }

    const created = await strapi.documents(UID.assignmentSubmission).create({
      data: {
        student: student.id,
        class_assignment: ca.id,
        project: stuProj.id,
        submitted_at: now,
      },
      populate: {
        project: { populate: { sjr_file: true, thumbnail: true } },
        class_assignment: {
          populate: {
            project: true,
            class: true,
            assigned_sjr_file: true,
            assigned_thumbnail: true,
          },
        },
        student: true,
      },
    });

    ctx.body = { data: created };
  },
}));
