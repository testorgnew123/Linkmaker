let cloudinary;
let configured = false;

async function ensureConfig() {
  if (configured) return;
  const mod = await import('cloudinary');
  cloudinary = mod.v2;
  const url = process.env.CLOUDINARY_URL;
  if (!url) throw new Error('CLOUDINARY_URL is not set');
  cloudinary.config({ cloudinary_url: url });
  configured = true;
}

export async function uploadBuffer(buffer, folder = 'qr-profiles') {
  await ensureConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, transformation: [{ width: 400, height: 400, crop: 'limit' }] },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}
