import { UID } from '../../../constants/uids';
const SELECTABLE_ACADEMIC_YEAR_STATUSES = new Set(['active', 'pending']);

export const resolveClassIdForTenantOrNull = async (
  strapi,
  classDocId: string,
  tenantSchoolAdminDocId: string
): Promise<number | null> => {
  const docId = String(classDocId ?? '').trim();
  if (!docId) return null;

  const cls = await strapi.db.query(UID.class).findOne({
    where: { documentId: docId },
    select: ['id'],
    populate: {
      academic_year: {
        select: ['id', 'academic_status'],
        populate: { school_admin: { select: ['documentId'] } },
      },
    },
  });

  const id = cls?.id;
  const ownerDocId = cls?.academic_year?.school_admin?.documentId;
  const academicStatus = String(cls?.academic_year?.academic_status ?? '');

  if (typeof id !== 'number') return null;
  if (!ownerDocId || ownerDocId !== tenantSchoolAdminDocId) return null;
  if (!SELECTABLE_ACADEMIC_YEAR_STATUSES.has(academicStatus)) return null;

  return id;
};
