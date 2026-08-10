// One-off: upload the release APK to R2 (served at cdn.vergr.app, $0 egress).
// Run from functions/ with R2_* env vars set. Prints only the public URL.
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const trim = (s) => (s || '').replace(/[\s\r\n]+$/g, '').trim();
const accountId = trim(process.env.R2_ACCOUNT_ID);
const accessKeyId = trim(process.env.R2_ACCESS_KEY_ID);
const secretAccessKey = trim(process.env.R2_SECRET_ACCESS_KEY);
const bucket = trim(process.env.R2_BUCKET) || 'vergr-media';
const apkPath = process.argv[2];
const key = process.argv[3] || 'downloads/VERGR.apk';

if (!accountId || !accessKeyId || !secretAccessKey) { console.error('missing R2 creds'); process.exit(1); }
if (!apkPath || !fs.existsSync(apkPath)) { console.error('APK not found:', apkPath); process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

(async () => {
  const body = fs.readFileSync(apkPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/vnd.android.package-archive',
    CacheControl: 'public, max-age=300',
  }));
  console.log('uploaded', body.length, 'bytes to', `https://cdn.vergr.app/${key}`);
})().catch((e) => { console.error('upload failed:', e.message); process.exit(1); });
