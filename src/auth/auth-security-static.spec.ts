import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('authentication security static regressions', () => {
  it('does not keep hard-coded reset fallback passwords or returned reset secrets in source', () => {
    const text = [
      ...sourceFiles(join(process.cwd(), 'src', 'auth')),
      ...sourceFiles(join(process.cwd(), 'src', 'users')),
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(text).not.toContain('Password123!');
    expect(text).not.toContain('temporaryPassword');
    expect(text).not.toContain('resetUrl');
    expect(text).not.toContain('tokenPreview');
  });
});
