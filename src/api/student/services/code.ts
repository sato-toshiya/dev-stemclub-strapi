import { UID } from '../../../constants/uids';
import { genDigits } from '../../../utils/tokens';

const isClassId = (value: unknown): value is number => typeof value === 'number' && value > 0;

export const isStudentCodeTakenInClass = async ({
  strapi,
  classId,
  code,
  excludeStudentId,
}: {
  strapi;
  classId: number | null | undefined;
  code: string;
  excludeStudentId?: number | null;
}) => {
  if (!isClassId(classId)) return false;

  const normalizedCode = String(code ?? '').trim();
  if (!normalizedCode) return false;

  const where: Record<string, unknown> = {
    class: classId,
    code: normalizedCode,
  };

  if (typeof excludeStudentId === 'number' && excludeStudentId > 0) {
    where.id = { $ne: excludeStudentId };
  }

  const existing = await strapi.db.query(UID.student).findOne({
    where,
    select: ['id'],
  });

  return !!existing?.id;
};

export const ensureStudentCodeUniqueInClass = async ({
  strapi,
  classId,
  code,
  excludeStudentId,
}: {
  strapi;
  classId: number | null | undefined;
  code: string;
  excludeStudentId?: number | null;
}) => {
  const exists = await isStudentCodeTakenInClass({
    strapi,
    classId,
    code,
    excludeStudentId,
  });

  if (exists) {
    throw new Error('同じクラス内で同じパスコードは使用できません');
  }
};

export const generateUniqueStudentCodeForClass = async ({
  strapi,
  classId,
  maxTry = 100,
}: {
  strapi;
  classId: number;
  maxTry?: number;
}) => {
  if (!isClassId(classId)) throw new Error('`class` が不正です');

  for (let i = 0; i < maxTry; i++) {
    const candidate = genDigits(6);
    const exists = await isStudentCodeTakenInClass({
      strapi,
      classId,
      code: candidate,
    });

    if (!exists) return candidate;
  }

  throw new Error('クラス内で一意なパスコードを生成できませんでした');
};
