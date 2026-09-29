import { factories } from '@strapi/strapi';
import { getTenantByTeacher } from '../../../utils/tenant';
import { getRelationJoinTable } from '../../../utils/strapi/relations';

import { readPayload, hasOwn } from '../../../utils/http/payload';
import { toGender } from '../../../constants/enums';
import { sanitizeEntityUser } from '../../../utils/sanitize/users';
import { getRoleIdByType } from '../../../utils/users-permissions/roles';
import {
  createLocalUser,
  ensureNoExistingUserEmail,
  updateUserCredentials,
  setUserSchoolAdmin,
  removeUser,
  makePlaceholderUsername,
} from '../../../utils/users-permissions/user';
import { toIdNumber } from '../../../utils/values/id';
import { toRecord } from '../../../utils/values/record';
import { hasNonAsciiChars, isRealPersonName } from '../../../utils/values/string';
import { UID } from '../../../constants/uids';
import { requireTenantSchoolAdmin } from '../../../utils/tenant-guard';
import { generateUniqueDigitsField, genTokenHex } from '../../../utils/tokens';
import { TeacherCreateInput, TeacherUpdateInput } from './teacher.dto';
import { parsePagination } from '../../../utils/http/pagination';
import { pickTeacherRowJP } from '../services/import';
import { parseImportFile, readUploadToBuffer } from '../../../utils/import/file';
import { deleteProjectsByOwnerWithAssets } from '../../../utils/project-cleanup';
const SELECTABLE_ACADEMIC_YEAR_STATUSES = new Set(['active', 'pending']);

const sanitizeTeacher = (t: unknown) => {
  if (!t || typeof t !== 'object') return t;
  return sanitizeEntityUser(t as Record<string, unknown>);
};
const unassignTeacherFromClasses = async (
  strapi,
  teacherEntryIds: number[],
  classIds?: number[]
) => {
  if (!teacherEntryIds?.length) return 0;

  const jt = getRelationJoinTable(strapi, UID.teacher, 'classes');
  const knex = strapi.db.connection;

  const q = knex(jt.table).whereIn(jt.sourceCol, teacherEntryIds);
  if (classIds?.length) q.whereIn(jt.targetCol, classIds);

  return q.del();
};

const assignTeacherToClasses = async (strapi, teacherEntryId: number, classIds: number[]) => {
  const jt = getRelationJoinTable(strapi, UID.teacher, 'classes');
  const knex = strapi.db.connection;

  await knex(jt.table).where(jt.sourceCol, teacherEntryId).del();

  if (!classIds.length) return;

  const colInfo = await knex(jt.table).columnInfo();
  const ordCol =
    Object.keys(colInfo).find(
      (c) => c.endsWith('_ord') && c !== jt.sourceCol && c !== jt.targetCol
    ) ?? null;

  const rows = classIds.map((cid, idx) => {
    const r: Record<string, unknown> = {
      [jt.sourceCol]: teacherEntryId,
      [jt.targetCol]: cid,
    };
    if (ordCol) r[ordCol] = idx + 1;
    return r;
  });

  await knex(jt.table).insert(rows);
};

const resolveClassIdsForTenant = async (strapi, raw: unknown, tenantSchoolAdminDocId: string) => {
  if (!Array.isArray(raw)) return [];

  const ids: number[] = [];

  const findClass = async (documentId: string) => {
    return strapi.documents(UID.class).findOne({
      documentId,
      status: 'published',
      fields: ['id', 'documentId'],
      populate: {
        academic_year: {
          fields: ['id', 'academic_status'],
          populate: {
            school_admin: { fields: ['id', 'documentId'] },
          },
        },
      },
    });
  };

  for (const v of raw) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const documentId = v.trim();

    const found = await findClass(documentId);

    if (!found?.id) throw new Error(`class の documentId が不正です: ${documentId}`);

    const ownerSaDocId = found?.academic_year?.school_admin?.documentId;
    const academicStatus = String(found?.academic_year?.academic_status ?? '');
    if (!ownerSaDocId || ownerSaDocId !== tenantSchoolAdminDocId) {
      throw new Error(`このクラスにはアクセス権がありません: ${documentId}`);
    }
    if (!SELECTABLE_ACADEMIC_YEAR_STATUSES.has(academicStatus)) {
      throw new Error(`クラスが active/pending の年度に属していません: ${documentId}`);
    }

    ids.push(found.id);
  }

  return Array.from(new Set(ids));
};

type TeacherClassLite = { documentId: string; name: string };

const getTeacherClassesMapForSelectableAy = async (
  strapi,
  tenantSchoolAdminDocId: string,
  teacherIds: number[]
) => {
  const map = new Map<number, TeacherClassLite[]>();
  if (!teacherIds.length) return map;

  const ayRows = await strapi.db.query(UID.academicYear).findMany({
    where: {
      academic_status: { $in: ['active', 'pending'] },
      school_admin: { documentId: tenantSchoolAdminDocId },
    },
    select: ['id', 'academic_status'],
  });

  const selectableAyIds = (Array.isArray(ayRows) ? ayRows : [])
    .map((r) => (typeof r?.id === 'number' ? r.id : null))
    .filter((id): id is number => id !== null);
  if (!selectableAyIds.length) return map;

  const knex = strapi.db.connection;

  const rows = await knex('classes_teacher_lnk as ctl')
    .join('classes as c', 'c.id', 'ctl.class_id')
    .join('classes_academic_year_lnk as cal', 'cal.class_id', 'c.id')
    .whereIn('ctl.teacher_id', teacherIds)
    .whereIn('cal.academic_year_id', selectableAyIds)
    .select([
      'ctl.teacher_id as teacher_id',
      'c.document_id as class_document_id',
      'c.name as class_name',
      'ctl.class_ord as class_ord',
      'c.id as class_id',
    ])
    .orderBy([
      { column: 'ctl.teacher_id', order: 'asc' },
      { column: 'ctl.class_ord', order: 'asc' },
    ]);

  const seen = new Map<number, Set<number>>();

  for (const r of rows) {
    const tid = Number(r.teacher_id);
    const cid = Number(r.class_id);
    const docId = String(r.class_document_id ?? '').trim();
    const name = String(r.class_name ?? '').trim();

    if (!tid || !cid || !docId) continue;

    if (!seen.has(tid)) seen.set(tid, new Set());
    const s = seen.get(tid)!;
    if (s.has(cid)) continue;
    s.add(cid);

    const arr = map.get(tid) ?? [];
    arr.push({ documentId: docId, name: name || '-' });
    map.set(tid, arr);
  }

  return map;
};

const buildTeacherCreateInput = (payload: Record<string, unknown>): TeacherCreateInput => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const name_kana = typeof payload.name_kana === 'string' ? payload.name_kana.trim() : '';

  if (!name) throw new Error('`teacher.name` は必須です');
  if (!name_kana) throw new Error('`teacher.name_kana` は必須です');

  return {
    name,
    name_kana,
    birthday: typeof payload.birthday === 'string' ? payload.birthday : null,
    phone: typeof payload.phone === 'string' ? payload.phone.trim() || null : null,
    gender: toGender(payload.gender),
    email: typeof payload.email === 'string' ? payload.email.trim() : '',
    blocked: typeof payload.blocked === 'boolean' ? payload.blocked : false,
  };
};

const buildTeacherUpdateInput = (payload: Record<string, unknown>) => {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) throw new Error('`teacher.name` は必須です');

  const name_kana =
    typeof payload.name_kana === 'string' ? payload.name_kana.trim() || null : undefined;
  const birthday = hasOwn(payload, 'birthday')
    ? typeof payload.birthday === 'string'
      ? payload.birthday
      : null
    : undefined;
  const phone = hasOwn(payload, 'phone')
    ? typeof payload.phone === 'string'
      ? payload.phone.trim() || null
      : null
    : undefined;
  const email = hasOwn(payload, 'email')
    ? typeof payload.email === 'string'
      ? payload.email.trim() || null
      : null
    : undefined;
  const blocked = hasOwn(payload, 'blocked')
    ? typeof payload.blocked === 'boolean'
      ? payload.blocked
      : false
    : undefined;
  const gender = hasOwn(payload, 'gender') ? toGender(payload.gender) : undefined;
  if (hasOwn(payload, 'gender') && !gender) throw new Error('`teacher.gender` が不正です');

  return {
    name,
    name_kana,
    birthday,
    phone,
    gender,
    email,
    blocked,
  } satisfies TeacherUpdateInput;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_EMAIL_MESSAGE = 'メールアドレスは既に登録されています';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error ?? '');
};

const isDuplicateUserCredentialError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) return false;

  return (
    message.includes(DUPLICATE_EMAIL_MESSAGE.toLowerCase()) ||
    message.includes('メールアドレス(email)は既に登録されています') ||
    message.includes('メールアドレスはすでに登録されています') ||
    message.includes('email or username are already taken') ||
    message.includes('already taken') ||
    message.includes('already exists') ||
    message.includes('duplicate key') ||
    message.includes('er_dup_entry') ||
    message.includes('unique constraint') ||
    message.includes('violates unique')
  );
};

export default factories.createCoreController(UID.teacher, ({ strapi }: { strapi }) => ({
  async create(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const payload = readPayload(ctx);

    let input: TeacherCreateInput;
    try {
      input = buildTeacherCreateInput(payload);
    } catch (e) {
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }

    let classIds: number[] = [];
    try {
      classIds = await resolveClassIdsForTenant(strapi, payload.classes, tenantSa.documentId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      if (msg.startsWith('このクラスにはアクセス権がありません'))
        return ctx.forbidden('この操作を行う権限がありません');
      return ctx.badRequest(msg || 'クラス指定が不正です');
    }

    let roleId: number;
    try {
      roleId = await getRoleIdByType(strapi, 'teacher');
    } catch {
      return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');
    }

    let createdUserId: number | null = null;
    let createdTeacherDocId: string | null = null;
    let createdTeacherEntryId: number | null = null;

    const emailRaw = input.email?.trim() ?? '';
    if (emailRaw && !EMAIL_RE.test(emailRaw)) {
      return ctx.badRequest('メールアドレスの形式が不正です');
    }

    const userEmail = emailRaw ? emailRaw.toLowerCase() : null;
    const userUsername = userEmail || makePlaceholderUsername('teacher');
    if (emailRaw) {
      try {
        await ensureNoExistingUserEmail(strapi, userEmail);
      } catch (error) {
        if (isDuplicateUserCredentialError(error)) {
          return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
        }
        return ctx.badRequest(getErrorMessage(error) || 'メールアドレスの検証に失敗しました');
      }
    }

    try {
      const tempPassword = genTokenHex(24);

      const createdUser = await createLocalUser(strapi, {
        roleId,
        email: userEmail,
        username: userUsername,
        usePlaceholderEmail: false,
        password: tempPassword,
        blocked: input.blocked,
        confirmed: true,
        phone: input.phone,
      });

      createdUserId = toIdNumber(createdUser?.id);
      if (!createdUserId) return ctx.internalServerError('作成されたユーザー情報が不正です');

      await setUserSchoolAdmin(strapi, createdUserId, tenantSa.id);

      const passcode = await generateUniqueDigitsField(strapi, UID.teacher, 'passcode', 6, 50);

      const teacherData = {
        name: input.name,
        name_kana: input.name_kana,
        birthday: input.birthday,
        gender: input.gender,
        passcode,
        school_admin: tenantSa.id,
        users_permissions_user: createdUserId,
      };

      const createdTeacher = await strapi.documents(UID.teacher).create({
        data: teacherData,
        status: 'published',
      });

      createdTeacherDocId = createdTeacher.documentId;

      const publishedAfterCreate = await strapi.documents(UID.teacher).findOne({
        documentId: createdTeacherDocId,
        status: 'published',
        fields: ['id', 'documentId'],
      });

      const publishedTeacherEntryId = publishedAfterCreate?.id as number | undefined;
      if (!publishedTeacherEntryId)
        return ctx.internalServerError('教師データの公開レコードが見つかりません');

      createdTeacherEntryId = publishedTeacherEntryId;

      await assignTeacherToClasses(strapi, publishedTeacherEntryId, classIds);

      const dbTeacher = await strapi.db.query(UID.teacher).findOne({
        where: { id: publishedTeacherEntryId },
        populate: { classes: true, users_permissions_user: true, school_admin: true },
      });

      ctx.body = { data: sanitizeTeacher(dbTeacher) };
    } catch (err) {
      try {
        if (createdTeacherEntryId)
          await unassignTeacherFromClasses(strapi, [createdTeacherEntryId]);
        if (createdTeacherDocId)
          await strapi.documents(UID.teacher).delete({ documentId: createdTeacherDocId });
        if (createdUserId) await removeUser(strapi, createdUserId);
      } catch {
        // ignore
      }

      if (isDuplicateUserCredentialError(err)) {
        return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
      }

      return ctx.internalServerError('教師の作成に失敗しました');
    }
  },
  async update(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const { id } = ctx.params as { id?: string };
    const documentId = typeof id === 'string' ? id.trim() : '';
    if (!documentId) return ctx.badRequest('teacher の documentId が指定されていません');

    const payload = readPayload(ctx);

    let input: TeacherUpdateInput;
    try {
      input = buildTeacherUpdateInput(payload);
    } catch (e) {
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }

    try {
      const existing = await strapi.documents(UID.teacher).findOne({
        documentId,
        status: 'published',
        populate: { users_permissions_user: true, school_admin: true },
      });

      if (!existing) return ctx.notFound('教師が見つかりません');

      if (existing?.school_admin?.documentId !== tenantSa.documentId) {
        return ctx.forbidden('この操作を行う権限がありません');
      }

      const linkedUser = existing.users_permissions_user;

      let roleId: number;
      try {
        roleId = await getRoleIdByType(strapi, 'teacher');
      } catch {
        return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');
      }

      const userId = toIdNumber(linkedUser?.id);
      if (userId) {
        await updateUserCredentials(strapi, userId, {
          roleId,
          blocked: input.blocked ?? undefined,
          email: input.email ?? undefined,
          phone: input.phone ?? undefined,
        });

        await setUserSchoolAdmin(strapi, userId, tenantSa.id);
      }

      const teacherData: Record<string, unknown> = {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.name_kana !== undefined ? { name_kana: input.name_kana } : {}),
        ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      };

      if (Object.keys(teacherData).length) {
        await strapi.documents(UID.teacher).update({
          documentId,
          data: teacherData,
          status: 'published',
        });
      }

      if (hasOwn(payload, 'classes')) {
        let classIds: number[] = [];
        try {
          classIds = await resolveClassIdsForTenant(strapi, payload.classes, tenantSa.documentId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e ?? '');
          if (msg.startsWith('このクラスにはアクセス権がありません'))
            return ctx.forbidden('この操作を行う権限がありません');
          return ctx.badRequest(msg || 'クラス指定が不正です');
        }

        const publishedTeacher = await strapi.documents(UID.teacher).findOne({
          documentId,
          status: 'published',
          fields: ['id', 'documentId'],
        });

        if (!publishedTeacher?.id)
          return ctx.internalServerError('教師データの公開レコードが見つかりません');
        const publishedTeacherId = publishedTeacher.id as number;

        await unassignTeacherFromClasses(strapi, [publishedTeacherId]);
        await assignTeacherToClasses(strapi, publishedTeacherId, classIds);
      }

      const updated = await strapi.documents(UID.teacher).findOne({
        documentId,
        status: 'published',
        populate: { users_permissions_user: true, school_admin: true, classes: true },
      });

      ctx.body = { data: sanitizeTeacher(updated) };
    } catch (err) {
      if (isDuplicateUserCredentialError(err)) {
        return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
      }
      return ctx.internalServerError(
        err instanceof Error ? err.message : '教師の更新に失敗しました'
      );
    }
  },
  async findOne(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const { id } = ctx.params as { id?: string };
    const documentId = typeof id === 'string' ? id.trim() : '';
    if (!documentId) return ctx.badRequest('teacher の documentId が指定されていません');

    const row = await strapi.db.query(UID.teacher).findOne({
      where: {
        documentId,
        school_admin: { documentId: tenantSa.documentId },
      },
      populate: {
        users_permissions_user: true,
        classes: {
          select: ['id', 'documentId', 'name'],
          populate: {
            academic_year: {
              select: ['id', 'documentId', 'name', 'academic_status'],
            },
          },
        },
        school_admin: true,
      },
    });

    if (!row) return ctx.notFound('教師が見つかりません');

    ctx.body = { data: sanitizeTeacher(row) };
  },

  async find(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const prevQuery = toRecord(ctx.query);
    const prevFilters = toRecord(prevQuery.filters);

    const sa = toRecord(prevFilters.school_admin);
    const docId = toRecord(sa.documentId);
    const feSaDocId = typeof docId.$eq === 'string' ? docId.$eq : null;

    if (feSaDocId && feSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません');
    }

    const prevPopulate = toRecord(prevQuery.populate);
    const hasSort = typeof prevQuery.sort !== 'undefined';

    ctx.query = {
      ...prevQuery,
      filters: {
        ...prevFilters,
        school_admin: {
          ...sa,
          documentId: { $eq: tenantSa.documentId },
        },
      },
      populate: {
        ...prevPopulate,
        users_permissions_user: { fields: ['email', 'phone', 'blocked'] },
        school_admin: { fields: ['name', 'documentId'] },
      },
      ...(hasSort ? {} : { sort: ['name:asc'] }),
    };

    const res = await super.find(ctx);
    const list = Array.isArray(res?.data) ? res.data : [];

    const teacherIds = list
      .map((t) => toRecord(t).id)
      .filter((x): x is number => typeof x === 'number');

    const classesMap = await getTeacherClassesMapForSelectableAy(
      strapi,
      tenantSa.documentId,
      teacherIds
    );

    const enhanced = list.map((t) => {
      const tr = toRecord(t);
      const tid = typeof tr.id === 'number' ? tr.id : null;
      return {
        ...t,
        classes: tid ? (classesMap.get(tid) ?? []) : [],
      };
    });

    return { data: enhanced, meta: res?.meta };
  },
  async loginByPasscode(ctx) {
    const body = (ctx.request.body ?? {}) as { passcode?: unknown };
    const passcode =
      typeof body.passcode === 'string' ? body.passcode.trim() : String(body.passcode ?? '').trim();

    if (!/^\d{6}$/.test(passcode)) return ctx.badRequest('`passcode` は6桁で入力してください');

    const teacher = await strapi.db.query(UID.teacher).findOne({
      where: { passcode },
      select: ['id', 'documentId', 'name'],
      populate: {
        users_permissions_user: { select: ['id', 'documentId', 'email', 'phone', 'blocked'] },
        school_admin: { select: ['id', 'documentId', 'name'] },
      },
    });

    if (!teacher) return ctx.unauthorized('パスコードが正しくありません');

    const user = teacher.users_permissions_user;
    const userId = toIdNumber(user?.id);
    if (!userId) return ctx.internalServerError('教師に紐づくユーザーが存在しません');
    if (user?.blocked) return ctx.unauthorized('ユーザーは無効化されています');

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: userId });

    ctx.body = {
      jwt,
      teacher: sanitizeTeacher(teacher),
    };
  },

  async studentsPresenceInClass(ctx) {
    const tenantSa = await getTenantByTeacher(strapi, ctx);
    console.log('tenantSa:', tenantSa);
    if (!tenantSa)
      return ctx.forbidden('この操作を行う権限がありません（学校管理者情報が取得できません）');

    const q = (ctx.query ?? {}) as Record<string, unknown>;
    const classDocId = typeof q.class === 'string' ? q.class.trim() : '';
    if (!classDocId) return ctx.badRequest('`class` (documentId) は必須です');

    const threshold = Math.max(10, Number(q.online_threshold ?? 120) || 120);

    const { page, pageSize, offset } = parsePagination(ctx);

    const cls = await strapi.documents(UID.class).findOne({
      documentId: classDocId,
      status: 'published',
      fields: ['id', 'documentId', 'name'],
      populate: {
        academic_year: {
          fields: ['id'],
          populate: {
            school_admin: { fields: ['documentId'] },
          },
        },
      },
    });

    if (!cls?.id) return ctx.badRequest('`class` (documentId) が不正です');

    const ownerSaDocId = cls?.academic_year?.school_admin?.documentId;
    if (!ownerSaDocId || ownerSaDocId !== tenantSa.documentId) {
      return ctx.forbidden('この操作を行う権限がありません: クラスがテナント外です');
    }

    const userId = toIdNumber(ctx.state?.user?.id);
    if (!userId) return ctx.unauthorized('認証が必要です');

    const teacher = await strapi.db.query(UID.teacher).findOne({
      where: { users_permissions_user: userId },
      select: ['id'],
      populate: { school_admin: { select: ['documentId'] } },
    });

    if (!teacher?.id) return ctx.unauthorized('教師が見つかりません');
    if (teacher?.school_admin?.documentId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません: 教師がテナント外です');

    const classEntryId = Number(cls.id);
    const teacherEntryId = Number(teacher.id);

    const knex = strapi.db.connection;

    const jt = getRelationJoinTable(strapi, UID.teacher, 'classes');
    const link = await knex(jt.table)
      .where({ [jt.sourceCol]: teacherEntryId, [jt.targetCol]: classEntryId })
      .first();

    if (!link)
      return ctx.forbidden('この操作を行う権限がありません: 教師がクラスに紐づいていません');

    const totalRow = (await knex('students_class_lnk as scl')
      .where('scl.class_id', classEntryId)
      .count({ cnt: '*' })) as Array<{ cnt: string | number }>;

    const total = Number(totalRow?.[0]?.cnt ?? 0);

    const rows = await knex('students as s')
      .join('students_class_lnk as scl', 'scl.student_id', 's.id')
      .where('scl.class_id', classEntryId)
      .select([
        's.id as id',
        's.document_id as documentId',
        's.name as name',
        's.name_kana as name_kana',
        's.last_seen_at as last_seen_at',
        knex.raw(`
      CASE
        WHEN s.last_seen_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (timezone('utc', now()) - s.last_seen_at)))::int
      END as last_seen_age_seconds
    `),
      ])
      .orderBy('s.name', 'asc')
      .offset(offset)
      .limit(pageSize);

    const data = (rows ?? []).map((r) => {
      const ageSeconds =
        r.last_seen_age_seconds === null || typeof r.last_seen_age_seconds === 'undefined'
          ? null
          : Number(r.last_seen_age_seconds);

      const status =
        ageSeconds == null ? 'unknown' : ageSeconds <= threshold ? 'online' : 'offline';

      return {
        id: Number(r.id),
        documentId: String(r.documentId ?? ''),
        name: String(r.name ?? ''),
        name_kana: String(r.name_kana ?? ''),
        last_seen_at: r.last_seen_at ?? null,
        last_seen_age_seconds: ageSeconds,
        presence_status: status,
      };
    });
    const onlineRow = (await knex('students as s')
      .join('students_class_lnk as scl', 'scl.student_id', 's.id')
      .where('scl.class_id', classEntryId)
      .whereNotNull('s.last_seen_at')
      .andWhere(
        's.last_seen_at',
        '>=',
        knex.raw(`timezone('utc', now()) - (? * interval '1 second')`, [threshold])
      )
      .count({ cnt: '*' })) as Array<{ cnt: string | number }>;

    const onlineTotal = Number(onlineRow?.[0]?.cnt ?? 0);

    ctx.body = {
      data,
      meta: {
        server_time: new Date().toISOString(),
        presence: {
          online_threshold_seconds: threshold,
          online_count: onlineTotal,
          total_count: total,
        },
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize),
          total,
        },
        class: {
          documentId: cls.documentId,
          name: cls.name ?? '-',
        },
      },
    };
  },

  async importTeachers(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const file = ctx.request?.files?.file;
    if (!file) return ctx.badRequest('`file` が指定されていません');

    const { buf, filename } = await readUploadToBuffer(file);
    const rows = parseImportFile(buf, filename);
    if (!rows.length) {
      ctx.body = { data: { created: 0, failed: 0, errors: [] } };
      return;
    }

    const ayRows = await strapi.db.query(UID.academicYear).findMany({
      where: {
        academic_status: { $in: ['active', 'pending'] },
        school_admin: { documentId: tenantSa.documentId },
      },
      select: ['id', 'documentId', 'name', 'academic_status'],
    });

    const selectableAys = (Array.isArray(ayRows) ? ayRows : []).filter(
      (ay): ay is { id: number; documentId: string; name?: string; academic_status?: string } =>
        typeof ay?.id === 'number' && typeof ay?.documentId === 'string'
    );

    if (!selectableAys.length) {
      return ctx.badRequest('active または pending の年度が見つかりません');
    }

    const ayByDocId = new Map<string, (typeof selectableAys)[number]>();
    const ayByName = new Map<string, Array<(typeof selectableAys)[number]>>();
    for (const ay of selectableAys) {
      ayByDocId.set(ay.documentId.trim(), ay);
      const ayName = String(ay.name ?? '').trim();
      if (!ayName) continue;
      const arr = ayByName.get(ayName) ?? [];
      arr.push(ay);
      ayByName.set(ayName, arr);
    }

    const resolveAcademicYearFromRaw = (raw: string) => {
      const key = raw.trim();
      if (!key) return null;

      const byDocId = ayByDocId.get(key);
      if (byDocId) return byDocId;

      const byName = ayByName.get(key) ?? [];
      if (!byName.length) throw new Error(`年度が見つかりません: ${key}`);
      if (byName.length > 1) throw new Error(`年度名が重複しています: ${key}`);
      return byName[0];
    };

    const selectableAyIds = selectableAys.map((ay) => ay.id);
    const classRows = await strapi.db
      .connection('classes as c')
      .join('classes_academic_year_lnk as cal', 'cal.class_id', 'c.id')
      .whereIn('cal.academic_year_id', selectableAyIds)
      .select([
        'c.id as class_id',
        'c.name as class_name',
        'cal.academic_year_id as academic_year_id',
      ])
      .orderBy([
        { column: 'cal.academic_year_id', order: 'asc' },
        { column: 'c.name', order: 'asc' },
      ]);

    const classIdsByAyAndName = new Map<string, number[]>();
    for (const row of classRows ?? []) {
      const classId = Number(row.class_id);
      const ayId = Number(row.academic_year_id);
      const className = String(row.class_name ?? '').trim();
      if (!classId || !ayId || !className) continue;
      const key = `${ayId}::${className}`;
      const arr = classIdsByAyAndName.get(key) ?? [];
      arr.push(classId);
      classIdsByAyAndName.set(key, arr);
    }

    const result = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };

    let roleId: number;
    try {
      roleId = await getRoleIdByType(strapi, 'teacher');
    } catch {
      return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');
    }

    for (let i = 0; i < rows.length; i++) {
      const excelRowNumber = i + 2;

      let createdUserId: number | null = null;
      let createdTeacherDocId: string | null = null;
      let createdTeacherEntryId: number | null = null;

      try {
        const r = pickTeacherRowJP(rows[i]);
        if (!r.name_kana) throw new Error('フリガナ(name_kana)は必須です');

        const name = (r.name ?? '').trim();
        if (!isRealPersonName(name)) throw new Error('氏名(name)に記号が含まれているか、空欄です');
        const name_kana = r.name_kana.trim();

        const gender = r.gender ? toGender(r.gender) : null;
        if (r.gender && !gender) throw new Error('性別(gender)が不正です');

        let targetAyId: number | null = null;
        if (r.classNames.length) {
          const ayRaw = String(r.academic_year ?? '').trim();
          if (!ayRaw) {
            throw new Error('担当クラスを指定する場合はクラス年度が必須です');
          }
          const ay = resolveAcademicYearFromRaw(ayRaw);
          if (!ay?.id) throw new Error(`年度が見つかりません: ${ayRaw}`);
          targetAyId = ay.id;
        }

        const classIds: number[] = [];
        for (const cn of r.classNames) {
          if (!targetAyId) throw new Error('対象の年度が不正です');
          const ids = classIdsByAyAndName.get(`${targetAyId}::${cn}`) ?? [];
          if (!ids.length) throw new Error(`選択した年度にクラスが見つかりません: ${cn}`);
          if (ids.length > 1) throw new Error(`選択した年度内でクラス名が重複しています: ${cn}`);
          classIds.push(ids[0]);
        }
        const uniqClassIds = Array.from(new Set(classIds));

        const emailRaw = r.email?.trim() ?? '';
        let userEmail: string | null = null;
        if (emailRaw) {
          if (hasNonAsciiChars(emailRaw)) {
            throw new Error('全角文字は使用できません。半角で入力してください');
          }
          if (!EMAIL_RE.test(emailRaw)) {
            throw new Error('メールアドレス(email)の形式が不正です');
          }

          userEmail = emailRaw.toLowerCase();

          const existed = await strapi.query('plugin::users-permissions.user').findOne({
            where: { email: userEmail },
            select: ['id', 'email'],
          });

          if (existed?.id) {
            throw new Error('メールアドレス(email)は既に登録されています');
          }
        }
        const userUsername = userEmail || makePlaceholderUsername('teacher');

        const tempPassword = genTokenHex(24);

        const createdUser = await createLocalUser(strapi, {
          roleId,
          email: userEmail,
          username: userUsername,
          usePlaceholderEmail: false,
          password: tempPassword,
          blocked: false,
          confirmed: true,
          phone: r.phone?.trim() || null,
        });

        createdUserId = toIdNumber(createdUser?.id);
        if (!createdUserId) throw new Error('作成されたユーザー情報が不正です');

        await setUserSchoolAdmin(strapi, createdUserId, tenantSa.id);

        const passcode = await generateUniqueDigitsField(strapi, UID.teacher, 'passcode', 6, 50);

        const teacherData = {
          name,
          name_kana,
          birthday: r.birthday ?? null,
          gender,
          passcode,
          school_admin: tenantSa.id,
          users_permissions_user: createdUserId,
        };

        const createdTeacher = await strapi.documents(UID.teacher).create({
          data: teacherData,
          status: 'published',
        });

        createdTeacherDocId = createdTeacher.documentId;

        const publishedAfterCreate = await strapi.documents(UID.teacher).findOne({
          documentId: createdTeacherDocId,
          status: 'published',
          fields: ['id', 'documentId'],
        });

        createdTeacherEntryId =
          typeof publishedAfterCreate?.id === 'number' ? publishedAfterCreate.id : null;

        if (!createdTeacherEntryId) throw new Error('教師データの公開レコードが見つかりません');

        await assignTeacherToClasses(strapi, createdTeacherEntryId, uniqClassIds);

        result.created++;
      } catch (e) {
        result.failed++;
        result.errors.push({
          row: excelRowNumber,
          message: e instanceof Error ? e.message : '行データが不正です',
        });

        try {
          if (createdTeacherEntryId)
            await unassignTeacherFromClasses(strapi, [createdTeacherEntryId]);
          if (createdTeacherDocId)
            await strapi.documents(UID.teacher).delete({ documentId: createdTeacherDocId });
          if (createdUserId) await removeUser(strapi, createdUserId);
        } catch {
          // ignore
        }
      }
    }

    ctx.body = { data: result };
  },

  async delete(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const { id } = ctx.params as { id?: string };
    const documentId = typeof id === 'string' ? id.trim() : '';
    if (!documentId) return ctx.badRequest('teacher の documentId が指定されていません');

    const existing = await strapi.documents(UID.teacher).findOne({
      documentId,
      status: 'published',
      populate: {
        users_permissions_user: { fields: ['id'] },
        school_admin: { fields: ['documentId'] },
      },
    });

    if (!existing) return ctx.notFound('教師が見つかりません');
    if (existing?.school_admin?.documentId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません');

    const teacherEntryId = typeof existing.id === 'number' ? existing.id : null;
    const userId =
      typeof existing?.users_permissions_user?.id === 'number'
        ? existing.users_permissions_user.id
        : null;

    try {
      if (teacherEntryId) await unassignTeacherFromClasses(strapi, [teacherEntryId]);

      await strapi.documents(UID.teacher).delete({ documentId });

      if (userId) {
        await strapi.db.query('plugin::users-permissions.user').deleteMany({
          where: { id: { $in: [userId] } },
        });
      }

      if (teacherEntryId) {
        await deleteProjectsByOwnerWithAssets(strapi, {
          where: { teacher: teacherEntryId },
          logPrefix: 'teacher.delete',
        });
      }

      ctx.body = { data: { deleted: true, deletedUsers: userId ? 1 : 0 } };
    } catch (e) {
      strapi.log.error('[teacher.delete] failed', e);
      return ctx.internalServerError('教師の削除に失敗しました');
    }
  },
}));
