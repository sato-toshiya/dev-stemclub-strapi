import { factories } from '@strapi/strapi';
import { getTenantSchoolAdmin } from '../../../utils/tenant';
import { sanitizeEntityUser } from '../../../utils/sanitize/users';
import { toRecord } from '../../../utils/values/record';
import { UID } from '../../../constants/uids';
import { hasOwn, readPayload } from '../../../utils/http/payload';
import { parsePagination } from '../../../utils/http/pagination';
import { getRelationJoinTable } from '../../../utils/strapi/relations';

type ClassOptionRow = {
  id: number;
  documentId: string;
  name: string;
  academic_year?: {
    documentId?: string;
    name?: string;
    academic_status?: string;
  } | null;
};
const SELECTABLE_ACADEMIC_YEAR_STATUSES = new Set(['active', 'pending']);

const pickClassOption = (v: unknown): ClassOptionRow | null => {
  const o = toRecord(v);
  const id = o.id;
  const documentId = o.documentId;
  const name = o.name;
  const ayRaw = toRecord(o.academic_year);

  if (typeof id !== 'number') return null;
  if (typeof documentId !== 'string') return null;
  if (typeof name !== 'string') return null;

  const academic_year =
    ayRaw && Object.keys(ayRaw).length
      ? {
          documentId: typeof ayRaw.documentId === 'string' ? ayRaw.documentId : undefined,
          name: typeof ayRaw.name === 'string' ? ayRaw.name : undefined,
          academic_status:
            typeof ayRaw.academic_status === 'string' ? ayRaw.academic_status : undefined,
        }
      : undefined;

  return { id, documentId, name, academic_year };
};

const getStudentsCountMap = async (strapi, classIds: number[]) => {
  const map = new Map<number, number>();
  if (!classIds.length) return map;

  const jt = getRelationJoinTable(strapi, UID.student, 'class');
  const knex = strapi.db.connection;

  const rows = (await knex(jt.table)
    .whereIn(jt.targetCol, classIds)
    .select(jt.targetCol)
    .count({ cnt: '*' })
    .groupBy(jt.targetCol)) as Array<Record<string, unknown> & { cnt: string | number }>;

  for (const r of rows) map.set(Number(r[jt.targetCol]), Number(r.cnt));
  return map;
};

const getProjectsCountMap = async (strapi, classIds: number[]) => {
  const map = new Map<number, number>();
  if (!classIds.length) return map;

  const jtStudentClass = getRelationJoinTable(strapi, UID.student, 'class');
  const jtProjectStudent = getRelationJoinTable(strapi, UID.project, 'student');
  const knex = strapi.db.connection;

  const rows = (await knex({ ps: jtProjectStudent.table })
    .join(
      { sc: jtStudentClass.table },
      `ps.${jtProjectStudent.targetCol}`,
      `sc.${jtStudentClass.sourceCol}`
    )
    .whereIn(`sc.${jtStudentClass.targetCol}`, classIds)
    .select({ classId: `sc.${jtStudentClass.targetCol}` })
    .count({ cnt: '*' })
    .groupBy(`sc.${jtStudentClass.targetCol}`)) as Array<{
    classId: number | string;
    cnt: number | string;
  }>;

  for (const r of rows) map.set(Number(r.classId), Number(r.cnt));
  return map;
};

const sanitizeTeacher = (teacher: unknown) => {
  if (!teacher || typeof teacher !== 'object') return teacher;
  return sanitizeEntityUser(teacher as Record<string, unknown>);
};

const resolveIdByDocumentId = async (strapi, uid: string, documentId: string) => {
  const row = await strapi.db.query(uid).findOne({
    where: { documentId },
    select: ['id'],
  });
  return typeof row?.id === 'number' ? row.id : null;
};

const requireDocId = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`\`${field}\` (documentId) は必須です`);
  return v.trim();
};

const optionalDocIdOrNull = (v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

const resolveAcademicYearForTenant = async (
  strapi,
  academicYearDocId: string,
  tenantSchoolAdminDocId: string
) => {
  const ayDocId = academicYearDocId.trim();
  if (!ayDocId) return null;

  const ay = await strapi.db.query(UID.academicYear).findOne({
    where: { documentId: ayDocId },
    select: ['id', 'documentId', 'academic_status', 'name'],
    populate: { school_admin: { select: ['documentId'] } },
  });

  if (!ay?.id) return null;
  if (ay.school_admin?.documentId !== tenantSchoolAdminDocId) return null;

  return ay;
};

const normalizeName = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\s+/g, ' ');
};

const assertUniqueClassName = async (
  strapi,
  opts: { name: string; academicYearId: number; excludeId?: number }
) => {
  const where: Record<string, unknown> = {
    name: opts.name,
    academic_year: opts.academicYearId,
  };

  if (typeof opts.excludeId === 'number') {
    where.id = { $ne: opts.excludeId };
  }

  const existed = await strapi.db.query(UID.class).findOne({
    where,
    select: ['id'],
  });

  if (existed?.id) {
    throw new Error('DUPLICATE_CLASS_NAME');
  }
};

export default factories.createCoreController(UID.class, ({ strapi }) => ({
  async find(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const prevQuery = toRecord(ctx.query);
    const prevFilters = toRecord(prevQuery.filters);
    const ayFilter = toRecord(prevFilters.academic_year);
    const aySa = toRecord(ayFilter.school_admin);
    const aySaDocId = toRecord(aySa.documentId);

    const requestedSaDocId = typeof aySaDocId.$eq === 'string' ? aySaDocId.$eq : null;
    if (requestedSaDocId && requestedSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const prevPopulate = toRecord(prevQuery.populate);

    ctx.query = {
      ...prevQuery,
      filters: {
        ...prevFilters,
        academic_year: {
          ...ayFilter,
          school_admin: {
            ...aySa,
            documentId: { $eq: tenantSa.documentId },
          },
        },
      },
      populate: {
        ...prevPopulate,
        teacher: {
          fields: ['id', 'documentId', 'name'],
          populate: {
            users_permissions_user: { fields: ['id', 'email', 'phone', 'blocked'] },
          },
        },
        academic_year: { fields: ['id', 'documentId', 'name'] },
      },
    };

    const { data, meta } = (await super.find(ctx)) as { data: unknown; meta: unknown };
    const list = Array.isArray(data) ? data : [];

    const classIds = list
      .map((c) => toRecord(c).id as unknown)
      .filter((x): x is number => typeof x === 'number');

    const studentsCountMap = await getStudentsCountMap(strapi, classIds);
    const projectsCountMap = await getProjectsCountMap(strapi, classIds);

    const enhanced = list.map((c) => {
      const co = toRecord(c);
      const cid = typeof co.id === 'number' ? co.id : null;

      const teacherRaw = co.teacher;
      const teacher = teacherRaw ? sanitizeTeacher(teacherRaw) : null;

      return {
        ...c,
        teacher,
        studentsCount: cid ? (studentsCountMap.get(cid) ?? 0) : 0,
        projectsCount: cid ? (projectsCountMap.get(cid) ?? 0) : 0,
      };
    });

    return { data: enhanced, meta };
  },

  async findOne(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const currentDocId = typeof ctx.params?.id === 'string' ? ctx.params.id.trim() : '';
    if (!currentDocId) return ctx.badRequest('class の documentId が指定されていません');

    const ownerClass = await strapi.db.query(UID.class).findOne({
      where: { documentId: currentDocId },
      select: ['id'],
      populate: {
        academic_year: {
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        },
      },
    });

    if (!ownerClass?.id) return ctx.notFound('クラスが見つかりません');
    if (ownerClass.academic_year?.school_admin?.documentId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const prevQuery = toRecord(ctx.query);
    const prevPopulate = toRecord(prevQuery.populate);

    ctx.query = {
      ...prevQuery,
      populate: {
        ...prevPopulate,
        teacher: {
          fields: ['id', 'documentId', 'name'],
          populate: {
            users_permissions_user: { fields: ['id', 'email', 'phone', 'blocked'] },
          },
        },
        academic_year: { fields: ['id', 'documentId', 'name'] },
      },
    };

    const response = await super.findOne(ctx);
    if (!response?.data) return response;

    const cid = typeof response.data?.id === 'number' ? response.data.id : null;

    const studentsCountMap = await getStudentsCountMap(strapi, cid ? [cid] : []);
    const projectsCountMap = await getProjectsCountMap(strapi, cid ? [cid] : []);

    const studentsCount = cid ? (studentsCountMap.get(cid) ?? 0) : 0;
    const projectsCount = cid ? (projectsCountMap.get(cid) ?? 0) : 0;

    const data = {
      ...response.data,
      teacher: response.data?.teacher ? sanitizeTeacher(response.data.teacher) : null,
      studentsCount,
      projectsCount,
    };

    return { data, meta: response.meta };
  },

  async create(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const payload = readPayload(ctx);

    try {
      const ayDocId = requireDocId(payload.academic_year, 'academic_year');

      const ay = await strapi.db.query(UID.academicYear).findOne({
        where: { documentId: ayDocId },
        select: ['id'],
        populate: { school_admin: { select: ['documentId'] } },
      });

      if (!ay?.id) return ctx.badRequest('`academic_year` (documentId) が不正です');
      if (ay.school_admin?.documentId !== tenantSa.documentId)
        return ctx.forbidden('この操作を行う権限がありません');

      payload.academic_year = ay.id;

      const nameNorm = normalizeName(payload.name);
      if (!nameNorm) return ctx.badRequest('`name` は必須です');
      payload.name = nameNorm;

      await assertUniqueClassName(strapi, { name: nameNorm, academicYearId: ay.id });

      if (hasOwn(payload, 'teacher')) {
        const teacherDocId = optionalDocIdOrNull(payload.teacher);
        if (teacherDocId === null) {
          payload.teacher = null;
        } else {
          const teacherId = await resolveIdByDocumentId(strapi, UID.teacher, teacherDocId);
          if (!teacherId) return ctx.badRequest('`teacher` (documentId) が不正です');
          payload.teacher = teacherId;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'DUPLICATE_CLASS_NAME') {
        return ctx.badRequest('このクラス名は既に使用されています。別の名前を入力してください。');
      }
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }

    ctx.request.body = { data: payload };
    return super.create(ctx);
  },

  async update(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const payload = readPayload(ctx);

    const currentDocId = typeof ctx.params?.id === 'string' ? ctx.params.id : '';
    const currentRow = currentDocId
      ? await strapi.db.query(UID.class).findOne({
          where: { documentId: currentDocId },
          select: ['id', 'name'],
          populate: {
            academic_year: {
              select: ['id'],
              populate: { school_admin: { select: ['documentId'] } },
            },
          },
        })
      : null;

    if (!currentRow?.id) return ctx.badRequest('クラスIDが不正です');

    if (currentRow.academic_year?.school_admin?.documentId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    try {
      if (hasOwn(payload, 'academic_year')) {
        const ayDocId = requireDocId(payload.academic_year, 'academic_year');

        const ay = await strapi.db.query(UID.academicYear).findOne({
          where: { documentId: ayDocId },
          select: ['id'],
          populate: { school_admin: { select: ['documentId'] } },
        });

        if (!ay?.id) return ctx.badRequest('`academic_year` (documentId) が不正です');
        if (ay.school_admin?.documentId !== tenantSa.documentId)
          return ctx.forbidden('この操作を行う権限がありません');

        payload.academic_year = ay.id;
      }

      if (hasOwn(payload, 'teacher')) {
        const teacherDocId = optionalDocIdOrNull(payload.teacher);
        if (teacherDocId === null) {
          payload.teacher = null;
        } else {
          const teacherId = await resolveIdByDocumentId(strapi, UID.teacher, teacherDocId);
          if (!teacherId) return ctx.badRequest('`teacher` (documentId) が不正です');
          payload.teacher = teacherId;
        }
      }

      const nextName = hasOwn(payload, 'name')
        ? normalizeName(payload.name)
        : normalizeName(currentRow.name);

      if (hasOwn(payload, 'name')) {
        if (!nextName) return ctx.badRequest('`name` は必須です');
        payload.name = nextName;
      }

      const nextAyId = hasOwn(payload, 'academic_year')
        ? typeof payload.academic_year === 'number'
          ? payload.academic_year
          : null
        : typeof currentRow.academic_year?.id === 'number'
          ? currentRow.academic_year.id
          : null;

      if (!nextAyId) return ctx.badRequest('`academic_year` が不正です');

      if (hasOwn(payload, 'name') || hasOwn(payload, 'academic_year')) {
        await assertUniqueClassName(strapi, {
          name: nextName,
          academicYearId: nextAyId,
          excludeId: currentRow.id,
        });
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'DUPLICATE_CLASS_NAME') {
        return ctx.badRequest('このクラス名は既に使用されています。別の名前を入力してください。');
      }
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }

    ctx.request.body = { data: payload };
    return super.update(ctx);
  },

  async myClasses(ctx) {
    const authUser = ctx.state.user as { id?: number } | undefined;
    if (!authUser?.id) return ctx.unauthorized('認証ユーザー情報がありません');

    const teacher = await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: authUser.id },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['id', 'documentId'] } },
    });

    if (!teacher?.id) return ctx.forbidden('この操作を行う権限がありません');

    const tenantSchoolAdminDocId = teacher.school_admin?.documentId;
    if (!tenantSchoolAdminDocId) return ctx.forbidden('この操作を行う権限がありません');

    const activeAy = await strapi.db.query(UID.academicYear).findOne({
      where: {
        academic_status: 'active',
        school_admin: { documentId: tenantSchoolAdminDocId },
      },
      select: ['id', 'documentId', 'name'],
    });

    if (!activeAy?.id) {
      ctx.body = {
        data: [],
        meta: { pagination: { page: 1, pageSize: 0, pageCount: 0, total: 0 } },
      };
      return;
    }

    const { page, pageSize, offset } = parsePagination(ctx);

    const where = {
      teacher: teacher.id,
      academic_year: activeAy.id,
    };

    const total = await strapi.db.query(UID.class).count({ where });

    const rows = await strapi.db.query(UID.class).findMany({
      where,
      offset,
      limit: pageSize,
      select: ['id', 'documentId', 'name'],
      populate: { academic_year: { select: ['id', 'documentId', 'name'] } },
      orderBy: { name: 'asc' },
    });

    const list = Array.isArray(rows) ? rows : [];
    const classIds = list
      .map((c) => toRecord(c).id as unknown)
      .filter((x): x is number => typeof x === 'number');

    const studentsCountMap = await getStudentsCountMap(strapi, classIds);

    ctx.body = {
      data: list.map((c) => {
        const cid = toRecord(c).id;
        return {
          ...c,
          studentsCount: typeof cid === 'number' ? (studentsCountMap.get(cid) ?? 0) : 0,
        };
      }),
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

  async available(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const q = toRecord(ctx.query);
    const academicYearDocId = typeof q.academic_year === 'string' ? q.academic_year.trim() : '';
    const teacherDocId = typeof q.teacher === 'string' ? q.teacher.trim() : '';

    const selectableAyRows = await strapi.db.query(UID.academicYear).findMany({
      where: {
        academic_status: { $in: ['active', 'pending'] },
        school_admin: { documentId: tenantSa.documentId },
      },
      select: ['id', 'documentId', 'academic_status'],
    });

    const selectableAyDocIds = (Array.isArray(selectableAyRows) ? selectableAyRows : [])
      .map((ay) => (typeof ay?.documentId === 'string' ? ay.documentId.trim() : ''))
      .filter(Boolean);

    let targetAyDocIds = [];

    if (academicYearDocId) {
      const ay = await resolveAcademicYearForTenant(strapi, academicYearDocId, tenantSa.documentId);
      if (!ay?.id) return ctx.badRequest('`academic_year` が不正です');
      if (!SELECTABLE_ACADEMIC_YEAR_STATUSES.has(String(ay.academic_status ?? ''))) {
        return ctx.badRequest('`academic_year` は アクティブ または 準備中 である必要があります');
      }
      targetAyDocIds = [academicYearDocId];
    } else {
      if (!teacherDocId) return ctx.badRequest('`academic_year` (documentId) は必須です');
      targetAyDocIds = selectableAyDocIds;
    }

    if (!targetAyDocIds.length) {
      ctx.body = { data: [] };
      return;
    }

    if (teacherDocId) {
      const t = await strapi.db.query(UID.teacher).findOne({
        where: { documentId: teacherDocId },
        select: ['id'],
        populate: { school_admin: { select: ['documentId'] } },
      });

      if (!t?.id) return ctx.badRequest('`teacher` が不正です');
      if (t.school_admin?.documentId !== tenantSa.documentId) {
        return ctx.forbidden('この操作を行う権限がありません');
      }
    }

    const filters = {
      academic_year: { documentId: { $in: targetAyDocIds } },
      ...(teacherDocId
        ? { $or: [{ teacher: null }, { teacher: { documentId: { $eq: teacherDocId } } }] }
        : { teacher: null }),
    };

    const rowsUnknown = (await strapi.documents(UID.class).findMany({
      filters,
      fields: ['name', 'documentId'],
      populate: {
        academic_year: {
          fields: ['documentId', 'name', 'academic_status'],
        },
      },
      status: 'published',
      sort: ['name:asc'],
    })) as unknown;

    const rows = Array.isArray(rowsUnknown) ? rowsUnknown : [];
    const data = rows.map(pickClassOption).filter((x): x is ClassOptionRow => x !== null);

    ctx.body = { data };
  },

  async byAcademicYear(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const q = toRecord(ctx.query);
    const academicYearDocId = typeof q.academic_year === 'string' ? q.academic_year.trim() : '';
    if (!academicYearDocId) return ctx.badRequest('`academic_year` (documentId) は必須です');

    const ay = await resolveAcademicYearForTenant(strapi, academicYearDocId, tenantSa.documentId);
    if (!ay?.id) return ctx.badRequest('`academic_year` が不正です');
    if (!SELECTABLE_ACADEMIC_YEAR_STATUSES.has(String(ay.academic_status ?? ''))) {
      return ctx.badRequest('`academic_year` は アクティブ または 準備中 である必要があります');
    }

    const rows = await strapi.db.query(UID.class).findMany({
      where: { academic_year: ay.id },
      select: ['id', 'documentId', 'name'],
      populate: {
        teacher: { select: ['id', 'documentId', 'name'] },
        academic_year: { select: ['id', 'documentId', 'name', 'academic_status'] },
      },
      orderBy: { name: 'asc' },
    });

    ctx.body = { data: rows ?? [] };
  },

  async active(ctx) {
    const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
    if (!tenantSa) return ctx.forbidden('この操作を行う権限がありません');

    const activeAy = await strapi.db.query(UID.academicYear).findOne({
      where: {
        academic_status: 'active',
        school_admin: { documentId: tenantSa.documentId },
      },
      select: ['id', 'documentId', 'name'],
    });

    if (!activeAy?.id) {
      ctx.body = { data: [] };
      return;
    }

    const rows = await strapi.db.query(UID.class).findMany({
      where: { academic_year: activeAy.id },
      select: ['id', 'documentId', 'name'],
      populate: {
        teacher: { select: ['id', 'documentId', 'name'] },
        academic_year: { select: ['id', 'documentId', 'name'] },
      },
      orderBy: { name: 'asc' },
    });

    ctx.body = { data: rows ?? [] };
  },
}));
