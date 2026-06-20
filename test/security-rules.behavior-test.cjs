const fs = require('node:fs');
const path = require('node:path');

const projectId = process.env.FIREBASE_TEST_PROJECT_ID || 'fixzone-rules-test';
const rulesPath = path.resolve(__dirname, '..', 'firestore.rules');

async function main() {
  if (!fs.existsSync(path.resolve(__dirname, '..', 'firebase.json'))) {
    throw new Error('firebase.json is required for emulator-backed security rules tests.');
  }

  if (!fs.existsSync(rulesPath)) {
    throw new Error('firestore.rules is required for emulator-backed security rules tests.');
  }

  let rulesTest;
  try {
    rulesTest = require('@firebase/rules-unit-testing');
  } catch (error) {
    throw new Error('Missing @firebase/rules-unit-testing dependency.');
  }

  const { initializeTestEnvironment, assertFails, assertSucceeds } = rulesTest;
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(rulesPath, 'utf8'),
    },
  });

  try {
    await testEnv.clearFirestore();

    const unauthenticated = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthenticated.collection('reports').doc('blocked').get());

    const authenticated = testEnv.authenticatedContext('user-1', {
      role: 'CUSTOMER',
      orgId: 'org-1',
    }).firestore();
    await assertSucceeds(authenticated.collection('users').doc('user-1').get());
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
