import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyC9e5wNo9EKX6u9_rgmm4puvrOs3W3jlBU",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "lima-legal.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "lima-legal",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "lima-legal.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "85336537304",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:85336537304:web:b93b09272ba3980f9a3fad",
};

export function getClientAuth() {
  if (typeof window === "undefined") {
    throw new Error("Firebase Authentication solo está disponible en el navegador.");
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export function createGoogleProvider() {
  return new GoogleAuthProvider();
}
