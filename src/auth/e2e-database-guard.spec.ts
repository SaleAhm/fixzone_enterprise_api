import { validateE2eDatabaseUrl } from '../../test/e2e-database-guard';

describe('e2e database guard', () => {
  const authorized =
    'postgresql://fixture_user:fixture_password@localhost:5432/fixzone_auth_e2e_20260904';

  it('accepts only the authorized local e2e database', () => {
    expect(validateE2eDatabaseUrl(authorized)).toEqual({
      databaseName: 'fixzone_auth_e2e_20260904',
    });
  });

  it('rejects a missing variable', () => {
    expect(() => validateE2eDatabaseUrl(undefined)).toThrow(
      'E2E_DATABASE_URL is required',
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => validateE2eDatabaseUrl('not a url')).toThrow(
      'E2E_DATABASE_URL is malformed',
    );
  });

  it('rejects a non-PostgreSQL protocol', () => {
    expect(() =>
      validateE2eDatabaseUrl(
        'mysql://fixture_user:fixture_password@localhost:3306/fixzone_auth_e2e_20260904',
      ),
    ).toThrow('E2E_DATABASE_URL must use PostgreSQL');
  });

  it('rejects a remote hostname', () => {
    expect(() =>
      validateE2eDatabaseUrl(
        'postgresql://fixture_user:fixture_password@db.fixzone.example:5432/fixzone_auth_e2e_20260904',
      ),
    ).toThrow('E2E_DATABASE_URL must target a local host');
  });

  it('rejects the wrong database name', () => {
    expect(() =>
      validateE2eDatabaseUrl(
        'postgresql://fixture_user:fixture_password@localhost:5432/fixzone_other_e2e',
      ),
    ).toThrow(
      'E2E_DATABASE_URL must target the authorized disposable database',
    );
  });

  it('rejects the ordinary development database', () => {
    expect(() =>
      validateE2eDatabaseUrl(
        'postgresql://fixture_user:fixture_password@localhost:5432/fixzone_enterprise',
      ),
    ).toThrow(
      'E2E_DATABASE_URL must target the authorized disposable database',
    );
  });

  it('rejects a production-like target', () => {
    expect(() =>
      validateE2eDatabaseUrl(
        'postgresql://fixture_user:fixture_password@fixzone-production.example:5432/fixzone_auth_e2e_20260904',
      ),
    ).toThrow('E2E_DATABASE_URL must target a local host');
  });
});
