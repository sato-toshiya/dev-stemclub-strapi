import { hasOwn } from '../../../utils/http/payload';
import { pickString } from '../../../utils/values/pick';
import { GuardianRelationship, toGender, toGuardianRelationship } from '../../../constants/enums';
import type { Modules } from '@strapi/types';
import { toIdNumber } from '../../../utils/values/id';
import { getRoleIdByType } from '../../../utils/users-permissions/roles';
import {
  createLocalUser,
  makePlaceholderEmail,
  setUserSchoolAdmin,
} from '../../../utils/users-permissions/user';
import { generateUniqueFieldToken, genTokenHex } from '../../../utils/tokens';
import { UID } from '../../../constants/uids';
import { resolveClassIdForTenantOrNull } from './relations';
import { ensureStudentCodeUniqueInClass, generateUniqueStudentCodeForClass } from './code';
import {
  readNullableDigits,
  readNullableString,
  readNullableYmd,
} from '../../../utils/values/patch';

export type StudentDocInput = Modules.Documents.Params.Data.Input<'api::student.student'>;

export const buildStudentUpsertData = async ({
  strapi,
  payload,
  tenantSa,
  mode,
  base,
}: {
  strapi;
  payload: Record<string, unknown>;
  tenantSa: { id: number; documentId: string };
  mode: 'create' | 'update';
  base?;
}): Promise<{
  studentData: StudentDocInput;
  userId: number;
  createdUser?: boolean;
}> => {
  const name = pickString(payload, 'name') || String(base?.name ?? '').trim();
  const name_kana = pickString(payload, 'name_kana') || String(base?.name_kana ?? '').trim();
  const guardian_name =
    pickString(payload, 'guardian_name') || String(base?.guardian_name ?? '').trim();

  const gender = toGender(payload.gender ?? base?.gender);

  if (!name) throw new Error('`name` は必須です');
  if (!name_kana) throw new Error('`name_kana` は必須です');
  if (!gender) throw new Error('`gender` は male / female / other のいずれかで指定してください');
  if (!guardian_name) throw new Error('`guardian_name` は必須です');

  let classId: number | null | undefined = undefined;
  if (mode === 'create') {
    const classDocId = pickString(payload, 'class');
    if (!classDocId) throw new Error('`class` は必須です');

    classId = await resolveClassIdForTenantOrNull(strapi, classDocId, tenantSa.documentId);
    if (!classId) throw new Error('`class` (documentId) が不正です');
  } else {
    if (hasOwn(payload, 'class')) {
      const raw = payload.class;
      if (raw === null) {
        classId = null;
      } else {
        const classDocId = pickString(payload, 'class');
        if (!classDocId) classId = null;
        else {
          classId = await resolveClassIdForTenantOrNull(strapi, classDocId, tenantSa.documentId);
          if (!classId) throw new Error('`class` (documentId) が不正です');
        }
      }
    }
  }

  const birthday = readNullableYmd(payload, 'birthday');
  const enrollment_date = readNullableYmd(payload, 'enrollment_date');

  const guardian_phone = readNullableDigits(payload, 'guardian_phone', { minLen: 10, maxLen: 11 });
  const emergency_phone = readNullableDigits(payload, 'emergency_phone', {
    minLen: 10,
    maxLen: 11,
  });

  const grade = readNullableString(payload, 'grade');
  const guardian_email = readNullableString(payload, 'guardian_email');
  const address = readNullableString(payload, 'address');
  const notes = readNullableString(payload, 'notes');

  let guardian_relationship: GuardianRelationship | null | undefined = undefined;
  if (hasOwn(payload, 'guardian_relationship')) {
    const raw = payload.guardian_relationship;
    if (raw === null) guardian_relationship = null;
    else {
      const rel = toGuardianRelationship(raw);
      if (!rel) throw new Error('`guardian_relationship` が不正です');
      guardian_relationship = rel;
    }
  }

  let code: string | null | undefined = undefined;
  if (mode === 'create') {
    code = await generateUniqueStudentCodeForClass({ strapi, classId: classId! });
  } else if (hasOwn(payload, 'code')) {
    const r = readNullableDigits(payload, 'code', { exactLen: 6 });
    code = r.has ? (r.value ?? null) : undefined;
  }

  if (mode === 'update' && (hasOwn(payload, 'code') || classId !== undefined)) {
    const baseStudentId = toIdNumber(base?.id);
    const baseClassId = toIdNumber(base?.class?.id);

    const nextClassId = classId !== undefined ? classId : baseClassId;
    const nextCode =
      typeof code === 'string'
        ? code.trim()
        : typeof base?.code === 'string'
          ? base.code.trim()
          : '';

    if (nextCode) {
      await ensureStudentCodeUniqueInClass({
        strapi,
        classId: nextClassId,
        code: nextCode,
        excludeStudentId: baseStudentId,
      });
    }
  }

  const qr_token =
    mode === 'create'
      ? await generateUniqueFieldToken(strapi, UID.student, 'qr_token')
      : String(base?.qr_token ?? '').trim();

  let userId: number | null =
    mode === 'create'
      ? (toIdNumber(payload.users_permissions_user) ?? null)
      : (toIdNumber(base?.users_permissions_user?.id) ?? null);

  let createdUser = false;

  if (mode === 'update' && !userId) throw new Error('生徒に紐づくユーザーが存在しません');

  if (mode === 'create' && !userId) {
    const roleId = await getRoleIdByType(strapi, 'student');
    const placeholder = makePlaceholderEmail('student');
    const created = await createLocalUser(strapi, {
      roleId,
      email: placeholder,
      password: genTokenHex(),
      confirmed: true,
      blocked: false,
    });
    userId = toIdNumber(created?.id);
    if (!userId) throw new Error('users-permissions ユーザーの作成に失敗しました');
    createdUser = true;
  }

  await setUserSchoolAdmin(strapi, userId!, tenantSa.id);

  const studentData: Partial<StudentDocInput> = {
    name,
    name_kana,
    gender,
    guardian_name,
    school_admin: tenantSa.id,
    users_permissions_user: userId!,
    qr_token,
    ...(code !== undefined ? { code } : {}),
  };

  if (mode === 'create') {
    studentData.class = classId!;
  } else if (classId !== undefined) {
    studentData.class = classId;
  }

  if (birthday.has) studentData.birthday = birthday.value;
  if (enrollment_date.has) studentData.enrollment_date = enrollment_date.value;

  if (guardian_phone.has) studentData.guardian_phone = guardian_phone.value;
  if (emergency_phone.has) studentData.emergency_phone = emergency_phone.value;

  if (grade.has) studentData.grade = grade.value;
  if (guardian_email.has) studentData.guardian_email = guardian_email.value;
  if (address.has) studentData.address = address.value;
  if (notes.has) studentData.notes = notes.value;

  if (guardian_relationship !== undefined)
    studentData.guardian_relationship = guardian_relationship;

  return { studentData: studentData as StudentDocInput, userId: userId!, createdUser };
};
