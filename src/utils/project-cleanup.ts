import { UID } from '../constants/uids';
import { collectFileUrls, deleteS3ObjectsByUrls } from './s3-delete';
import { getRelationJoinTable } from './strapi/relations';

type ProjectOwnerWhere = Record<string, unknown>;
type CleanupResult = { deletedProjects: number; deletedUploads: number };

const toPositiveId = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
};

const uniquePositiveIds = (values: unknown[]): number[] => {
  const ids = values.map(toPositiveId).filter((id): id is number => typeof id === 'number');
  return Array.from(new Set(ids));
};

export const deleteProjectsByIdsWithAssets = async (
  strapi,
  opts: {
    projectIds: number[];
    logPrefix: string;
  }
): Promise<CleanupResult> => {
  const { logPrefix } = opts;
  const projectIds = uniquePositiveIds(opts.projectIds);
  if (!projectIds.length) return { deletedProjects: 0, deletedUploads: 0 };

  const projectRows = await strapi.db.query(UID.project).findMany({
    where: { id: { $in: projectIds } },
    select: ['id', 'documentId'],
    populate: {
      sjr_file: { select: ['id'] },
      thumbnail: { select: ['id'] },
    },
  });

  const rows = Array.isArray(projectRows) ? projectRows : [];
  if (!rows.length) return { deletedProjects: 0, deletedUploads: 0 };

  const mediaIds = uniquePositiveIds(
    rows.flatMap((row) => [row?.sjr_file?.id, row?.thumbnail?.id])
  );

  const rowIds = uniquePositiveIds(rows.map((row) => row?.id));
  if (!rowIds.length) return { deletedProjects: 0, deletedUploads: 0 };

  await strapi.db.query(UID.project).deleteMany({ where: { id: { $in: rowIds } } });

  if (!mediaIds.length) {
    return { deletedProjects: rowIds.length, deletedUploads: 0 };
  }

  const uploadFiles = await strapi.db.query('plugin::upload.file').findMany({
    where: { id: { $in: mediaIds } },
  });

  const urls = (Array.isArray(uploadFiles) ? uploadFiles : [])
    .flatMap((f) => collectFileUrls(f))
    .filter((u): u is string => typeof u === 'string' && !!u.trim());

  const bucket = process.env.AWS_S3_BUCKET || 'pionero-ste-strapi-dev';

  try {
    await deleteS3ObjectsByUrls({
      bucket,
      urls,
      log: (msg, extra) => {
        if (extra) strapi.log.warn(msg, extra);
        else strapi.log.info(msg);
      },
    });
  } catch (e) {
    strapi.log.error(`[${logPrefix}] S3 delete phase failed`, e);
  }

  const upload = strapi.plugin('upload').service('upload');
  let deletedUploads = 0;

  for (const mediaId of mediaIds) {
    try {
      await upload.remove({ id: mediaId });
      deletedUploads++;
    } catch (e) {
      strapi.log.error(`[${logPrefix}] upload.remove failed id=${mediaId}`, e);
    }
  }

  return { deletedProjects: rowIds.length, deletedUploads };
};

export const deleteProjectsByOwnerWithAssets = async (
  strapi,
  opts: {
    where: ProjectOwnerWhere;
    logPrefix: string;
  }
) => {
  const { where, logPrefix } = opts;

  const projectRows = await strapi.db.query(UID.project).findMany({
    where,
    select: ['id'],
  });

  const projectIds = uniquePositiveIds(
    (Array.isArray(projectRows) ? projectRows : []).map((r) => r?.id)
  );
  return deleteProjectsByIdsWithAssets(strapi, { projectIds, logPrefix });
};

export const findOrphanProjectIds = async (strapi): Promise<number[]> => {
  const knex = strapi.db.connection;
  const teacherJoin = getRelationJoinTable(strapi, UID.project, 'teacher');
  const studentJoin = getRelationJoinTable(strapi, UID.project, 'student');

  const teacherOrphanRows = await knex('projects as p')
    .leftJoin(`${teacherJoin.table} as pt`, `pt.${teacherJoin.sourceCol}`, 'p.id')
    .where('p.owner_type', 'teacher')
    .whereNull(`pt.${teacherJoin.targetCol}`)
    .select('p.id as id');

  const studentOrphanRows = await knex('projects as p')
    .leftJoin(`${studentJoin.table} as ps`, `ps.${studentJoin.sourceCol}`, 'p.id')
    .where('p.owner_type', 'student')
    .whereNull(`ps.${studentJoin.targetCol}`)
    .select('p.id as id');

  return uniquePositiveIds([
    ...(Array.isArray(teacherOrphanRows) ? teacherOrphanRows.map((r) => r?.id) : []),
    ...(Array.isArray(studentOrphanRows) ? studentOrphanRows.map((r) => r?.id) : []),
  ]);
};

export const cleanupOrphanProjectsWithAssets = async (
  strapi,
  opts?: {
    logPrefix?: string;
  }
): Promise<CleanupResult & { orphanProjects: number }> => {
  const logPrefix = opts?.logPrefix ?? 'project.orphan-cleanup';
  const orphanProjectIds = await findOrphanProjectIds(strapi);
  if (!orphanProjectIds.length) {
    return { orphanProjects: 0, deletedProjects: 0, deletedUploads: 0 };
  }

  const result = await deleteProjectsByIdsWithAssets(strapi, {
    projectIds: orphanProjectIds,
    logPrefix,
  });

  return {
    orphanProjects: orphanProjectIds.length,
    deletedProjects: result.deletedProjects,
    deletedUploads: result.deletedUploads,
  };
};
