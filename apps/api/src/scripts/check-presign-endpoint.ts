/**
 * Upload URL signing (FilesService.presign), no MinIO or database needed.
 *
 * A presigned URL signs the Host header, so it only works on the host it was
 * signed for. Docker runs the API against `minio:9000` while browsers upload
 * to `localhost:9100`:
 *
 *  1. With S3_PRESIGN_ENDPOINT set, the URL points at that host and its
 *     signature is the one a client signing for that host computes, so MinIO
 *     accepts the browser's PUT.
 *  2. Without it, behaviour is unchanged: the URL is signed for S3_ENDPOINT,
 *     and S3_PUBLIC_URL (when set) only swaps the host afterwards.
 *
 * Run: pnpm --filter @botss/api test.
 */
import assert from 'node:assert/strict';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { FilesService } from '../files/files.service';
import type { PrismaService } from '../prisma/prisma.service';

const INTERNAL = 'http://minio:9000';
const BROWSER = 'http://localhost:9100';
const INPUT = { filename: 'photo.png', mimeType: 'image/png', sizeBytes: 1234 };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function presign(): Promise<Awaited<ReturnType<FilesService['presign']>>> {
  // presign() never touches the database.
  return new FilesService({} as unknown as PrismaService).presign('ws_check', INPUT);
}

/** The signature a client configured for `endpoint` produces for the same request. */
async function expectedSignature(
  endpoint: string,
  res: Awaited<ReturnType<FilesService['presign']>>,
): Promise<string | null> {
  const signed = new URL(res.uploadUrl);
  const amzDate = signed.searchParams.get('X-Amz-Date') ?? '';
  const signingDate = new Date(
    amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
  );
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: 'botss-local', secretAccessKey: 'botss-local-secret' },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: res.bucket,
      Key: res.objectKey,
      ContentType: INPUT.mimeType,
      ContentLength: INPUT.sizeBytes,
      ContentDisposition: res.headers['Content-Disposition'],
    }),
    { expiresIn: 600, signingDate },
  );
  return new URL(url).searchParams.get('X-Amz-Signature');
}

async function main(): Promise<void> {
  setEnv({
    S3_REGION: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    S3_FORCE_PATH_STYLE: undefined,
    S3_BUCKET: undefined,
  });

  // 1. Signed for the browser's host.
  setEnv({ S3_ENDPOINT: INTERNAL, S3_PUBLIC_URL: BROWSER, S3_PRESIGN_ENDPOINT: BROWSER });
  const docker = await presign();
  const dockerUrl = new URL(docker.uploadUrl);
  assert.equal(dockerUrl.origin, BROWSER);
  assert.equal(dockerUrl.pathname, `/botss-files/${docker.objectKey}`);
  assert.equal(
    dockerUrl.searchParams.get('X-Amz-Signature'),
    await expectedSignature(BROWSER, docker),
    'upload URL must carry a signature valid for the host the browser sends',
  );

  // 2a. Unset: signed for S3_ENDPOINT, as before.
  setEnv({ S3_ENDPOINT: BROWSER, S3_PUBLIC_URL: undefined, S3_PRESIGN_ENDPOINT: undefined });
  const local = await presign();
  assert.equal(new URL(local.uploadUrl).origin, BROWSER);
  assert.equal(
    new URL(local.uploadUrl).searchParams.get('X-Amz-Signature'),
    await expectedSignature(BROWSER, local),
  );

  // 2b. Unset with S3_PUBLIC_URL: the existing host swap, signature untouched.
  setEnv({ S3_ENDPOINT: INTERNAL, S3_PUBLIC_URL: BROWSER, S3_PRESIGN_ENDPOINT: undefined });
  const swapped = await presign();
  assert.equal(new URL(swapped.uploadUrl).origin, BROWSER);
  assert.equal(
    new URL(swapped.uploadUrl).searchParams.get('X-Amz-Signature'),
    await expectedSignature(INTERNAL, swapped),
  );

  console.log('check-presign-endpoint: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
