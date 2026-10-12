"use client";

import { useEffect, useState } from "react";
import { getClientAuth } from "@/lib/firebase/client";

type SavedSettings = Record<string, string | boolean>;
type StudioIdentity = {
  logo?: string;
  name?: string;
  legalName?: string;
  taxId?: string;
  representative?: string;
  professional?: string;
  license?: string;
  address?: string;
  phone?: string;
  email?: string;
};

function readSettings(uid: string, section: string): SavedSettings {
  try {
    return JSON.parse(localStorage.getItem(`lima-legal:workspace-settings:${uid}:${section}`) ?? "{}");
  } catch {
    return {};
  }
}

export function PanelWelcome() {
  const [identity, setIdentity] = useState<StudioIdentity>({});

  useEffect(() => {
    const user = getClientAuth().currentUser;
    if (!user) return;
    const studio = readSettings(user.uid, "identity");
    const professional = readSettings(user.uid, "professionals");
    const licenseParts = [professional["Tipo de matrícula"], professional["Colegio / jurisdicción"], professional.Tomo, professional["Folio / número"]]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);

    setIdentity({
      logo: typeof studio.logoDataUrl === "string" ? studio.logoDataUrl : undefined,
      name: typeof studio["Nombre comercial"] === "string" ? studio["Nombre comercial"] : undefined,
      legalName: typeof studio["Razón social"] === "string" ? studio["Razón social"] : undefined,
      taxId: typeof studio["CUIT / identificación tributaria"] === "string" ? studio["CUIT / identificación tributaria"] : undefined,
      representative: typeof studio["Nombre de la persona representante"] === "string" ? studio["Nombre de la persona representante"] : undefined,
      professional: typeof professional["Nombre y apellido"] === "string" ? professional["Nombre y apellido"] : undefined,
      license: licenseParts.join(" · ") || undefined,
      address: typeof studio["Domicilio del estudio"] === "string" ? studio["Domicilio del estudio"] : undefined,
      phone: typeof studio["Teléfono institucional"] === "string" ? studio["Teléfono institucional"] : undefined,
      email: typeof studio["Correo institucional"] === "string" ? studio["Correo institucional"] : user.email || undefined,
    });
  }, []);

  const details = [
    identity.legalName,
    identity.taxId && `CUIT: ${identity.taxId}`,
    (identity.professional || identity.representative) && `Responsable: ${identity.professional || identity.representative}`,
    identity.license && `Matrícula: ${identity.license}`,
    identity.address,
    identity.phone,
    identity.email,
  ].filter((value): value is string => Boolean(value));

  return <>
    <div className="panel-welcome-studio-logo">
      {identity.logo ? <img src={identity.logo} alt={`Logotipo de ${identity.name || "el estudio"}`} /> : <span>Logo del estudio</span>}
    </div>
    <div className="panel-welcome-details">
      <span className="live-dot">ESPACIO DE TRABAJO</span>
      <h1>Bienvenido a Lima Legal</h1>
      <h2>{identity.name || "Configurá la identidad de tu estudio"}</h2>
      {details.length > 0
        ? <ul>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
        : <p>Completá los datos del estudio, responsable y matrícula en Configuración para mostrarlos aquí.</p>}
    </div>
  </>;
}
