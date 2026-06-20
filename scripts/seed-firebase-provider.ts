import 'dotenv/config';
import * as admin from 'firebase-admin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

const provider = {
  email: 'provider1@fixzone.ng',
  password: 'Password123!',
  providerId: 'PRV-2024-001',
  role: 'provider',
  fullName: 'Abdul Kareem',
  phone: '08000000001',
  isActive: true,
};

function loadServiceAccount(): ServiceAccountJson {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath?.trim()) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH must point to a service account JSON file.');
  }

  const absolutePath = path.resolve(process.cwd(), serviceAccountPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Firebase service account file not found at ${absolutePath}.`);
  }

  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as ServiceAccountJson;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      'Firebase service account JSON must include project_id, client_email, and private_key.',
    );
  }

  return parsed;
}

function initializeFirebase() {
  if (admin.apps.length > 0) return;

  const serviceAccount = loadServiceAccount();

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

async function upsertAuthUser() {
  const auth = getAuth();

  try {
    const existingUser = await auth.getUserByEmail(provider.email);

    await auth.updateUser(existingUser.uid, {
      email: provider.email,
      password: provider.password,
      displayName: provider.fullName,
      disabled: false,
    });

    return {
      uid: existingUser.uid,
      created: false,
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'auth/user-not-found'
    ) {
      const createdUser = await auth.createUser({
        email: provider.email,
        password: provider.password,
        displayName: provider.fullName,
        disabled: false,
      });

      return {
        uid: createdUser.uid,
        created: true,
      };
    }

    throw error;
  }
}

async function upsertProviderProfile(uid: string) {
  const db = getFirestore();
  const docRef = db.collection('users').doc(uid);
  const snapshot = await docRef.get();

  await docRef.set(
    {
      role: provider.role,
      providerId: provider.providerId,
      email: provider.email,
      fullName: provider.fullName,
      phone: provider.phone,
      isActive: provider.isActive,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!snapshot.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true },
  );

  return {
    existed: snapshot.exists,
  };
}

async function main() {
  initializeFirebase();

  const authUser = await upsertAuthUser();
  const profile = await upsertProviderProfile(authUser.uid);

  console.log('Firebase provider test account ready.');
  console.log({
    authUser: authUser.created ? 'created' : 'reused',
    firestoreProfile: profile.existed ? 'updated' : 'created',
    uid: authUser.uid,
    collection: 'users',
    documentId: authUser.uid,
    email: provider.email,
    providerId: provider.providerId,
    role: provider.role,
  });
}

main().catch((error) => {
  console.error('Failed to seed Firebase provider test account.');
  console.error(error);
  process.exit(1);
});
