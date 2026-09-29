import { UID } from '../constants/uids';

export type TenantSchoolAdmin = { id: number; documentId: string };

export const getTenantSchoolAdmin = async (strapi, ctx): Promise<TenantSchoolAdmin | null> => {
  const authUser = ctx.state.user;
  if (!authUser?.id) return null;

  const fullUser = await strapi.entityService.findOne(
    'plugin::users-permissions.user',
    authUser.id,
    { populate: { role: true, school_admin: true } }
  );

  if (fullUser?.role?.type !== 'school_admin') return null;

  const sa = fullUser?.school_admin;
  if (!sa?.documentId || !sa?.id) return null;

  return { id: sa.id, documentId: sa.documentId };
};

export const getTenantByTeacher = async (strapi, ctx): Promise<TenantSchoolAdmin | null> => {
  const authUser = ctx.state.user;
  console.log('authUser: ', authUser);
  if (!authUser?.id) return null;

  const teacher = await strapi.db.query(UID.teacher).findOne({
    where: { users_permissions_user: authUser.id },
    select: ['id'],
    populate: { school_admin: { select: ['id', 'documentId'] } },
  });

  const sa = teacher?.school_admin;
  if (!sa?.id || !sa?.documentId) return null;

  return { id: sa.id, documentId: sa.documentId };
};
