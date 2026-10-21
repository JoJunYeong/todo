import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  browserLocalPersistence,
  setPersistence,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import config from "./firebase-config.json";
import { authEmail } from "./domain.js";

export const app = initializeApp(config);
export const auth = getAuth(app);
const persistence = setPersistence(auth, browserLocalPersistence);
export const watchAuth = (fn) => onAuthStateChanged(auth, fn);
export async function login(username, password) {
  await persistence;
  return signInWithEmailAndPassword(auth, authEmail(username), password);
}
export async function register(username, password, displayName) {
  if (password.length < 8) throw Error("비밀번호는 8자 이상 입력해 주세요.");
  await persistence;
  const { user } = await createUserWithEmailAndPassword(
    auth,
    authEmail(username),
    password,
  );
  await updateProfile(user, {
    displayName: displayName.trim() || username.trim(),
  });
  const store = await import("./store.js");
  await store.ensureProfile(user);
  await store.updateUser(user.uid, {
    displayName: displayName.trim() || username.trim(),
  });
  return user;
}
export const logout = () => signOut(auth);
export async function changePassword(current, next) {
  if (next.length < 8) throw Error("새 비밀번호는 8자 이상 입력해 주세요.");
  const user = auth.currentUser;
  if (!user) throw Error("다시 로그인해 주세요.");
  await reauthenticateWithCredential(
    user,
    EmailAuthProvider.credential(user.email, current),
  );
  await updatePassword(user, next);
}
export function authMessage(error) {
  const code = error?.code || "";
  return (
    {
      "auth/invalid-credential": "아이디 또는 비밀번호를 확인해 주세요.",
      "auth/user-not-found": "아이디 또는 비밀번호를 확인해 주세요.",
      "auth/wrong-password": "아이디 또는 비밀번호를 확인해 주세요.",
      "auth/email-already-in-use": "이미 사용 중인 아이디입니다.",
      "auth/too-many-requests": "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
      "auth/weak-password": "더 긴 비밀번호를 사용해 주세요.",
      "permission-denied":
        "이 계정에서는 접근할 수 없습니다. 관리자에게 사용 상태를 확인해 주세요.",
    }[code] ||
    error?.message ||
    "잠시 후 다시 시도해 주세요."
  );
}
