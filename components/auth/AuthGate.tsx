"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getClientAuth } from "../../lib/firebase/client";

const IDLE_TIMEOUT = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES || 30) * 60 * 1000;
const PRO_TEST_EMAIL = "sebastiancharpentier@gmail.com";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clientAuth = getClientAuth();
    const unsubscribe = onAuthStateChanged(clientAuth, (nextUser) => {
      const allowedEmail = process.env.NEXT_PUBLIC_ALLOWED_ADMIN_EMAIL?.trim().toLowerCase();
      const normalizedEmail = nextUser?.email?.trim().toLowerCase();
      const validUser = nextUser && (normalizedEmail === PRO_TEST_EMAIL || !allowedEmail || normalizedEmail === allowedEmail) ? nextUser : null;

      if (nextUser && !validUser) void signOut(clientAuth);
      setUser(validUser);
      setLoading(false);
      if (!validUser) router.replace("/login");
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!user) return;

    const clientAuth = getClientAuth();
    let timer = window.setTimeout(() => void signOut(clientAuth), IDLE_TIMEOUT);
    const resetIdleTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void signOut(clientAuth), IDLE_TIMEOUT);
    };
    const events = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, resetIdleTimer, { passive: true }));

    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [user]);

  if (loading || !user) {
    return <div className="auth-loading">Verificando acceso seguro…</div>;
  }

  return <>{children}</>;
}
