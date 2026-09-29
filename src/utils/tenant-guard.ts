import { getTenantSchoolAdmin } from './tenant';

export type TenantSa = { id: number; documentId: string };

export const requireTenantSchoolAdmin = async (strapi, ctx): Promise<TenantSa> => {
  const tenantSa = await getTenantSchoolAdmin(strapi, ctx);
  if (!tenantSa) {
    ctx.forbidden('この操作を行う権限がありません');
    throw new Error('テナント権限エラー');
  }
  return tenantSa;
};
