/* eslint-disable @typescript-eslint/no-explicit-any */
export type JoinTableInfo = {
  table: string;
  // cột trỏ về entity "source" (uid đang truyền vào)
  sourceCol: string;
  // cột trỏ về entity "target" (relation target)
  targetCol: string;
};

type JoinTableMeta = {
  name: string;
  joinColumn?: { name?: string };
  inverseJoinColumn?: { name?: string };
};

export const getRelationJoinTable = (
  strapi: unknown,
  uid: string,
  attributeName: string
): JoinTableInfo => {
  const s = strapi as any;

  const meta = s?.db?.metadata?.get?.(uid) as { attributes?: Record<string, unknown> } | undefined;
  if (!meta) throw new Error(`[joinTable] uid のメタデータが見つかりません: ${uid}`);

  const attr = meta.attributes?.[attributeName] as any;
  if (!attr || attr.type !== 'relation') {
    throw new Error(`[joinTable] ${uid}.${attributeName} はリレーション属性ではありません`);
  }

  const jt = attr.joinTable as JoinTableMeta | undefined;
  const table = jt?.name;
  const sourceCol = jt?.joinColumn?.name;
  const targetCol = jt?.inverseJoinColumn?.name;

  if (!table || !sourceCol || !targetCol) {
    throw new Error(`[joinTable] ${uid}.${attributeName} の joinTable を解決できません`);
  }

  return { table, sourceCol, targetCol };
};

export const countByIds = async (
  strapi: unknown,
  table: string,
  groupCol: string,
  ids: number[]
) => {
  const s = strapi as any;
  const knex = s.db.connection as any;

  const rows = (await knex(table)
    .whereIn(groupCol, ids)
    .select(groupCol)
    .count({ cnt: '*' })
    .groupBy(groupCol)) as Array<Record<string, any> & { cnt: string | number }>;

  const map = new Map<number, number>();
  for (const r of rows) map.set(Number(r[groupCol]), Number(r.cnt));
  return map;
};
