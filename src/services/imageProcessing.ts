/**
 * Image Processing Utilities
 *
 * Provides common image manipulation functions for the Sogni Makeover app
 * including resizing, compression, format conversion, cropping, and validation.
 */

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Resize an image file while maintaining its aspect ratio.
 * The output dimensions will not exceed maxWidth x maxHeight.
 * Returns a new File with the resized image in its original format (or PNG for non-JPEG/WebP).
 */
export async function resizeImage(
  file: File,
  maxWidth: number,
  maxHeight: number
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { width: origW, height: origH } = bitmap;

  // Calculate the scale factor to fit within max dimensions
  const scale = Math.min(1, maxWidth / origW, maxHeight / origH);

  const targetW = Math.round(origW * scale);
  const targetH = Math.round(origH * scale);

  // If no resize needed, return the original
  if (scale >= 1) {
    bitmap.close();
    return file;
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get 2d context for image resize');
  }

  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const outputType = ACCEPTED_IMAGE_TYPES.includes(file.type) ? file.type : 'image/png';
  const blob = await canvas.convertToBlob({ type: outputType, quality: 0.92 });
  return new File([blob], file.name, { type: outputType, lastModified: Date.now() });
}

/**
 * Compress an image file using JPEG encoding at the specified quality (0-1).
 * Non-JPEG inputs will be converted to JPEG.
 */
export async function compressImage(
  file: File,
  quality: number
): Promise<File> {
  const clampedQuality = Math.max(0, Math.min(1, quality));
  const bitmap = await createImageBitmap(file);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get 2d context for image compression');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: clampedQuality });

  // Derive a .jpg filename
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

/**
 * Convert a File to a base64 data URL string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return a string'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a base64 data URL string back to a Blob.
 * Accepts strings with or without the data URL prefix.
 */
export function base64ToBlob(base64: string): Blob {
  let mimeType = 'application/octet-stream';
  let data = base64;

  // Parse data URL prefix if present
  const match = base64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    mimeType = match[1];
    data = match[2];
  }

  const byteString = atob(data);
  const byteArray = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    byteArray[i] = byteString.charCodeAt(i);
  }

  return new Blob([byteArray], { type: mimeType });
}

/**
 * Center-crop an image to a 2:3 aspect ratio (portrait).
 * Fits the largest 2:3 rectangle inside the original image.
 */
export async function cropToPortrait(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const TARGET_RATIO = 2 / 3;

  // Already 2:3
  if (Math.abs(width / height - TARGET_RATIO) < 0.001) {
    bitmap.close();
    return file;
  }

  let cropW: number, cropH: number;
  if (width / height > TARGET_RATIO) {
    // Image is wider than 2:3 — height is the constraint
    cropH = height;
    cropW = Math.round(height * TARGET_RATIO);
  } else {
    // Image is taller than 2:3 — width is the constraint
    cropW = width;
    cropH = Math.round(width / TARGET_RATIO);
  }

  const offsetX = Math.round((width - cropW) / 2);
  const offsetY = Math.round((height - cropH) / 2);

  const canvas = new OffscreenCanvas(cropW, cropH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get 2d context for portrait crop');
  }

  ctx.drawImage(bitmap, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);
  bitmap.close();

  const outputType = ACCEPTED_IMAGE_TYPES.includes(file.type) ? file.type : 'image/png';
  const blob = await canvas.convertToBlob({ type: outputType, quality: 0.92 });
  return new File([blob], file.name, { type: outputType, lastModified: Date.now() });
}

/**
 * Detect and trim uniform-colored padding around the subject of an image.
 * Samples corner pixels to determine the background color, then scans inward
 * from each edge to find the content bounds. Returns the original file
 * unchanged if trimming would remove less than 10% on both axes.
 */
export async function trimPadding(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return file; }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, width, height);

  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // Sample background from 5×5 patches at each corner
  const sampleCorner = (cx: number, cy: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.max(0, Math.min(width - 1, cx + dx));
        const y = Math.max(0, Math.min(height - 1, cy + dy));
        const [pr, pg, pb] = px(x, y);
        r += pr; g += pg; b += pb; n++;
      }
    }
    return [r / n, g / n, b / n] as const;
  };

  const corners = [
    sampleCorner(2, 2),
    sampleCorner(width - 3, 2),
    sampleCorner(2, height - 3),
    sampleCorner(width - 3, height - 3),
  ];
  const bg: [number, number, number] = [
    corners.reduce((s, c) => s + c[0], 0) / 4,
    corners.reduce((s, c) => s + c[1], 0) / 4,
    corners.reduce((s, c) => s + c[2], 0) / 4,
  ];

  const DIST_THRESHOLD = 35;
  const BG_RATIO = 0.85;

  const isBg = (x: number, y: number) => {
    const [r, g, b] = px(x, y);
    return Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2) < DIST_THRESHOLD;
  };

  const isRowPadding = (y: number) => {
    const step = Math.max(1, Math.floor(width / 64));
    let bgCount = 0, samples = 0;
    for (let x = 0; x < width; x += step) {
      if (isBg(x, y)) bgCount++;
      samples++;
    }
    return bgCount / samples >= BG_RATIO;
  };

  const isColPadding = (x: number, startY: number, endY: number) => {
    const step = Math.max(1, Math.floor((endY - startY) / 64));
    let bgCount = 0, samples = 0;
    for (let y = startY; y <= endY; y += step) {
      if (isBg(x, y)) bgCount++;
      samples++;
    }
    return bgCount / samples >= BG_RATIO;
  };

  let top = 0;
  for (let y = 0; y < height; y++) {
    if (!isRowPadding(y)) { top = y; break; }
  }
  let bottom = height - 1;
  for (let y = height - 1; y >= top; y--) {
    if (!isRowPadding(y)) { bottom = y; break; }
  }
  let left = 0;
  for (let x = 0; x < width; x++) {
    if (!isColPadding(x, top, bottom)) { left = x; break; }
  }
  let right = width - 1;
  for (let x = width - 1; x >= left; x--) {
    if (!isColPadding(x, top, bottom)) { right = x; break; }
  }

  // Add a small margin (2% of content size)
  const margin = Math.round(Math.max(right - left, bottom - top) * 0.02);
  top = Math.max(0, top - margin);
  bottom = Math.min(height - 1, bottom + margin);
  left = Math.max(0, left - margin);
  right = Math.min(width - 1, right + margin);

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;

  // Skip if trim is negligible (less than 10% removed on both axes)
  if (cropW > width * 0.9 && cropH > height * 0.9) {
    return file;
  }

  const outCanvas = new OffscreenCanvas(cropW, cropH);
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return file;
  outCtx.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);

  const outputType = ACCEPTED_IMAGE_TYPES.includes(file.type) ? file.type : 'image/png';
  const blob = await outCanvas.convertToBlob({ type: outputType, quality: 0.92 });
  return new File([blob], file.name, { type: outputType, lastModified: Date.now() });
}

/**
 * Validate an image file for type and size constraints.
 *
 * Accepted types: JPEG, PNG, WebP
 * Maximum size: 10 MB
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported file type "${file.type}". Accepted types: JPG, PNG, WebP.`
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size ${sizeMB} MB exceeds the maximum of 10 MB.`
    };
  }

  return { valid: true };
}
