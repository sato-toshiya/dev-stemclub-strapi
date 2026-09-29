import { factories } from '@strapi/strapi';
import { getRoleIdByType } from '../../../utils/users-permissions/roles';
import { pickSchoolAdminRowJP } from '../services/import';
import {
  createLocalUser,
  removeUser,
  setUserSchoolAdmin,
} from '../../../utils/users-permissions/user';
import { UID } from '../../../constants/uids';
import { parseImportFile, readUploadToBuffer } from '../../../utils/import/file';
import { UserWithoutSecrets } from '../../../types';
import { hasNonAsciiChars } from '../../../utils/values/string';

type SchoolAdminWithUsers = {
  id: number;
  documentId: string;
  users_permissions_users?: Array<UserWithoutSecrets & { id: number; blocked?: boolean }>;
  [key: string]: unknown;
};

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

const getSystemAgencyAdmin = async (strapi) => {
  const rows = await strapi.db.query('api::agency-admin.agency-admin').findMany({
    select: ['id', 'documentId'],
    limit: 1,
    orderBy: { id: 'asc' },
  });

  return rows?.[0] ?? null;
};

const setBlockedForSchoolUsers = async (strapi, schoolAdminEntryId: number, blocked: boolean) => {
  const [teachers, students] = await Promise.all([
    strapi.db.query('api::teacher.teacher').findMany({
      where: { school_admin: schoolAdminEntryId },
      select: ['id'],
      populate: { users_permissions_user: { select: ['id'] } },
      limit: 100000,
    }),
    strapi.db.query('api::student.student').findMany({
      where: { school_admin: schoolAdminEntryId },
      select: ['id'],
      populate: { users_permissions_user: { select: ['id'] } },
      limit: 100000,
    }),
  ]);

  const teacherUserIds = (teachers ?? [])
    .map((t) => t?.users_permissions_user?.id)
    .filter((v) => typeof v === 'number');

  const studentUserIds = (students ?? [])
    .map((s) => s?.users_permissions_user?.id)
    .filter((v) => typeof v === 'number');

  const userIds = Array.from(new Set([...teacherUserIds, ...studentUserIds]));
  if (!userIds.length) return;

  await strapi.db.query('plugin::users-permissions.user').updateMany({
    where: { id: { $in: userIds } },
    data: { blocked },
  });
};

export default factories.createCoreController('api::school-admin.school-admin', ({ strapi }) => ({
  async create(ctx) {
    const body = (ctx.request.body ?? {}) as { data?: Record<string, unknown> };
    const payload = (body.data ?? {}) as Record<string, unknown>;

    const schoolAdminInput = {
      representor: payload.representor as string | undefined,
      postal_code: payload.postal_code as string | undefined,
      address: payload.address as string | undefined,
      name: payload.name as string | undefined,
      name_kana: payload.name_kana as string | undefined,
      establishment_date: payload.establishment_date as string | undefined,
      notes: payload.notes as string | undefined,
    };

    const userInput = {
      username: payload.email as string | undefined,
      email: payload.email as string | undefined,
      password: payload.admin_password as string | undefined,
      phone: payload.phone as string | undefined,
      confirmed: true,
      blocked: payload.blocked as boolean | undefined,
    };

    if (!schoolAdminInput.postal_code) {
      return ctx.badRequest('`schoolAdmin.postal_code` は必須です');
    }
    if (!schoolAdminInput.address) {
      return ctx.badRequest('`schoolAdmin.address` は必須です');
    }
    if (!userInput.username) return ctx.badRequest('`user.username` は必須です');
    if (!userInput.email) return ctx.badRequest('`user.email` は必須です');
    if (!userInput.password) return ctx.badRequest('`user.password` は必須です');

    // Determine role
    const roleId = await strapi.entityService.findMany('plugin::users-permissions.role', {
      filters: { type: 'school_admin' },
      fields: ['id', 'name', 'type'],
    });

    if (!roleId)
      return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');

    // After the validations above, we can safely treat required fields as present
    const schoolAdminData = {
      ...schoolAdminInput,
      postal_code: schoolAdminInput.postal_code,
      address: schoolAdminInput.address,
    };

    type CreatedUser = {
      id: number;
      email?: string;
      username?: string;
      phone?: string;
      role?: unknown;
      confirmed?: boolean;
      blocked?: boolean;
      provider?: string;
      password?: string;
      resetPasswordToken?: string;
      confirmationToken?: string;
    };

    let createdUser: CreatedUser | null = null;

    try {
      // Use the users-permissions service which handles password hashing automatically
      const userData = {
        username: userInput.username,
        email: userInput.email,
        password: userInput.password, // Will be hashed by the service
        phone: userInput.phone,
        role: roleId[0].id,
        confirmed: userInput.confirmed ?? true,
        blocked: userInput.blocked ?? false,
        provider: 'local', // Required for local authentication
      };

      strapi.log.info('Creating user with data:', {
        username: userData.username,
        email: userData.email,
        hasPassword: !!userData.password,
        role: userData.role,
        confirmed: userData.confirmed,
        blocked: userData.blocked,
        provider: userData.provider,
      });

      // Use the plugin service which properly hashes passwords
      createdUser = await strapi.plugin('users-permissions').service('user').add(userData);

      strapi.log.info('User created successfully:', {
        userId: createdUser.id,
        email: createdUser.email,
        username: createdUser.username,
        confirmed: createdUser.confirmed,
        blocked: createdUser.blocked,
        hasRole: !!createdUser.role,
      });

      const createdSchoolAdmin = await strapi.documents('api::school-admin.school-admin').create({
        data: {
          ...schoolAdminData,
          // Typed inputs expect a relation input object (XManyInput). Use set for 1..n relations.
          users_permissions_users: { set: [createdUser.id] },
        },
        populate: {
          users_permissions_users: true,
        },
        // TODO: tighten typing once Strapi's generated Input types expose XManyInput helpers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await strapi.plugin('users-permissions').service('user').edit(createdUser.id, {
        school_admin: createdSchoolAdmin.id,
      });

      // Fetch the published document
      const publishedSchoolAdmin = await strapi
        .documents('api::school-admin.school-admin')
        .findOne({
          documentId: createdSchoolAdmin.documentId,
          populate: {
            users_permissions_users: true,
          },
        });

      // Ensure we never leak secrets
      const {
        password: _password,
        resetPasswordToken: _resetPasswordToken,
        confirmationToken: _confirmationToken,
        ...safeUser
      } = createdUser ?? {};

      ctx.body = {
        data: {
          schoolAdmin: publishedSchoolAdmin,
          user: safeUser,
        },
      };
    } catch (err: unknown) {
      // Best-effort rollback if user was created but school-admin failed
      try {
        if (createdUser?.id) {
          await strapi.plugin('users-permissions').service('user').remove(createdUser.id);
        }
      } catch {
        // ignore rollback errors
      }

      if (isDuplicateUserCredentialError(err)) {
        return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
      }

      strapi.log.error('createSchoolAdmin failed', err);
      return ctx.internalServerError('学校管理者の作成に失敗しました');
    }
  },

  async update(ctx) {
    const { id } = ctx.params as { id?: string };

    if (!id) {
      return ctx.badRequest('school-admin の documentId が指定されていません');
    }

    const body = (ctx.request.body ?? {}) as { data?: Record<string, unknown> };
    const payload = (body.data ?? {}) as Record<string, unknown>;

    const schoolAdminInput = {
      representor: payload.representor as string | undefined,
      postal_code: payload.postal_code as string | undefined,
      address: payload.address as string | undefined,
      name: payload.name as string | undefined,
      name_kana: payload.name_kana as string | undefined,
      establishment_date: payload.establishment_date as string | undefined,
      notes: payload.notes as string | undefined,
    };

    const userInput = {
      username: payload.email as string | undefined,
      email: payload.email as string | undefined,
      password: payload.admin_password as string | undefined,
      phone: payload.phone as string | undefined,
      blocked: payload.blocked as boolean | undefined,
    };

    if (!schoolAdminInput.postal_code) {
      return ctx.badRequest('`schoolAdmin.postal_code` は必須です');
    }
    if (!schoolAdminInput.address) {
      return ctx.badRequest('`schoolAdmin.address` は必須です');
    }
    if (!userInput.username) return ctx.badRequest('`user.username` は必須です');
    if (!userInput.email) return ctx.badRequest('`user.email` は必須です');

    try {
      // Load current school-admin with its primary user
      const existing = (await strapi.documents('api::school-admin.school-admin').findOne({
        documentId: id,
        populate: { users_permissions_users: true },
      })) as SchoolAdminWithUsers | null;

      if (!existing) {
        return ctx.notFound('学校管理者が見つかりません');
      }

      const linkedUser = existing.users_permissions_users?.[0];
      const prevBlocked = !!linkedUser?.blocked;
      // Determine role (keep same school_admin role as create)
      const roleResult = await strapi.entityService.findMany('plugin::users-permissions.role', {
        filters: { type: 'school_admin' },
        fields: ['id', 'name', 'type'],
      });

      const roleId = roleResult?.[0]?.id;

      if (!roleId) {
        return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');
      }

      // Update linked user if present
      if (linkedUser?.id) {
        const userData: Record<string, unknown> = {
          username: userInput.username,
          email: userInput.email,
          phone: userInput.phone,
          blocked: userInput.blocked ?? false,
          role: roleId,
        };

        // Only change password if sent
        if (userInput.password) {
          userData.password = userInput.password;
        }

        await strapi
          .plugin('users-permissions')
          .service('user')
          .edit(linkedUser.id, {
            username: userInput.username,
            email: userInput.email,
            phone: userInput.phone,
            blocked: userInput.blocked ?? false,
            role: roleId,
            school_admin: existing.id,
            ...(userInput.password ? { password: userInput.password } : {}),
          });
      }
      const nextBlocked = typeof userInput.blocked === 'boolean' ? userInput.blocked : prevBlocked;

      if (typeof userInput.blocked === 'boolean' && nextBlocked !== prevBlocked) {
        await setBlockedForSchoolUsers(strapi, existing.id, nextBlocked);
      }
      // Update school-admin document
      const schoolAdminData = {
        ...schoolAdminInput,
        postal_code: schoolAdminInput.postal_code,
        address: schoolAdminInput.address,
      };

      await strapi.documents('api::school-admin.school-admin').update({
        documentId: id,
        data: schoolAdminData,
      });

      // Reload with fresh data & relations
      const updated = (await strapi.documents('api::school-admin.school-admin').findOne({
        documentId: id,
        populate: { users_permissions_users: true },
      })) as SchoolAdminWithUsers | null;

      const rawUser = updated?.users_permissions_users?.[0] ?? null;

      let safeUser: UserWithoutSecrets | null = rawUser ?? null;

      if (rawUser) {
        const {
          password: _password,
          resetPasswordToken: _resetPasswordToken,
          confirmationToken: _confirmationToken,
          ...rest
        } = rawUser as UserWithoutSecrets & {
          password?: string;
          resetPasswordToken?: string;
          confirmationToken?: string;
        };

        safeUser = rest;
      }

      ctx.body = {
        data: {
          schoolAdmin: updated,
          user: safeUser,
        },
      };
    } catch (err) {
      if (isDuplicateUserCredentialError(err)) {
        return ctx.badRequest(DUPLICATE_EMAIL_MESSAGE);
      }

      strapi.log.error('school-admin.update failed', err);
      return ctx.internalServerError('学校管理者の更新に失敗しました');
    }
  },

  async findOne(ctx) {
    // Set populate to include user relation
    ctx.query = {
      ...ctx.query,
      populate: {
        ...(ctx.query.populate as Record<string, unknown>),
        users_permissions_users: true,
      },
    };

    // Call the default findOne method
    const response = await super.findOne(ctx);

    // If response has data, sanitize user secrets and return custom format
    if (response?.data) {
      const schoolAdmin = response.data as SchoolAdminWithUsers;
      const rawUser = schoolAdmin.users_permissions_users?.[0] ?? null;

      let safeUser: UserWithoutSecrets | null = rawUser ?? null;

      if (rawUser) {
        const {
          password: _password,
          resetPasswordToken: _resetPasswordToken,
          confirmationToken: _confirmationToken,
          ...rest
        } = rawUser as UserWithoutSecrets & {
          password?: string;
          resetPasswordToken?: string;
          confirmationToken?: string;
        };

        safeUser = rest;
      }

      // Return schoolAdmin and user separately
      return {
        data: {
          schoolAdmin: response.data,
          user: safeUser,
        },
      };
    }

    // Return original response if no data (e.g., error responses)
    return response;
  },
  async find(ctx) {
    ctx.query = {
      ...ctx.query,
      populate: {
        users_permissions_users: { fields: ['email', 'phone', 'blocked'] },
      },
    };
    return super.find(ctx);
  },

  async importSchoolAdmins(ctx) {
    const file = ctx.request?.files?.file;
    if (!file) return ctx.badRequest('`file` が指定されていません');

    const { buf, filename } = await readUploadToBuffer(file);
    const rows = parseImportFile(buf, filename);

    if (!rows.length) {
      ctx.body = { data: { created: 0, failed: 0, errors: [] } };
      return;
    }

    const systemAgency = await getSystemAgencyAdmin(strapi);
    if (!systemAgency?.id) {
      return ctx.internalServerError('システムの agency_admin が設定されていません');
    }

    let roleId: number;
    try {
      roleId = await getRoleIdByType(strapi, 'school_admin');
    } catch {
      return ctx.badRequest('users-permissions のデフォルトロールを特定できませんでした');
    }

    const result = {
      created: 0,
      failed: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };

    for (let i = 0; i < rows.length; i++) {
      const excelRowNumber = i + 2;

      let createdUserId: number | null = null;
      let createdSchoolAdminDocId: string | null = null;
      let createdSchoolAdminEntryId: number | null = null;

      try {
        const r = pickSchoolAdminRowJP(rows[i]);

        const name = (r.name ?? '').trim();
        if (!name) throw new Error('法人名(name)は必須です');

        const representor = (r.representor ?? '').trim();
        if (!representor) throw new Error('代表者名(representor)は必須です');

        const postal_code_raw = (r.postal_code ?? '').trim();
        const postalDigits = postal_code_raw.replace(/[^\d]/g, '');
        if (!postalDigits) throw new Error('郵便番号(postal_code)は必須です');
        if (postalDigits.length !== 7)
          throw new Error('郵便番号(postal_code)は7桁で入力してください');

        const address = (r.address ?? '').trim();
        if (!address) throw new Error('所在地(address)は必須です');

        const userEmail = (r.email ?? '').trim();
        if (!userEmail) throw new Error('メールアドレス(email)は必須です');
        if (hasNonAsciiChars(userEmail)) {
          throw new Error('全角文字は使用できません。半角で入力してください');
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
          throw new Error('メールアドレス(email)の形式が不正です');
        }

        const existed = await strapi.query('plugin::users-permissions.user').findOne({
          where: { email: userEmail.toLowerCase() },
          select: ['id', 'email'],
        });

        if (existed?.id) {
          throw new Error('メールアドレス(email)は既に登録されています');
        }

        const phone_raw = (r.phone ?? '').trim();
        const phoneDigits = phone_raw.replace(/[^\d]/g, '');
        if (!phoneDigits) throw new Error('電話番号(phone)は必須です');
        if (phoneDigits.length < 10) throw new Error('電話番号(phone)が短すぎます');

        const defaultPassword = phoneDigits.slice(-6);
        const password = (r.admin_password ?? '').trim() || defaultPassword;

        const blocked = typeof r.blocked === 'boolean' ? r.blocked : false;

        const createdUser = await createLocalUser(strapi, {
          roleId,
          email: userEmail,
          password,
          blocked,
          confirmed: true,
          phone: phoneDigits || null,
        });

        createdUserId =
          typeof createdUser?.id === 'number' ? createdUser.id : Number(createdUser?.id);
        if (!createdUserId) throw new Error('作成されたユーザー情報が不正です');

        const createdSchoolAdmin = await strapi.documents(UID.schoolAdmin).create({
          data: {
            name,
            name_kana: (r.name_kana ?? '').trim() || null,
            representor,
            postal_code: postalDigits,
            address,
            establishment_date: (r.establishment_date ?? '').trim() || null,
            notes: (r.notes ?? '').trim() || null,
            users_permissions_users: { set: [createdUserId] },
          },
          status: 'published',
        });

        createdSchoolAdminDocId = createdSchoolAdmin.documentId;

        const published = await strapi.documents(UID.schoolAdmin).findOne({
          documentId: createdSchoolAdminDocId,
          status: 'published',
          fields: ['id', 'documentId'],
        });

        createdSchoolAdminEntryId = typeof published?.id === 'number' ? published.id : null;
        if (!createdSchoolAdminEntryId)
          throw new Error('学校管理者データの公開レコードが見つかりません');

        await setUserSchoolAdmin(strapi, createdUserId, createdSchoolAdminEntryId);

        await strapi.documents(UID.agencyAdmin).update({
          documentId: systemAgency.documentId,
          data: {
            school_admins: { connect: [createdSchoolAdminEntryId] },
          },
          status: 'published',
        });

        result.created++;
      } catch (e) {
        result.failed++;
        result.errors.push({
          row: excelRowNumber,
          message: e instanceof Error ? e.message : '行データが不正です',
        });

        try {
          if (createdSchoolAdminDocId) {
            await strapi.documents(UID.schoolAdmin).delete({ documentId: createdSchoolAdminDocId });
          }
          if (createdUserId) {
            await removeUser(strapi, createdUserId);
          }
        } catch {
          // ignore
        }
      }
    }

    ctx.body = { data: result };
  },

  async delete(ctx) {
    const { id } = ctx.params as { id?: string };
    if (!id) return ctx.badRequest('school-admin の documentId が指定されていません');

    const existing = await strapi.documents(UID.schoolAdmin).findOne({
      documentId: id,
      populate: { users_permissions_users: { fields: ['id'] } },
    });
    if (!existing) return ctx.notFound('学校管理者が見つかりません');

    const userIds = (existing.users_permissions_users ?? [])
      .map((u) => u?.id)
      .filter((v): v is number => typeof v === 'number');

    if (userIds.length) {
      await strapi.db.query('plugin::users-permissions.user').deleteMany({
        where: { id: { $in: userIds } },
      });
    }

    await strapi.documents(UID.schoolAdmin).delete({ documentId: id });

    ctx.body = { data: { deleted: true, deletedUsers: userIds.length } };
  },
}));
