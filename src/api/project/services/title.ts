import { UID } from '../../../constants/uids';

const normalizeTitle = (v: unknown) => String(v ?? '').trim();

export const ensureUniqueTitleForOwner = async (
  strapi,
  args: {
    ownerType: 'teacher' | 'student';
    ownerId: number;
    title: string;
    excludeProjectId?: number;
  }
) => {
  const title = normalizeTitle(args.title);
  if (!title) throw new Error('`title` は必須です');

  const where: Record<string, unknown> = {
    owner_type: args.ownerType,
    title,
    ...(args.ownerType === 'teacher' ? { teacher: args.ownerId } : { student: args.ownerId }),
  };

  if (typeof args.excludeProjectId === 'number') {
    where.id = { $ne: args.excludeProjectId };
  }

  const exists = await strapi.db.query(UID.project).findOne({
    where,
    select: ['id', 'documentId', 'title'],
  });

  if (exists?.id) {
    const err = new Error('DUPLICATE_TITLE');
    (err as any).details = { existingDocumentId: exists.documentId };
    throw err;
  }
};

export const titleExistsForOwner = async (
  strapi,
  args: {
    ownerType: 'teacher' | 'student';
    ownerId: number;
    title: string;
    excludeProjectId?: number;
  }
) => {
  const where: Record<string, unknown> = {
    owner_type: args.ownerType,
    title: normalizeTitle(args.title),
    ...(args.ownerType === 'teacher' ? { teacher: args.ownerId } : { student: args.ownerId }),
  };

  if (typeof args.excludeProjectId === 'number') {
    where.id = { $ne: args.excludeProjectId };
  }

  const exists = await strapi.db.query(UID.project).findOne({
    where,
    select: ['id'],
  });

  return !!exists?.id;
};

export const splitBaseAndSuffix = (title: string) => {
  const t = normalizeTitle(title);
  const m = t.match(/^(.*?)(?:_(\d+))$/);
  if (m && m[1]) {
    return { base: m[1].trim(), suffix: Number(m[2]) || 0 };
  }
  return { base: t, suffix: 0 };
};

export const ensureAutoUniqueTitleForOwner = async (
  strapi,
  args: {
    ownerType: 'teacher' | 'student';
    ownerId: number;
    title: string;
    excludeProjectId?: number;
  }
) => {
  const raw = normalizeTitle(args.title);
  if (!raw) throw new Error('`title` は必須です');

  const { base, suffix } = splitBaseAndSuffix(raw);
  if (!base) throw new Error('`title` は必須です');

  if (suffix > 0) {
    const candidate = `${base}_${suffix}`;
    const taken = await titleExistsForOwner(strapi, {
      ...args,
      title: candidate,
    });
    if (!taken) return candidate;

    for (let i = suffix + 1; i <= suffix + 500; i++) {
      const next = `${base}_${i}`;
      const exists = await titleExistsForOwner(strapi, { ...args, title: next });
      if (!exists) return next;
    }
    throw new Error('一意なタイトルを生成できませんでした');
  }

  {
    const taken = await titleExistsForOwner(strapi, { ...args, title: base });
    if (!taken) return base;

    for (let i = 1; i <= 500; i++) {
      const next = `${base}_${i}`;
      const exists = await titleExistsForOwner(strapi, { ...args, title: next });
      if (!exists) return next;
    }
    throw new Error('一意なタイトルを生成できませんでした');
  }
};
