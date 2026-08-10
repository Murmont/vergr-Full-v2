/** DEMO-ONLY firebase/auth shim. Always "signed in" as the demo self user. */
export const DEMO_UID = 'demo-self';
export const DEMO_USER = {
  uid: DEMO_UID,
  email: 'vergenerd@gmail.com',
  displayName: 'You',
  photoURL: null,
  emailVerified: true,
  isAnonymous: false,
  phoneNumber: null,
  providerData: [{ providerId: 'password' }],
  metadata: { creationTime: new Date().toISOString(), lastSignInTime: new Date().toISOString() },
  getIdToken: () => Promise.resolve('demo-token'),
  getIdTokenResult: () => Promise.resolve({ token: 'demo-token', claims: {} }),
  reload: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

const authObj = { currentUser: DEMO_USER, languageCode: 'en', settings: {} };
export function getAuth() { return authObj; }
export function initializeAuth() { return authObj; }
export function connectAuthEmulator() {}
export function setPersistence() { return Promise.resolve(); }
export const browserLocalPersistence = {};
export const browserSessionPersistence = {};
export const indexedDBLocalPersistence = {};
export const inMemoryPersistence = {};

export function onAuthStateChanged(_a, cb) { Promise.resolve().then(() => cb(DEMO_USER)); return () => {}; }
export function onIdTokenChanged(_a, cb) { Promise.resolve().then(() => cb(DEMO_USER)); return () => {}; }
export function beforeAuthStateChanged() { return () => {}; }

const cred = { user: DEMO_USER, providerId: 'password', operationType: 'signIn' };
export function signInWithEmailAndPassword() { return Promise.resolve(cred); }
export function createUserWithEmailAndPassword() { return Promise.resolve(cred); }
export function signInWithPopup() { return Promise.resolve(cred); }
export function signInWithRedirect() { return Promise.resolve(); }
export function getRedirectResult() { return Promise.resolve(null); }
export function signInAnonymously() { return Promise.resolve(cred); }
export function signInWithCredential() { return Promise.resolve(cred); }
export function signInWithCustomToken() { return Promise.resolve(cred); }
export function linkWithCredential() { return Promise.resolve(cred); }
export function reauthenticateWithCredential() { return Promise.resolve(cred); }
export function signOut() { return Promise.resolve(); }
export function updateProfile() { return Promise.resolve(); }
export function updateEmail() { return Promise.resolve(); }
export function updatePassword() { return Promise.resolve(); }
export function sendPasswordResetEmail() { return Promise.resolve(); }
export function sendEmailVerification() { return Promise.resolve(); }
export function deleteUser() { return Promise.resolve(); }
export function fetchSignInMethodsForEmail() { return Promise.resolve([]); }

function providerStub() { return function () { return { addScope() {}, setCustomParameters() {} }; }; }
export const GoogleAuthProvider = providerStub(); GoogleAuthProvider.credential = () => ({});
export const OAuthProvider = function () { return { addScope() {}, setCustomParameters() {}, credential: () => ({}) }; };
OAuthProvider.credential = () => ({});
export const FacebookAuthProvider = providerStub();
export const TwitterAuthProvider = providerStub();
export const GithubAuthProvider = providerStub();
export const EmailAuthProvider = { credential: () => ({}), credentialWithLink: () => ({}) };
export const PhoneAuthProvider = providerStub();
export default { getAuth };
