import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAuth } from 'firebase-admin/auth';

export type VerifiedFirebaseIdentity = {
  uid: string;
  phoneNumber?: string | null;
  email?: string | null;
  emailVerified: boolean;
  fullName?: string | null;
  signInProvider?: string | null;
};

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

@Injectable()
export class FirebaseAuthVerifierService {
  private initialized = false;

  async verifyIdToken(idToken: string): Promise<VerifiedFirebaseIdentity> {
    const token = idToken.trim();
    if (!token) {
      throw new UnauthorizedException('Firebase ID token is required');
    }

    this.ensureInitialized();

    try {
      const decoded = await getAuth().verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        phoneNumber:
          typeof decoded.phone_number === 'string'
            ? decoded.phone_number.trim()
            : null,
        email:
          typeof decoded.email === 'string'
            ? decoded.email.toLowerCase().trim()
            : null,
        emailVerified: decoded.email_verified === true,
        fullName: typeof decoded.name === 'string' ? decoded.name.trim() : null,
        signInProvider:
          typeof decoded.firebase?.sign_in_provider === 'string'
            ? decoded.firebase.sign_in_provider.trim()
            : null,
      };
    } catch {
      throw new UnauthorizedException(
        'Firebase ID token could not be verified',
      );
    }
  }

  private ensureInitialized() {
    if (this.initialized || admin.apps.length > 0) {
      this.initialized = true;
      return;
    }

    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (serviceAccountPath) {
      admin.initializeApp({
        credential: admin.credential.cert(
          this.loadServiceAccount(serviceAccountPath) as admin.ServiceAccount,
        ),
        ...(projectId ? { projectId } : {}),
      });
      this.initialized = true;
      return;
    }

    if (projectId || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
      this.initialized = true;
      return;
    }

    throw new UnauthorizedException(
      'Firebase authentication verification is not configured',
    );
  }

  private loadServiceAccount(serviceAccountPath: string): ServiceAccountJson {
    const absolutePath = path.resolve(process.cwd(), serviceAccountPath);
    if (!fs.existsSync(absolutePath)) {
      throw new UnauthorizedException(
        'Firebase authentication verification is not configured',
      );
    }

    let parsed: ServiceAccountJson;
    try {
      parsed = JSON.parse(
        fs.readFileSync(absolutePath, 'utf8'),
      ) as ServiceAccountJson;
    } catch {
      throw new UnauthorizedException(
        'Firebase authentication verification is not configured',
      );
    }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new UnauthorizedException(
        'Firebase authentication verification is not configured',
      );
    }
    return parsed;
  }
}
