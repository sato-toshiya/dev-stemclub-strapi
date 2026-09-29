/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-env node */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), 'tmp');
const DEFAULT_REPORT_NAME_PREFIX = 's3-orphan-audit';
const SAMPLE_LIMIT = 30;

function parseArgs(argv) {
  const args = {
    apply: false,
    prefix: '',
    limit: null,
    reportPath: '',
    selfTest: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--self-test') {
      args.selfTest = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--prefix') {
      args.prefix = String(argv[i + 1] ?? '').trim();
      i++;
      continue;
    }
    if (token.startsWith('--prefix=')) {
      args.prefix = token.slice('--prefix='.length).trim();
      continue;
    }
    if (token === '--limit') {
      const raw = Number(argv[i + 1]);
      args.limit = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
      i++;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const raw = Number(token.slice('--limit='.length));
      args.limit = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
      continue;
    }
    if (token === '--report') {
      args.reportPath = String(argv[i + 1] ?? '').trim();
      i++;
      continue;
    }
    if (token.startsWith('--report=')) {
      args.reportPath = token.slice('--report='.length).trim();
    }
  }

  return args;
}

function printHelp() {
  console.log(
    [
      'Usage:',
      '  node scripts/s3-orphan-audit.js [--prefix uploads/] [--limit 100] [--report tmp/audit.json]',
      '  node scripts/s3-orphan-audit.js --apply [--prefix uploads/] [--limit 100]',
      '  node scripts/s3-orphan-audit.js --self-test',
      '',
      'Notes:',
      '  - Default mode is DRY-RUN (no delete).',
      '  - --apply deletes only safe orphan keys.',
      '  - Script aborts delete if any orphan key is also protected by project media.',
      '',
      'Required env:',
      '  - AWS_S3_BUCKET',
      'Optional env:',
      '  - AWS_REGION (default: ap-northeast-1)',
      '  - AWS_S3_ENDPOINT / AWS_S3_FORCE_PATH_STYLE / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (for localstack)',
    ].join('\n')
  );
}

function makeS3Client(env = process.env) {
  const region = env.AWS_REGION || 'ap-northeast-1';
  const endpoint = env.AWS_S3_ENDPOINT;
  const forcePathStyle = String(env.AWS_S3_FORCE_PATH_STYLE || 'true') === 'true';
  const isLocalstack = env.S3_PROVIDER === 'localstack';

  return new S3Client({
    region,
    ...(isLocalstack
      ? {
          endpoint,
          forcePathStyle,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID || 'test',
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY || 'test',
          },
        }
      : {}),
  });
}

function collectFileUrls(file) {
  const urls = [];
  if (typeof file?.url === 'string' && file.url.trim()) urls.push(file.url.trim());

  const formats = file?.formats;
  if (formats && typeof formats === 'object') {
    for (const value of Object.values(formats)) {
      const url = value && typeof value.url === 'string' ? value.url.trim() : '';
      if (url) urls.push(url);
    }
  }

  return Array.from(new Set(urls));
}

function urlToS3Key(rawUrl, bucket) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    if (!pathname) return null;
    if (pathname.startsWith(`${bucket}/`)) return pathname.slice(bucket.length + 1);
    return pathname;
  } catch {
    return null;
  }
}

function normalizeS3Key(value) {
  return String(value || '')
    .replace(/^\/+/, '')
    .trim();
}

function analyzeOrphans({ s3Keys, referencedKeys, protectedProjectKeys }) {
  const orphanCandidateKeys = [];
  for (const key of s3Keys) {
    if (!referencedKeys.has(key)) orphanCandidateKeys.push(key);
  }

  const riskyProjectKeys = [];
  const safeOrphanKeys = [];

  for (const key of orphanCandidateKeys) {
    if (protectedProjectKeys.has(key)) riskyProjectKeys.push(key);
    else safeOrphanKeys.push(key);
  }

  return { orphanCandidateKeys, riskyProjectKeys, safeOrphanKeys };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  const case1 = analyzeOrphans({
    s3Keys: new Set(['a', 'b', 'c']),
    referencedKeys: new Set(['a']),
    protectedProjectKeys: new Set(['b']),
  });

  assert(case1.orphanCandidateKeys.length === 2, 'case1 orphan candidate count mismatch');
  assert(
    case1.riskyProjectKeys.length === 1 && case1.riskyProjectKeys[0] === 'b',
    'case1 risky mismatch'
  );
  assert(
    case1.safeOrphanKeys.length === 1 && case1.safeOrphanKeys[0] === 'c',
    'case1 safe mismatch'
  );

  const case2 = analyzeOrphans({
    s3Keys: new Set(['k1', 'k2']),
    referencedKeys: new Set(['k1', 'k2']),
    protectedProjectKeys: new Set(['k1']),
  });

  assert(case2.orphanCandidateKeys.length === 0, 'case2 should have zero orphan candidates');
  assert(case2.riskyProjectKeys.length === 0, 'case2 risky should be zero');
  assert(case2.safeOrphanKeys.length === 0, 'case2 safe should be zero');

  console.log('[s3-orphan-audit] self-test passed');
}

async function listAllS3Keys(s3, bucket, prefix) {
  const result = new Set();
  let continuationToken = undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    const objects = Array.isArray(response.Contents) ? response.Contents : [];
    for (const obj of objects) {
      const key = normalizeS3Key(obj?.Key);
      if (key) result.add(key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return result;
}

async function bootStrapi() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appDir = process.cwd();
  const distDir = path.resolve(appDir, 'dist');

  const hasCompiledDist =
    (await fs.pathExists(path.join(distDir, 'config'))) &&
    (await fs.pathExists(path.join(distDir, 'src')));

  const appContext = hasCompiledDist ? { appDir, distDir } : await compileStrapi({ appDir });
  return createStrapi(appContext).load();
}

async function collectReferencedUploadKeys(strapi, bucket) {
  const rows = await strapi.db.query('plugin::upload.file').findMany({
    select: ['id', 'url', 'formats'],
  });

  const referencedKeys = new Set();
  const totalFiles = Array.isArray(rows) ? rows.length : 0;

  for (const file of Array.isArray(rows) ? rows : []) {
    for (const url of collectFileUrls(file)) {
      const key = urlToS3Key(url, bucket);
      if (key) referencedKeys.add(key);
    }
  }

  return { referencedKeys, totalUploadRows: totalFiles };
}

async function collectProjectProtectedKeys(strapi, bucket) {
  const projects = await strapi.db.query('api::project.project').findMany({
    select: ['id', 'documentId', 'owner_type'],
    populate: {
      sjr_file: { select: ['id', 'url', 'formats'] },
      thumbnail: { select: ['id', 'url', 'formats'] },
    },
  });

  const protectedProjectKeys = new Set();
  let projectCount = 0;
  let projectMissingMediaCount = 0;

  for (const project of Array.isArray(projects) ? projects : []) {
    projectCount++;

    const medias = [project?.sjr_file, project?.thumbnail];
    if (!project?.sjr_file?.id) projectMissingMediaCount++;

    for (const media of medias) {
      if (!media) continue;
      for (const url of collectFileUrls(media)) {
        const key = urlToS3Key(url, bucket);
        if (key) protectedProjectKeys.add(key);
      }
    }
  }

  return { protectedProjectKeys, projectCount, projectMissingMediaCount };
}

function toSample(list) {
  return list.slice(0, SAMPLE_LIMIT);
}

async function writeReport(reportPath, payload) {
  const target =
    reportPath ||
    path.join(
      DEFAULT_REPORT_DIR,
      `${DEFAULT_REPORT_NAME_PREFIX}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );

  await fs.ensureDir(path.dirname(target));
  await fs.writeJson(target, payload, { spaces: 2 });
  return target;
}

async function deleteKeys(s3, bucket, keys) {
  let deleted = 0;
  const failed = [];

  for (const key of keys) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      deleted++;
    } catch (error) {
      failed.push({
        key,
        message: error instanceof Error ? error.message : String(error ?? 'unknown error'),
      });
    }
  }

  return { deleted, failed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const app = await bootStrapi();

  try {
    const bucket = String(process.env.AWS_S3_BUCKET || '').trim();
    if (!bucket) {
      throw new Error('Missing AWS_S3_BUCKET');
    }

    const s3 = makeS3Client();

    console.log(`[s3-orphan-audit] mode=${args.apply ? 'apply' : 'dry-run'} bucket=${bucket}`);
    if (args.prefix) console.log(`[s3-orphan-audit] prefix=${args.prefix}`);
    if (args.limit) console.log(`[s3-orphan-audit] limit=${args.limit}`);

    const [
      { referencedKeys, totalUploadRows },
      { protectedProjectKeys, projectCount, projectMissingMediaCount },
      s3Keys,
    ] = await Promise.all([
      collectReferencedUploadKeys(app, bucket),
      collectProjectProtectedKeys(app, bucket),
      listAllS3Keys(s3, bucket, args.prefix),
    ]);

    const { orphanCandidateKeys, riskyProjectKeys, safeOrphanKeys } = analyzeOrphans({
      s3Keys,
      referencedKeys,
      protectedProjectKeys,
    });

    const safeKeysToProcess =
      typeof args.limit === 'number' && args.limit > 0
        ? safeOrphanKeys.slice(0, args.limit)
        : safeOrphanKeys;

    const summary = {
      mode: args.apply ? 'apply' : 'dry-run',
      bucket,
      prefix: args.prefix || null,
      projectCount,
      projectMissingMediaCount,
      totalUploadRows,
      s3ObjectCount: s3Keys.size,
      referencedKeyCount: referencedKeys.size,
      protectedProjectKeyCount: protectedProjectKeys.size,
      orphanCandidateCount: orphanCandidateKeys.length,
      riskyProjectKeyCount: riskyProjectKeys.length,
      safeOrphanCount: safeOrphanKeys.length,
      safeOrphanToProcessCount: safeKeysToProcess.length,
    };

    let deleteResult = { deleted: 0, failed: [] };

    if (args.apply) {
      if (riskyProjectKeys.length > 0) {
        throw new Error(
          `Abort apply: found ${riskyProjectKeys.length} risky keys that overlap project media`
        );
      }
      deleteResult = await deleteKeys(s3, bucket, safeKeysToProcess);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        ...summary,
        deletedCount: deleteResult.deleted,
        deleteFailedCount: deleteResult.failed.length,
      },
      samples: {
        riskyProjectKeys: toSample(riskyProjectKeys),
        safeOrphanKeys: toSample(safeOrphanKeys),
        deletedFailed: toSample(deleteResult.failed),
      },
    };

    const reportFile = await writeReport(args.reportPath, report);

    console.log('[s3-orphan-audit] summary');
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`[s3-orphan-audit] report=${reportFile}`);
    if (riskyProjectKeys.length > 0) {
      console.log(
        '[s3-orphan-audit] WARNING: risky keys detected, inspect report before any delete.'
      );
    }
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('[s3-orphan-audit] failed');
  console.error(error);
  process.exit(1);
});
