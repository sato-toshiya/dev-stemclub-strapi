export default ({ env }) => {
  const isLocalstack = env('S3_PROVIDER') === 'localstack';

  const bucket = env('AWS_S3_BUCKET', 'pionero-ste-strapi-dev');
  const region = env('AWS_REGION', 'ap-northeast-1');
  const endpoint = env('AWS_S3_ENDPOINT', 'http://localhost:4566');

  const prodBaseUrl = env('AWS_S3_BASE_URL') || `https://${bucket}.s3.${region}.amazonaws.com`;
  const localBaseUrl = `${endpoint.replace(/\/$/, '')}/${bucket}`;

  return {
    upload: {
      config: {
        provider: 'aws-s3',
        providerOptions: {
          rootPath: env('AWS_S3_ROOT_PATH', 'media'),
          baseUrl: (isLocalstack ? localBaseUrl : prodBaseUrl).replace(/\/$/, ''),
          s3Options: {
            region,
            ...(isLocalstack
              ? {
                  endpoint,
                  forcePathStyle: env.bool('AWS_S3_FORCE_PATH_STYLE', true),
                  credentials: {
                    accessKeyId: env('AWS_ACCESS_KEY_ID', 'test'),
                    secretAccessKey: env('AWS_SECRET_ACCESS_KEY', 'test'),
                  },
                }
              : {
                  // prod: IAM Role
                }),
            params: {
              Bucket: bucket,
              ACL: 'private',
            },
          },
        },
      },
    },
  };
};
