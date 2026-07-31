import { getJwtAccessSecret } from './jwt-secret';

describe('getJwtAccessSecret', () => {
  it('accepts an explicit development secret', () => {
    expect(
      getJwtAccessSecret({
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'dev-secret-for-tests',
      }),
    ).toBe('dev-secret-for-tests');
  });

  it('accepts an explicit test secret', () => {
    expect(
      getJwtAccessSecret({
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: 'test-secret-for-tests',
      }),
    ).toBe('test-secret-for-tests');
  });

  it('retains deterministic local fallback for test and development only', () => {
    expect(getJwtAccessSecret({ NODE_ENV: 'test' })).toBe(
      'fixzone_local_development_jwt_secret',
    );
    expect(getJwtAccessSecret({ NODE_ENV: 'development' })).toBe(
      'fixzone_local_development_jwt_secret',
    );
  });

  it('rejects missing production secret', () => {
    expect(() => getJwtAccessSecret({ NODE_ENV: 'production' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
  });

  it('rejects empty production secret', () => {
    expect(() =>
      getJwtAccessSecret({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: '   ',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('rejects known insecure production and staging fallback secrets', () => {
    expect(() =>
      getJwtAccessSecret({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'fixzone_access_secret',
      }),
    ).toThrow('JWT_ACCESS_SECRET');

    expect(() =>
      getJwtAccessSecret({
        NODE_ENV: 'staging',
        JWT_ACCESS_SECRET: 'change-me',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('accepts a valid production-like secret without exposing it in errors', () => {
    const secret = 'prod-value-with-rotation-material-2026';

    expect(
      getJwtAccessSecret({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: secret,
      }),
    ).toBe(secret);

    try {
      getJwtAccessSecret({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'placeholder',
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
