import sharp from 'sharp';
import { MAX_BYTES } from './clipboard';
import { PasteError } from './errors';

export interface Image { data: Buffer; extension: 'png' | 'jpg' | 'webp'; width: number; height: number }
export async function validateImage(data: Buffer): Promise<Image> {
  if (!data.length || data.length > MAX_BYTES) throw new PasteError('TOO_LARGE', '图片为空或超过 20 MiB。');
  const isPng = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  const isWebp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) throw new PasteError('FORMAT', '图片内容必须是 PNG、JPEG 或 WebP。');
  try {
    const image = sharp(data, { limitInputPixels: 25000000, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) throw new PasteError('ANIMATED', '首版只支持静态图片。');
    // Metadata alone accepts truncated files. Decode every pixel before persisting the original bytes.
    const decoded = await image.raw().toBuffer({ resolveWithObject: true });
    return { data, extension: isPng ? 'png' : isJpeg ? 'jpg' : 'webp', width: decoded.info.width, height: decoded.info.height };
  } catch (error) {
    if (error instanceof PasteError) throw error;
    throw new PasteError('IMAGE_INVALID', '图片损坏、无法解码或超过 2500 万像素限制。');
  }
}
