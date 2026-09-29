import { factories } from '@strapi/strapi';
import { getRelationJoinTable } from '../../../utils/strapi/relations';
import { UID } from '../../../constants/uids';
import { readPayload } from '../../../utils/http/payload';
import { toRecord } from '../../../utils/values/record';
import { toAcademicStatus } from '../../../constants/enums';

type TenantSchoolAdmin = {
  schoolAdminId: number;
  schoolAdminDocumentId: string;
};

type BaseFindResult = {
  data: Array<{ id: number; documentId?: string; [k: string]: unknown }>;
  meta?: unknown;
};

type AuthUser = { id?: number };

type FullUser = {
  id: number;
  role?: { type?: string } | null;
  school_admin?: { id?: number; documentId?: string } | null;
};

const ACADEMIC_YEAR_UID = UID.academicYear;
const CLASS_UID = UID.class;
const STUDENT_UID = UID.student;
type UniqueStatus = 'active' | 'pending';
const isUniqueStatus = (status: unknown): status is UniqueStatus =>
  status === 'active' || status === 'pending';
const toAcademicStatusLabelJa = (status: UniqueStatus): string =>
  status === 'active' ? 'アクティブ' : '準備中';
const getDuplicateAcademicYearStatusMessage = (status: UniqueStatus): string =>
  `「${toAcademicStatusLabelJa(status)}」の年度はすでに存在します。年度登録ができません。`;

const getSchoolAdminFromCtx = async (strapi, ctx): Promise<TenantSchoolAdmin | null> => {
  const authUser = ctx.state?.user as AuthUser | undefined;
  const userId = authUser?.id;
  if (typeof userId !== 'number') return null;

  const fullUser = (await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
    populate: { role: true, school_admin: true },
  })) as FullUser | null;

  if (!fullUser) return null;
  if (fullUser.role?.type !== 'school_admin') return null;

  const schoolAdminId = fullUser.school_admin?.id;
  const schoolAdminDocumentId = fullUser.school_admin?.documentId;

  if (typeof schoolAdminId !== 'number') return null;
  if (typeof schoolAdminDocumentId !== 'string' || !schoolAdminDocumentId.trim()) return null;

  return { schoolAdminId, schoolAdminDocumentId: schoolAdminDocumentId.trim() };
};

const applyTenantFilter = async (
  strapi,
  ctx
): Promise<({ ok: true } & TenantSchoolAdmin) | { ok: false }> => {
  const tenant = await getSchoolAdminFromCtx(strapi, ctx);
  if (!tenant) return { ok: false };

  const prevQuery = toRecord(ctx.query);
  const prevFilters = toRecord(prevQuery.filters);

  const sa = toRecord(prevFilters.school_admin);
  const docId = toRecord(sa.documentId);
  const feDocId = typeof docId.$eq === 'string' ? docId.$eq : null;

  if (feDocId && feDocId !== tenant.schoolAdminDocumentId) return { ok: false };

  ctx.query = {
    ...prevQuery,
    filters: {
      ...prevFilters,
      school_admin: {
        ...sa,
        documentId: { $eq: tenant.schoolAdminDocumentId },
      },
    },
  };

  return { ok: true, ...tenant };
};

const hasOtherAcademicYearByStatus = async (
  strapi,
  schoolAdminDocumentId: string,
  status: UniqueStatus,
  excludeDocumentId?: string
): Promise<boolean> => {
  const rows = await strapi.documents(ACADEMIC_YEAR_UID).findMany({
    filters: {
      school_admin: { documentId: { $eq: schoolAdminDocumentId } },
      academic_status: { $eq: status },
      ...(excludeDocumentId ? { documentId: { $ne: excludeDocumentId } } : {}),
    },
    fields: ['documentId'],
    pagination: { page: 1, pageSize: 1 },
  });

  return Array.isArray(rows) && rows.length > 0;
};

const getDocIdParam = (ctx): string => String((ctx.params as { id?: unknown })?.id ?? '').trim();

export default factories.createCoreController(ACADEMIC_YEAR_UID, ({ strapi }) => ({
  async create(ctx) {
    const tenant = await getSchoolAdminFromCtx(strapi, ctx);
    if (!tenant) return ctx.forbidden('この操作を行う権限がありません');

    const payload = readPayload(ctx);

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) return ctx.badRequest('`name` は必須です');

    const nextStatus = toAcademicStatus(payload.academic_status) ?? 'pending';

    if (isUniqueStatus(nextStatus)) {
      const conflict = await hasOtherAcademicYearByStatus(
        strapi,
        tenant.schoolAdminDocumentId,
        nextStatus
      );
      if (conflict) ctx.throw(409, getDuplicateAcademicYearStatusMessage(nextStatus));
    }

    const created = await strapi.documents(ACADEMIC_YEAR_UID).create({
      data: {
        name,
        academic_status: nextStatus,
        school_admin: tenant.schoolAdminId,
      },
      status: 'published',
    });

    ctx.body = { data: created };
  },

  async find(ctx) {
    const tenant = await applyTenantFilter(strapi, ctx);
    if (!tenant.ok) return ctx.forbidden('この操作を行う権限がありません');
    return super.find(ctx);
  },

  async findOne(ctx) {
    const tenant = await getSchoolAdminFromCtx(strapi, ctx);
    if (!tenant) return ctx.forbidden('この操作を行う権限がありません');

    const documentId = getDocIdParam(ctx);
    if (!documentId) return ctx.badRequest('academic-year の documentId が指定されていません');

    const existing = await strapi.documents(ACADEMIC_YEAR_UID).findOne({
      documentId,
      populate: { school_admin: true },
    });

    if (!existing) return ctx.notFound('年度が見つかりません');

    const ownerId = existing?.school_admin?.id;
    if (ownerId !== tenant.schoolAdminId) return ctx.forbidden('この操作を行う権限がありません');

    ctx.body = { data: existing };
  },

  async update(ctx) {
    const tenant = await getSchoolAdminFromCtx(strapi, ctx);
    if (!tenant) return ctx.forbidden('この操作を行う権限がありません');

    const documentId = getDocIdParam(ctx);
    if (!documentId) return ctx.badRequest('academic-year の documentId が指定されていません');

    const existing = await strapi.documents(ACADEMIC_YEAR_UID).findOne({
      documentId,
      populate: { school_admin: true },
    });
    if (!existing) return ctx.notFound('年度が見つかりません');

    const ownerId = existing?.school_admin?.id;
    if (ownerId !== tenant.schoolAdminId) return ctx.forbidden('この操作を行う権限がありません');

    const payload = readPayload(ctx);
    const { school_admin: _ignore, ...dataToUpdate } = payload;

    if ('academic_status' in dataToUpdate) {
      const parsed = toAcademicStatus(dataToUpdate.academic_status);
      if (dataToUpdate.academic_status != null && !parsed) {
        return ctx.badRequest('`academic_status` が不正です');
      }

      if (isUniqueStatus(parsed)) {
        const conflict = await hasOtherAcademicYearByStatus(
          strapi,
          tenant.schoolAdminDocumentId,
          parsed,
          documentId
        );
        if (conflict) ctx.throw(409, getDuplicateAcademicYearStatusMessage(parsed));
      }
    }

    const updated = await strapi.documents(ACADEMIC_YEAR_UID).update({
      documentId,
      data: dataToUpdate,
      status: 'published',
    });

    ctx.body = { data: updated };
  },

  async delete(ctx) {
    const tenant = await getSchoolAdminFromCtx(strapi, ctx);
    if (!tenant) return ctx.forbidden('この操作を行う権限がありません');

    const documentId = getDocIdParam(ctx);
    if (!documentId) return ctx.badRequest('academic-year の documentId が指定されていません');

    const existing = await strapi.documents(ACADEMIC_YEAR_UID).findOne({
      documentId,
      populate: { school_admin: true },
    });

    if (!existing) return ctx.notFound('年度が見つかりません');

    const ownerId = existing?.school_admin?.id;
    if (ownerId !== tenant.schoolAdminId) return ctx.forbidden('この操作を行う権限がありません');
    if (existing?.academic_status === 'active') {
      return ctx.badRequest('アクティブの年度は削除できません。');
    }

    return super.delete(ctx);
  },

  async listWithStats(ctx) {
    const tenant = await applyTenantFilter(strapi, ctx);
    if (!tenant.ok) return ctx.forbidden('この操作を行う権限がありません');
    const prevQuery = toRecord(ctx.query);
    const hasSort = typeof prevQuery.sort !== 'undefined';

    ctx.query = {
      ...prevQuery,
      ...(hasSort ? {} : { sort: ['name:desc'] }),
    };

    const base = (await super.find(ctx)) as BaseFindResult;

    const ids = (base.data ?? [])
      .map((x) => x.id)
      .filter((x): x is number => typeof x === 'number');
    if (ids.length === 0) return base;

    const knex = strapi.db.connection;

    const cay = getRelationJoinTable(strapi, CLASS_UID, 'academic_year');
    const sc = getRelationJoinTable(strapi, STUDENT_UID, 'class');

    const classRows = (await knex(`${cay.table} as cay`)
      .whereIn(`cay.${cay.targetCol}`, ids)
      .select(knex.raw(`cay.${cay.targetCol} as academic_year_id`))
      .count({ class_count: '*' })
      .groupBy(`cay.${cay.targetCol}`)) as Array<{
      academic_year_id: number;
      class_count: string | number;
    }>;

    const studentRows = (await knex(`${sc.table} as sc`)
      .join(`${cay.table} as cay`, `cay.${cay.sourceCol}`, `sc.${sc.targetCol}`)
      .whereIn(`cay.${cay.targetCol}`, ids)
      .select(knex.raw(`cay.${cay.targetCol} as academic_year_id`))
      .countDistinct({ student_count: `sc.${sc.sourceCol}` })
      .groupBy(`cay.${cay.targetCol}`)) as Array<{
      academic_year_id: number;
      student_count: string | number;
    }>;

    const classMap = new Map<number, number>();
    for (const r of classRows) classMap.set(Number(r.academic_year_id), Number(r.class_count ?? 0));

    const studentMap = new Map<number, number>();
    for (const r of studentRows)
      studentMap.set(Number(r.academic_year_id), Number(r.student_count ?? 0));

    return {
      ...base,
      data: (base.data ?? []).map((ay) => ({
        ...ay,
        class_count: classMap.get(ay.id) ?? 0,
        student_count: studentMap.get(ay.id) ?? 0,
      })),
    };
  },
}));
