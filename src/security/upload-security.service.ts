import { ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { posix, relative, resolve, sep } from 'path';
import { uploadRoot } from '../storage/upload-root';

type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const MAX_DECODED_IMAGE_BYTES = 5 * 1024 * 1024;

const supportedTypes: Record<SupportedImageMime, { extension: string }> = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
};

@Injectable()
export class UploadSecurityService {
  async saveBase64Image(params: {
    imageBase64: string;
    contentType: string;
    folder: string;
    reportId: string;
    invalidSizeMessage: string;
  }) {
    const image = this.decodeAndValidateBase64Image({
      imageBase64: params.imageBase64,
      contentType: params.contentType,
      invalidSizeMessage: params.invalidSizeMessage,
    });
    const folder = this.assertSafePathSegment(params.folder);
    const reportId = this.assertSafePathSegment(params.reportId);
    const fileName = `${Date.now()}-${randomUUID()}.${supportedTypes[image.mime].extension}`;
    const root = uploadRoot();
    const targetDir = resolve(root, folder, reportId);
    const targetPath = resolve(targetDir, fileName);

    this.assertInsideUploadRoot(root, targetDir);
    this.assertInsideUploadRoot(root, targetPath);

    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, image.buffer);

    const imagePath = posix.join(folder, reportId, fileName);
    return {
      imagePath,
      imageUrl: `/uploads/${imagePath}`,
    };
  }

  decodeAndValidateBase64Image(params: {
    imageBase64: string;
    contentType: string;
    invalidSizeMessage: string;
  }) {
    this.assertSupportedDeclaredContentType(params.contentType);
    this.assertStrictBase64(params.imageBase64);

    const buffer = Buffer.from(params.imageBase64, 'base64');

    if (
      buffer.length === 0 ||
      buffer.length > MAX_DECODED_IMAGE_BYTES ||
      buffer.toString('base64') !== params.imageBase64
    ) {
      throw new ForbiddenException(params.invalidSizeMessage);
    }

    const detectedMime = this.detectImageMime(buffer);

    if (!detectedMime) {
      throw new ForbiddenException('Unsupported image type');
    }

    if (detectedMime !== params.contentType) {
      throw new ForbiddenException('Image content type mismatch');
    }

    return { buffer, mime: detectedMime };
  }

  private assertSupportedDeclaredContentType(
    contentType: string,
  ): asserts contentType is SupportedImageMime {
    if (!Object.hasOwn(supportedTypes, contentType)) {
      throw new ForbiddenException('Unsupported image type');
    }
  }

  private assertStrictBase64(value: string) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length % 4 !== 0 ||
      !this.hasOnlyStrictBase64Characters(value)
    ) {
      throw new ForbiddenException('Malformed base64 image');
    }
  }

  private hasOnlyStrictBase64Characters(value: string) {
    const firstPadding = value.indexOf('=');
    const dataEnd = firstPadding === -1 ? value.length : firstPadding;
    const paddingLength = firstPadding === -1 ? 0 : value.length - firstPadding;

    if (paddingLength > 2) {
      return false;
    }

    for (
      let index = firstPadding;
      index !== -1 && index < value.length;
      index += 1
    ) {
      if (value[index] !== '=') {
        return false;
      }
    }

    for (let index = 0; index < dataEnd; index += 1) {
      const code = value.charCodeAt(index);
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      const isDigit = code >= 48 && code <= 57;

      if (
        !isUpper &&
        !isLower &&
        !isDigit &&
        value[index] !== '+' &&
        value[index] !== '/'
      ) {
        return false;
      }
    }

    return true;
  }

  private detectImageMime(buffer: Buffer): SupportedImageMime | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    return null;
  }

  private assertSafePathSegment(value: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new ForbiddenException('Invalid upload path');
    }

    return value;
  }

  private assertInsideUploadRoot(uploadRoot: string, targetPath: string) {
    const relativePath = relative(uploadRoot, targetPath);

    if (
      relativePath === '' ||
      relativePath.startsWith('..') ||
      relativePath.includes(`..${sep}`) ||
      resolve(uploadRoot, relativePath) !== targetPath
    ) {
      throw new ForbiddenException('Invalid upload path');
    }
  }
}
