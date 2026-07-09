import { ForbiddenException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UploadSecurityService } from './upload-security.service';

describe('UploadSecurityService', () => {
  const service = new UploadSecurityService();
  const tempRoots: string[] = [];
  let cwdSpy: jest.SpiedFunction<typeof process.cwd>;

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  async function useTempCwd() {
    const tempRoot = await mkdtemp(join(tmpdir(), 'fixzone-upload-test-'));
    tempRoots.push(tempRoot);
    cwdSpy?.mockRestore();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    return tempRoot;
  }

  afterEach(() => {
    cwdSpy?.mockRestore();
  });

  afterAll(async () => {
    await Promise.all(
      tempRoots.map((tempRoot) =>
        rm(tempRoot, { recursive: true, force: true }),
      ),
    );
  });

  it.each([
    ['JPEG', 'image/jpeg', jpeg, '.jpg'],
    ['PNG', 'image/png', png, '.png'],
    ['WebP', 'image/webp', webp, '.webp'],
  ])(
    'stores a valid %s upload under uploads/',
    async (_label, mime, image, ext) => {
      const tempRoot = await useTempCwd();

      const saved = await service.saveBase64Image({
        imageBase64: image.toString('base64'),
        contentType: mime,
        folder: 'report-evidence',
        reportId: 'report_123',
        invalidSizeMessage: 'Invalid report image size',
      });

      expect(saved.imagePath).toMatch(
        new RegExp(`^report-evidence/report_123/.+\\${ext}$`),
      );
      expect(saved.imageUrl).toBe(`/uploads/${saved.imagePath}`);
      expect(saved.imagePath).not.toContain('..');
      await expect(
        readFile(join(tempRoot, 'uploads', saved.imagePath)),
      ).resolves.toEqual(image);
    },
  );

  it('rejects oversized uploads while preserving the 5 MB decoded limit', () => {
    const oversizedJpeg = Buffer.concat([
      jpeg,
      Buffer.alloc(5 * 1024 * 1024 - jpeg.length + 1),
    ]);

    expect(() =>
      service.decodeAndValidateBase64Image({
        imageBase64: oversizedJpeg.toString('base64'),
        contentType: 'image/jpeg',
        invalidSizeMessage: 'Invalid report image size',
      }),
    ).toThrow(new ForbiddenException('Invalid report image size'));
  });

  it('rejects malformed base64 before decode', () => {
    expect(() =>
      service.decodeAndValidateBase64Image({
        imageBase64: 'not valid base64!',
        contentType: 'image/jpeg',
        invalidSizeMessage: 'Invalid report image size',
      }),
    ).toThrow(new ForbiddenException('Malformed base64 image'));
  });

  it('rejects MIME mismatches between contentType and actual signature', () => {
    expect(() =>
      service.decodeAndValidateBase64Image({
        imageBase64: png.toString('base64'),
        contentType: 'image/jpeg',
        invalidSizeMessage: 'Invalid report image size',
      }),
    ).toThrow(new ForbiddenException('Image content type mismatch'));
  });

  it('rejects unsupported file signatures', () => {
    const gif = Buffer.from('GIF89a', 'ascii');

    expect(() =>
      service.decodeAndValidateBase64Image({
        imageBase64: gif.toString('base64'),
        contentType: 'image/jpeg',
        invalidSizeMessage: 'Invalid report image size',
      }),
    ).toThrow(new ForbiddenException('Unsupported image type'));
  });

  it('rejects path traversal attempts', async () => {
    await useTempCwd();

    await expect(
      service.saveBase64Image({
        imageBase64: jpeg.toString('base64'),
        contentType: 'image/jpeg',
        folder: 'report-evidence',
        reportId: '../outside',
        invalidSizeMessage: 'Invalid report image size',
      }),
    ).rejects.toThrow(new ForbiddenException('Invalid upload path'));
  });
});
