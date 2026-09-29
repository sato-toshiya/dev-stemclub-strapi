import { factories } from '@strapi/strapi';

import { UID } from '../../../constants/uids';

import { readPayload } from '../../../utils/http/payload';
import { toRecord } from '../../../utils/values/record';
import { toIdNumber } from '../../../utils/values/id';
import { hasNonAsciiChars, isRealPersonName } from '../../../utils/values/string';

import {
  Gender,
  GuardianRelationship,
  toGender,
  toGuardianRelationship,
} from '../../../constants/enums';

import { getRoleIdByType } from '../../../utils/users-permissions/roles';
import {
  createLocalUser,
  setUserSchoolAdmin,
  makePlaceholderEmail,
} from '../../../utils/users-permissions/user';

import { sanitizeEntityUser } from '../../../utils/sanitize/users';
import { requireTenantSchoolAdmin } from '../../../utils/tenant-guard';
import { getDocumentIdParam } from '../../../utils/http/param';
import { buildQrPdfBufferByClass, ClassGroup, StudentPrintRow } from '../services/qr-pdf';
import { genDigits, generateUniqueFieldToken, genTokenHex } from '../../../utils/tokens';
import { parseImportFile, readUploadToBuffer } from '../../../utils/import/file';
import { pickStudentRowJP } from '../services/import';
import { buildStudentUpsertData, StudentDocInput } from '../services/upsert';
import { generateUniqueStudentCodeForClass } from '../services/code';
import { resolveClassIdForTenantOrNull } from '../services/relations';
import { POPULATE_SAFE, StudentSafeRow } from '../services/safe';
import { deleteProjectsByOwnerWithAssets } from '../../../utils/project-cleanup';

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

const assertTenantStudent = (ctx, tenantSa, student) => {
  const ownerDocId = student?.school_admin?.documentId;
  if (!ownerDocId || ownerDocId !== tenantSa.documentId) {
    ctx.forbidden('この操作を行う権限がありません');
    return false;
  }
  return true;
};

const getProjectsCountMap = async (strapi, studentIds: number[]) => {
  const map = new Map<number, number>();
  if (!studentIds.length) return map;

  const knex = strapi.db.connection;

  const rows = (await knex('projects_student_lnk')
    .whereIn('student_id', studentIds)
    .select('student_id')
    .countDistinct({ cnt: 'project_id' })
    .groupBy('student_id')) as Array<{ student_id: number; cnt: string | number }>;

  for (const r of rows) map.set(Number(r.student_id), Number(r.cnt));
  return map;
};

export const sanitizeStudent = (s: unknown) => {
  if (!s || typeof s !== 'object') return s;
  return sanitizeEntityUser(s as Record<string, unknown>);
};

export default factories.createCoreController(UID.student, ({ strapi }) => ({
  async find(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const prevQuery = toRecord(ctx.query);
    const prevFilters = toRecord(prevQuery.filters);

    const sa = toRecord(prevFilters.school_admin);
    const docId = toRecord(sa.documentId);
    const feSaDocId = typeof docId.$eq === 'string' ? docId.$eq : null;

    if (feSaDocId && feSaDocId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません');

    const prevPopulateRaw = prevQuery.populate;
    const prevPopulate =
      prevPopulateRaw && typeof prevPopulateRaw === 'object' && !Array.isArray(prevPopulateRaw)
        ? (prevPopulateRaw as Record<string, unknown>)
        : {};

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
        school_admin: { fields: ['name', 'documentId'] },
        users_permissions_user: { fields: ['email', 'phone', 'blocked'] },
        class: { fields: ['name', 'documentId'] },
      },
    };

    const { data, meta } = (await super.find(ctx)) as { data: unknown; meta: unknown };
    const list = Array.isArray(data) ? data : [];

    const studentIds = list
      .map((s) => toRecord(s).id as unknown)
      .filter((x): x is number => typeof x === 'number');

    const projectsCountMap = await getProjectsCountMap(strapi, studentIds);

    const enhanced = list.map((s) => {
      const sid = toRecord(s).id;
      return {
        ...s,
        projectsCount: typeof sid === 'number' ? (projectsCountMap.get(sid) ?? 0) : 0,
      };
    });

    return { data: enhanced, meta };
  },

  async findOne(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const documentId = getDocumentIdParam(ctx);
    if (!documentId) return ctx.badRequest('student の documentId が指定されていません');

    const row = (await strapi.documents(UID.student).findOne({
      documentId,
      status: 'published',
      populate: POPULATE_SAFE,
    })) as StudentSafeRow | null;

    if (!row) return ctx.notFound('生徒が見つかりません');

    const ownerDocId = row.school_admin?.documentId;
    if (!ownerDocId || ownerDocId !== tenantSa.documentId) {
      return ctx.notFound('生徒が見つかりません');
    }

    ctx.body = { data: row };
  },
  async update(ctx) {
    const documentId = getDocumentIdParam(ctx);
    if (!documentId) return ctx.badRequest('student の documentId が指定されていません');

    const payload = readPayload(ctx);
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const existing = await strapi.documents(UID.student).findOne({
      documentId,
      populate: {
        users_permissions_user: true,
        class: { fields: ['id', 'documentId'] },
        school_admin: { fields: ['id', 'documentId'] },
      },
    });

    if (!existing) return ctx.notFound('生徒が見つかりません');
    if (!assertTenantStudent(ctx, tenantSa, existing)) return;

    const linkedUserId = toIdNumber(existing?.users_permissions_user?.id);
    if (linkedUserId) {
      try {
        const blocked = typeof payload.blocked === 'boolean' ? payload.blocked : undefined;
        const phone = typeof payload.phone === 'string' ? payload.phone.trim() || null : undefined;
        const email = typeof payload.email === 'string' ? payload.email.trim() || null : undefined;

        const userData: Record<string, unknown> = {};
        if (blocked !== undefined) userData.blocked = blocked;
        if (phone !== undefined) userData.phone = phone;

        if (email) {
          userData.email = email;
          userData.username = email;
        }

        if (Object.keys(userData).length) {
          await strapi.plugin('users-permissions').service('user').edit(linkedUserId, userData);
        }

        await setUserSchoolAdmin(strapi, linkedUserId, tenantSa.id);
      } catch (e) {
        if (isDuplicateUserCredentialError(e)) {
          return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
        }
        return ctx.badRequest(getErrorMessage(e) || 'ユーザー情報の更新に失敗しました');
      }
    }

    try {
      const { studentData } = await buildStudentUpsertData({
        strapi,
        payload,
        tenantSa,
        mode: 'update',
        base: existing,
      });

      await strapi.documents(UID.student).update({
        documentId,
        data: studentData,
        status: 'published',
      });

      const updated = await strapi.documents(UID.student).findOne({
        documentId,
        status: 'published',
        populate: POPULATE_SAFE,
      });

      ctx.body = { data: updated };
    } catch (e) {
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }
  },
  async create(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);
    const payload = readPayload(ctx);

    try {
      const { studentData } = await buildStudentUpsertData({
        strapi,
        payload,
        tenantSa,
        mode: 'create',
      });

      const created = await strapi.documents(UID.student).create({
        data: studentData,
        status: 'published',
        populate: POPULATE_SAFE,
      });

      ctx.body = { data: created };
    } catch (e) {
      return ctx.badRequest(e instanceof Error ? e.message : 'リクエストデータが不正です');
    }
  },

  async loginByQr(ctx) {
    const body = (ctx.request.body ?? {}) as { token?: unknown; qr_token?: unknown };

    const token =
      typeof body.token === 'string'
        ? body.token.trim()
        : typeof body.qr_token === 'string'
          ? body.qr_token.trim()
          : String(body.token ?? body.qr_token ?? '').trim();

    if (!token) return ctx.badRequest('`token` は必須です');

    const student = await strapi.db.query(UID.student).findOne({
      where: { qr_token: token },
      select: ['id', 'documentId', 'name', 'name_kana', 'qr_token'],
      populate: {
        users_permissions_user: { select: ['id', 'documentId', 'email', 'phone', 'blocked'] },
        school_admin: { select: ['id', 'documentId', 'name'] },
        class: { select: ['id', 'documentId', 'name'] },
      },
    });

    if (!student) return ctx.unauthorized('QRコードが不正です');

    const user = student.users_permissions_user;
    const userId = toIdNumber(user?.id);
    if (!userId) return ctx.internalServerError('生徒に紐づくユーザーが存在しません');
    if (user?.blocked) return ctx.unauthorized('ユーザーは無効化されています');

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: userId });

    ctx.body = {
      jwt,
      student: sanitizeStudent(student),
    };
  },

  async regenerateQr(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const documentId = getDocumentIdParam(ctx);
    if (!documentId) return ctx.badRequest('student の documentId が指定されていません');

    const existing = await strapi.db.query(UID.student).findOne({
      where: { documentId },
      select: ['id', 'documentId'],
      populate: { school_admin: { select: ['documentId'] } },
    });

    if (!existing) return ctx.notFound('生徒が見つかりません');
    if (existing?.school_admin?.documentId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません');

    const newToken = await generateUniqueFieldToken(strapi, UID.student, 'qr_token');

    await strapi.db.query(UID.student).update({
      where: { id: existing.id },
      data: { qr_token: newToken },
    });

    ctx.body = { data: { documentId: existing.documentId, qr_token: newToken } };
  },

  async exportQrPdf(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const q = toRecord(ctx.query);
    const classDocId = String(q.class ?? '').trim();

    const filters: Record<string, unknown> = {
      school_admin: { documentId: { $eq: tenantSa.documentId } },
    };

    if (classDocId) {
      const classId = await resolveClassIdForTenantOrNull(strapi, classDocId, tenantSa.documentId);
      if (!classId) return ctx.badRequest('`class` (documentId) が不正です');
      filters.class = { documentId: { $eq: classDocId } };
    }

    const students = await strapi.documents(UID.student).findMany({
      filters,
      fields: ['name', 'name_kana', 'qr_token'],
      populate: { class: { fields: ['name', 'documentId'] } },
      sort: [{ name: 'asc' }],
      pagination: { page: 1, pageSize: 10000 },
      status: 'published',
    });

    const list = Array.isArray(students) ? students : [];

    const rows: StudentPrintRow[] = list
      .filter((s) => typeof s?.qr_token === 'string' && String(s.qr_token).trim())
      .map((s) => {
        const sRec = toRecord(s);
        const cls = toRecord(sRec.class);
        return {
          name: String(sRec.name ?? '').trim() || '-',
          name_kana: String(sRec.name_kana ?? '').trim() || '-',
          qr_token: String(sRec.qr_token ?? '').trim(),
          className: String(cls.name ?? '').trim() || '-',
        };
      });

    let pdfBuf: Buffer;

    if (classDocId) {
      const className = rows[0]?.className ?? '-';
      pdfBuf = await buildQrPdfBufferByClass([{ className, rows }]);
    } else {
      const map = new Map<string, StudentPrintRow[]>();

      for (const r of rows) {
        const key = r.className || '-';
        const arr = map.get(key) ?? [];
        arr.push(r);
        map.set(key, arr);
      }

      const groups: ClassGroup[] = Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ja'))
        .map(([className, rs]) => ({
          className,
          rows: rs.sort((x, y) => x.name.localeCompare(y.name, 'ja')),
        }));

      pdfBuf = await buildQrPdfBufferByClass(groups);
    }

    const fname = classDocId ? `students_qr_${classDocId}.pdf` : `students_qr_all.pdf`;
    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', `attachment; filename="${fname}"`);
    ctx.body = pdfBuf;
  },

  async exportQrPdfOne(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const documentId = getDocumentIdParam(ctx);
    if (!documentId) return ctx.badRequest('student の documentId が指定されていません');

    const student = await strapi.documents(UID.student).findOne({
      documentId,
      fields: ['name', 'name_kana', 'qr_token'],
      populate: {
        class: { fields: ['name', 'documentId'] },
        school_admin: { fields: ['documentId'] },
      },
      status: 'published',
    });

    if (!student) return ctx.notFound('生徒が見つかりません');

    const sRec = toRecord(student);
    const saRec = toRecord(sRec.school_admin);
    const ownerDocId = typeof saRec.documentId === 'string' ? saRec.documentId : null;

    if (!ownerDocId || ownerDocId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません');

    const qr = String(sRec.qr_token ?? '').trim();
    if (!qr) return ctx.badRequest('生徒に qr_token が設定されていません');

    const cls = toRecord(sRec.class);
    const className = String(cls.name ?? '').trim() || '-';
    const row: StudentPrintRow = {
      name: String(sRec.name ?? '').trim() || '-',
      name_kana: String(sRec.name_kana ?? '').trim() || '-',
      qr_token: qr,
      className,
    };

    const pdfBuf = await buildQrPdfBufferByClass([{ className, rows: [row] }]);

    const fname = `student_qr_${documentId}.pdf`;
    ctx.set('Content-Type', 'application/pdf');
    ctx.set('Content-Disposition', `attachment; filename="${fname}"`);
    ctx.body = pdfBuf;
  },

  async markSeen(ctx) {
    const userId = toIdNumber(ctx.state?.user?.id);
    if (!userId) return ctx.unauthorized('認証が必要です');

    const body = (ctx.request.body ?? {}) as { status?: unknown };
    const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';
    const status: 'online' | 'offline' = statusRaw === 'offline' ? 'offline' : 'online';

    const student = await strapi.db.query(UID.student).findOne({
      where: { users_permissions_user: userId },
      select: ['id'],
    });

    if (!student?.id) return ctx.notFound('生徒が見つかりません');

    const knex = strapi.db.connection;

    const OFFLINE_THRESHOLD_SECONDS = 120;

    if (status === 'offline') {
      await knex('students')
        .where({ id: student.id })
        .update({
          last_seen_at: knex.raw("timezone('utc', now()) - (? * interval '1 second')", [
            OFFLINE_THRESHOLD_SECONDS + 1,
          ]),
          updated_at: knex.raw("timezone('utc', now())"),
        });

      ctx.body = { updated: true, status: 'offline' };
      return;
    }

    const WINDOW_SECONDS = 30;

    const updatedCount = await knex('students')
      .where({ id: student.id })
      .andWhere((qb) => {
        qb.whereNull('last_seen_at').orWhere(
          'last_seen_at',
          '<=',
          knex.raw("timezone('utc', now()) - (? * interval '1 second')", [WINDOW_SECONDS])
        );
      })
      .update({
        last_seen_at: knex.raw("timezone('utc', now())"),
        updated_at: knex.raw("timezone('utc', now())"),
      });

    ctx.body = { updated: updatedCount > 0, status: 'online' };
  },

  async importStudents(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);
    const body = toRecord(ctx.request?.body);
    const payload = readPayload(ctx);
    const query = toRecord(ctx.query);
    const pickText = (...values: unknown[]): string => {
      for (const value of values) {
        if (typeof value === 'string') {
          const normalized = value.trim();
          if (normalized) return normalized;
          continue;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          const normalized = String(value).trim();
          if (normalized) return normalized;
          continue;
        }
        if (Array.isArray(value)) {
          for (const nested of value) {
            if (typeof nested === 'string') {
              const normalized = nested.trim();
              if (normalized) return normalized;
            }
          }
        }
      }
      return '';
    };
    const targetAcademicYearDocumentId = pickText(
      payload.target_academic_year_document_id,
      body.target_academic_year_document_id,
      query.target_academic_year_document_id
    );
    const targetClassDocumentId = pickText(
      payload.target_class_document_id,
      body.target_class_document_id,
      query.target_class_document_id
    );
    const hasTargetAcademicYear = !!targetAcademicYearDocumentId;
    const hasTargetClass = !!targetClassDocumentId;
    if (hasTargetAcademicYear !== hasTargetClass) {
      return ctx.badRequest(
        '取り込み先を指定する場合は、クラス年度とクラスを両方指定してください。'
      );
    }

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
      return ctx.badRequest('実施中または準備中の年度が見つかりません');
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
        'c.document_id as class_document_id',
        'c.name as class_name',
        'cal.academic_year_id as academic_year_id',
      ])
      .orderBy([
        { column: 'cal.academic_year_id', order: 'asc' },
        { column: 'c.name', order: 'asc' },
      ]);

    const classIdsByAyAndName = new Map<string, number[]>();
    const classMetaByDocId = new Map<
      string,
      { classId: number; className: string; academicYearId: number }
    >();
    const ayNameById = new Map<number, string>();
    const normalizeStudentNameForClassUnique = (name: string) =>
      name.trim().replace(/\s+/g, ' ').toLowerCase();

    for (const row of classRows ?? []) {
      const classId = Number(row.class_id);
      const ayId = Number(row.academic_year_id);
      const classDocId = String(row.class_document_id ?? '').trim();
      const className = String(row.class_name ?? '').trim();
      if (!classId || !ayId || !className) continue;

      const key = `${ayId}::${className}`;
      const arr = classIdsByAyAndName.get(key) ?? [];
      arr.push(classId);
      classIdsByAyAndName.set(key, arr);

      if (!ayNameById.has(ayId)) {
        const ay = selectableAys.find((item) => item.id === ayId);
        ayNameById.set(ayId, String(ay?.name ?? '').trim() || String(ay?.documentId ?? '').trim());
      }

      if (classDocId) {
        classMetaByDocId.set(classDocId, {
          classId,
          className,
          academicYearId: ayId,
        });
      }
    }

    let fixedTargetClassId: number | null = null;
    let fixedTargetAcademicYearLabel = '';
    if (hasTargetAcademicYear && hasTargetClass) {
      const targetAcademicYear = ayByDocId.get(targetAcademicYearDocumentId);
      if (!targetAcademicYear?.id) {
        return ctx.badRequest(
          '指定されたクラス年度は存在しないか、取り込み対象（実施中・準備中）ではありません。'
        );
      }

      fixedTargetAcademicYearLabel =
        String(targetAcademicYear.name ?? '').trim() ||
        String(targetAcademicYear.documentId ?? '').trim();

      const targetClass = classMetaByDocId.get(targetClassDocumentId);
      if (!targetClass) {
        return ctx.badRequest('指定されたクラスは存在しないか、取り込み対象外です。');
      }
      if (targetClass.academicYearId !== targetAcademicYear.id) {
        return ctx.badRequest('指定されたクラスは、指定されたクラス年度に属していません。');
      }

      fixedTargetClassId = targetClass.classId;
    }

    const selectableClassIds = Array.from(
      new Set((classRows ?? []).map((row) => Number(row.class_id)).filter((id) => id > 0))
    );

    const existingClassStudentNameKeySet = new Set<string>();
    if (selectableClassIds.length) {
      const existingStudentRows = await strapi.db
        .connection('students as s')
        .join('students_class_lnk as scl', 'scl.student_id', 's.id')
        .whereIn('scl.class_id', selectableClassIds)
        .select(['scl.class_id as class_id', 's.name as student_name']);

      for (const row of existingStudentRows ?? []) {
        const classId = Number(row.class_id);
        const studentName = String(row.student_name ?? '').trim();
        if (!classId || !studentName) continue;
        const normalizedName = normalizeStudentNameForClassUnique(studentName);
        if (!normalizedName) continue;
        existingClassStudentNameKeySet.add(`${classId}::${normalizedName}`);
      }
    }

    const result = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };

    const roleId = await getRoleIdByType(strapi, 'student');

    for (let i = 0; i < rows.length; i++) {
      const excelRowNumber = i + 2;
      try {
        const r = pickStudentRowJP(rows[i]);
        const studentName = (r.name ?? '').trim();
        if (!isRealPersonName(studentName))
          throw new Error('氏名(name)に記号が含まれているか、空欄です');
        if (!r.name_kana) throw new Error('フリガナ(name_kana)は必須です');

        const gender: Gender | undefined = (() => {
          const g = toGender(r.gender);
          return g ?? undefined;
        })();

        const guardianRel: GuardianRelationship | undefined = (() => {
          const rel = toGuardianRelationship(r.guardian_relationship);
          return rel ?? undefined;
        })();

        const guardianEmail = (r.guardian_email ?? '').trim();
        if (guardianEmail && hasNonAsciiChars(guardianEmail)) {
          throw new Error('全角文字は使用できません。半角で入力してください');
        }

        let classId: number | null | undefined = undefined;
        let classAcademicYearLabel = '';
        if (typeof fixedTargetClassId === 'number' && fixedTargetClassId > 0) {
          classId = fixedTargetClassId;
          classAcademicYearLabel = fixedTargetAcademicYearLabel;
        } else if (r.className) {
          const ayRaw = String(r.academic_year ?? '').trim();
          if (!ayRaw) throw new Error('クラス名を指定する場合は、対象年度の指定が必須です。');

          const targetAy = resolveAcademicYearFromRaw(ayRaw);
          classAcademicYearLabel =
            String(targetAy?.name ?? '').trim() ||
            (targetAy?.id ? ayNameById.get(targetAy.id) : '') ||
            String(targetAy?.documentId ?? '').trim() ||
            ayRaw;
          if (!targetAy?.id) throw new Error(`年度が見つかりません: ${ayRaw}`);

          const ids = classIdsByAyAndName.get(`${targetAy.id}::${r.className}`) ?? [];
          if (!ids.length) throw new Error(`${r.className} は選択した年度に存在しません: ${ayRaw}`);
          if (ids.length > 1)
            throw new Error(`${r.className} は選択した年度内でクラス名が重複しています: ${ayRaw}`);
          classId = ids[0];
        }

        if (typeof classId === 'number' && classId > 0) {
          const classStudentNameKey = `${classId}::${normalizeStudentNameForClassUnique(studentName)}`;
          if (existingClassStudentNameKeySet.has(classStudentNameKey)) {
            throw new Error(
              `生徒「${studentName}」はこのクラス（年度 ${classAcademicYearLabel || '-'}）に既に存在します。ご確認ください。`
            );
          }
        }

        const placeholder = makePlaceholderEmail('student');
        const createdUser = await createLocalUser(strapi, {
          roleId,
          email: placeholder,
          password: genTokenHex(),
          confirmed: true,
          blocked: false,
        });
        const userId = toIdNumber(createdUser?.id);
        if (!userId) throw new Error('users-permissions ユーザーの作成に失敗しました');

        await setUserSchoolAdmin(strapi, userId, tenantSa.id);

        const qrToken = await generateUniqueFieldToken(strapi, UID.student, 'qr_token');
        const generatedCode =
          typeof classId === 'number' && classId > 0
            ? await generateUniqueStudentCodeForClass({ strapi, classId })
            : genDigits(6);

        const data: StudentDocInput = {
          name: studentName,
          name_kana: r.name_kana,
          guardian_name: r.guardian_name || '-',
          guardian_phone: r.guardian_phone || '0000000000',
          emergency_phone: r.emergency_phone || '0000000000',
          qr_token: qrToken,
          code: generatedCode,
          users_permissions_user: userId,
          school_admin: tenantSa.id,

          ...(r.birthday ? { birthday: r.birthday } : {}),
          ...(gender ? { gender } : {}),
          ...(guardianRel ? { guardian_relationship: guardianRel } : {}),
          ...(guardianEmail ? { guardian_email: guardianEmail } : {}),
          ...(r.address ? { address: r.address } : {}),
          ...(r.enrollment_date ? { enrollment_date: r.enrollment_date } : {}),
          ...(r.notes ? { notes: r.notes } : {}),
          ...(classId !== undefined ? { class: classId } : {}),
        };

        await strapi.documents(UID.student).create({
          data,
          status: 'published',
        });

        if (typeof classId === 'number' && classId > 0) {
          const classStudentNameKey = `${classId}::${normalizeStudentNameForClassUnique(studentName)}`;
          existingClassStudentNameKeySet.add(classStudentNameKey);
        }

        result.created++;
      } catch (e) {
        result.failed++;
        result.errors.push({
          row: excelRowNumber,
          message: e instanceof Error ? e.message : '行データが不正です',
        });
      }
    }

    ctx.body = { data: result };
  },

  async delete(ctx) {
    const tenantSa = await requireTenantSchoolAdmin(strapi, ctx);

    const documentId = getDocumentIdParam(ctx);
    if (!documentId) return ctx.badRequest('student の documentId が指定されていません');
    const existing = await strapi.documents(UID.student).findOne({
      documentId,
      status: 'published',
      fields: ['id', 'documentId'],
      populate: {
        school_admin: { fields: ['documentId'] },
        users_permissions_user: { fields: ['id'] },
      },
    });

    if (!existing) return ctx.notFound('生徒が見つかりません');

    const ownerDocId = existing?.school_admin?.documentId;
    if (!ownerDocId || ownerDocId !== tenantSa.documentId)
      return ctx.forbidden('この操作を行う権限がありません');

    const studentEntryId = typeof existing.id === 'number' ? existing.id : null;
    const userId =
      typeof existing?.users_permissions_user?.id === 'number'
        ? existing.users_permissions_user.id
        : null;

    try {
      if (studentEntryId) {
        await strapi.db.query(UID.assignmentSubmission).deleteMany({
          where: { student: studentEntryId },
        });
      }

      await strapi.documents(UID.student).delete({ documentId });

      if (userId) {
        await strapi.db.query('plugin::users-permissions.user').deleteMany({
          where: { id: { $in: [userId] } },
        });
      }

      if (studentEntryId) {
        await deleteProjectsByOwnerWithAssets(strapi, {
          where: { student: studentEntryId },
          logPrefix: 'student.delete',
        });
      }

      ctx.body = { data: { deleted: true, deletedUsers: userId ? 1 : 0 } };
    } catch (e) {
      strapi.log.error('[student.delete] failed', e);
      return ctx.internalServerError('生徒の削除に失敗しました');
    }
  },
}));
