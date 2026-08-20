import { join, resolve } from 'path';

export const UPLOAD_ROOT_ENV = 'UPLOAD_ROOT';

export function uploadRoot() {
  const configuredRoot = process.env[UPLOAD_ROOT_ENV]?.trim();
  return configuredRoot
    ? resolve(configuredRoot)
    : resolve(process.cwd(), 'uploads');
}

export function uploadPath(...segments: string[]) {
  return join(uploadRoot(), ...segments);
}
