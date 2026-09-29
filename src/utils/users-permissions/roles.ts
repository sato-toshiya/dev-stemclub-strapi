type StrapiLike = {
  entityService: {
    findMany: (
      uid: string,
      params: Record<string, unknown>
    ) => Promise<Array<{ id?: number; type?: string }> | unknown>;
  };
};

const cache = new Map<string, number>();

export const getRoleIdByType = async (strapi: StrapiLike, type: string): Promise<number> => {
  const cached = cache.get(type);
  if (cached) return cached;

  const res = await strapi.entityService.findMany('plugin::users-permissions.role', {
    filters: { type },
    fields: ['id', 'type'],
    pagination: { page: 1, pageSize: 1 },
  });

  const arr = Array.isArray(res) ? res : [];
  const roleId = arr?.[0]?.id;

  if (typeof roleId !== 'number') {
    throw new Error(`type="${type}" に対応する users-permissions ロールを特定できませんでした`);
  }

  cache.set(type, roleId);
  return roleId;
};
