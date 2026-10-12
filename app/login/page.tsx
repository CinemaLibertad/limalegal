"use client";

import Image from "next/image";
import { signInWithPopup } from "firebase/auth";
import { useState } from "react";
import { createGoogleProvider, getClientAuth } from "../../lib/firebase/client";

export default function LoginPage() {
  const [error, setError] = useState("");
  const login = async () => {
    setError("");
    try { await signInWithPopup(getClientAuth(), createGoogleProvider()); window.location.assign("/panel"); }
    catch { setError("No se pudo completar el acceso. Verificá la cuenta autorizada."); }
  };

  return <main className="login-page"><div className="login-card"><div className="login-brand"><Image src="/images/brand/lima-legal-icon.png" alt="Lima Legal" width={74} height={74} priority /><strong>LIMA LEGAL</strong><small>GESTIÓN E INVESTIGACIÓN JURÍDICA</small></div><p className="eyebrow dark">ACCESO A LA PLATAFORMA</p><h1>Tu espacio de trabajo</h1><p>Ingresá para continuar con la gestión e investigación jurídica de tu estudio.</p><button className="google-button" onClick={login}><span>G</span> Continuar con Google</button>{error && <p className="login-error">{error}</p>}<a href="/">Volver al sitio público</a></div></main>;
}
