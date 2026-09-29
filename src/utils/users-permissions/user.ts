type UsersPermissionsUser = {
  id: number;
  email?: string;
  username?: string;
  phone?: string | null;
  blocked?: boolean;
  confirmed?: boolean;
  [k: string]: unknown;
};

type StrapiLike = {
  query: (uid: string) => {
    findOne: (params: Record<string, unknown>) => Promise<UsersPermissionsUser | null>;
  };
  plugin: (name: string) => {
    service: (name: string) => {
      add: (data: Record<string, unknown>) => Promise<UsersPermissionsUser>;
      edit: (id: number, data: Record<string, unknown>) => Promise<UsersPermissionsUser>;
      remove: (id: number) => Promise<void>;
    };
  };
};

export const makePlaceholderEmail = (prefix: string): string => {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now()}_${rand}@local.invalid`;
};

export const makePlaceholderUsername = (prefix: string): string => {
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now()}_${rand}`;
};

export const ensureNoExistingUserEmail = async (
  strapi: StrapiLike,
  email: string
): Promise<void> => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  const existed = await strapi.query('plugin::users-permissions.user').findOne({
    where: { email: normalized },
    select: ['id', 'email'],
  });

  if (existed?.id) {
    throw new Error('メールアドレスは既に登録されています');
  }
};

export const createLocalUser = async (
  strapi: StrapiLike,
  input: {
    roleId: number;
    email?: string | null;
    username?: string | null;
    usePlaceholderEmail?: boolean;
    blocked?: boolean;
    confirmed?: boolean;
    phone?: string | null;
    password: string;
  }
): Promise<UsersPermissionsUser> => {
  const email = (input.email ?? '').trim();
  const username = (input.username ?? '').trim();
  const usePlaceholderEmail = input.usePlaceholderEmail ?? true;
  const finalEmail = email || (usePlaceholderEmail ? makePlaceholderEmail('user') : '');
  const finalUsername = username || finalEmail || makePlaceholderUsername('user');

  const data: Record<string, unknown> = {
    username: finalUsername,
    password: input.password,
    role: input.roleId,
    confirmed: input.confirmed ?? true,
    blocked: input.blocked ?? false,
    provider: 'local',
    ...(typeof input.phone !== 'undefined' ? { phone: input.phone } : {}),
  };
  if (finalEmail) data.email = finalEmail;

  return strapi.plugin('users-permissions').service('user').add(data);
};

export const updateUserCredentials = async (
  strapi: StrapiLike,
  userId: number,
  input: {
    email?: string | null;
    phone?: string | null;
    blocked?: boolean;
    password?: string | null;
    roleId?: number;
  }
): Promise<void> => {
  const data: Record<string, unknown> = {};

  if (typeof input.blocked === 'boolean') data.blocked = input.blocked;
  if (typeof input.phone !== 'undefined') data.phone = input.phone;

  if (typeof input.email === 'string' && input.email.trim()) {
    const e = input.email.trim();
    data.email = e;
    data.username = e;
  }

  if (typeof input.password === 'string' && input.password) {
    data.password = input.password;
  }

  if (typeof input.roleId === 'number') data.role = input.roleId;

  if (Object.keys(data).length === 0) return;
  await strapi.plugin('users-permissions').service('user').edit(userId, data);
};

export const setUserSchoolAdmin = async (
  strapi: StrapiLike,
  userId: number,
  schoolAdminId: number
): Promise<void> => {
  await strapi.plugin('users-permissions').service('user').edit(userId, {
    school_admin: schoolAdminId,
  });
};

export const removeUser = async (strapi: StrapiLike, userId: number): Promise<void> => {
  await strapi.plugin('users-permissions').service('user').remove(userId);
};
