import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const makeS3Client = (env = process.env) => {
  const region = env.AWS_REGION ?? 'ap-northeast-1';

  const endpoint = env.AWS_S3_ENDPOINT;
  const forcePathStyle = String(env.AWS_S3_FORCE_PATH_STYLE ?? 'true') === 'true';

  const isLocalstack = env.S3_PROVIDER === 'localstack';

  return new S3Client({
    region,
    ...(isLocalstack
      ? {
          endpoint,
          forcePathStyle,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? 'test',
          },
        }
      : {
          // prod/staging: IAM Role (no credentials)
        }),
  });
};

export const collectFileUrls = (file): string[] => {
  const urls: string[] = [];
  if (typeof file?.url === 'string' && file.url) urls.push(file.url);

  const fmts = file?.formats;
  if (fmts && typeof fmts === 'object') {
    for (const v of Object.values(fmts)) {
      const u = (v as any)?.url;
      if (typeof u === 'string' && u) urls.push(u);
    }
  }

  return Array.from(new Set(urls));
};

export const urlToS3Key = (rawUrl: string, bucket: string): string | null => {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/^\/+/, '');

    if (!path) return null;

    if (path.startsWith(bucket + '/')) {
      return path.slice(bucket.length + 1);
    }
    return path;
  } catch {
    return null;
  }
};

export const deleteS3ObjectsByUrls = async (args: {
  bucket: string;
  urls: string[];
  log?: (msg: string, extra?) => void;
}) => {
  const { bucket, urls, log } = args;

  if (!bucket) throw new Error('AWS_S3_BUCKET が設定されていません');
  if (!urls.length) return { deleted: 0, keys: [] as string[] };

  const s3 = makeS3Client();

  const keys = urls.map((u) => urlToS3Key(u, bucket)).filter((k): k is string => !!k);

  const uniqKeys = Array.from(new Set(keys));

  let deleted = 0;

  for (const key of uniqKeys) {
    try {
      log?.(`[s3] deleteObject bucket=${bucket} key=${key}`);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted++;
    } catch (e) {
      log?.(`[s3] deleteObject FAILED key=${key}`, e);
    }
  }

  return { deleted, keys: uniqKeys };
};
