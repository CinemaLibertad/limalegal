"use client";

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import GoogleDriveStorageCard from "@/components/settings/GoogleDriveStorageCard";
import OneDriveStorageCard from "@/components/settings/OneDriveStorageCard";
import { getClientAuth } from "@/lib/firebase/client";
import { listTeamMembers, saveTeamMember, type AuthorizedMember } from "@/lib/settings/team.repository";
import { createMobileEnrollment, listMobileAssignments, type MobileAssignment, type MobileEnrollmentQr } from "@/lib/settings/mobile.repository";

const settingsKey = (uid: string, section: string) => `lima-legal:workspace-settings:${uid}:${section}`;

const sections = [
  ["identity", "Identidad del estudio"],
  ["professionals", "Profesionales y matrículas"],
  ["team", "Equipo y permisos"],
  ["documents", "Documentos y membretes"],
  ["storage", "Almacenamiento e integraciones"],
  ["devices", "App móvil y dispositivos"],
  ["appearance", "Apariencia y accesibilidad"],
  ["security", "Seguridad y auditoría"],
] as const;

function Field({ label, type = "text", wide = false, placeholder, required = false }: { label: string; type?: InputHTMLAttributes<HTMLInputElement>["type"]; wide?: boolean; placeholder?: string; required?: boolean }) {
  return <label className={`settings-field${wide ? " is-wide" : ""}`}>
    <span>{label}</span>
    <input name={label} type={type} placeholder={placeholder ?? ""} required={required} />
  </label>;
}

function TextField({ label, wide = false }: { label: string; wide?: boolean }) {
  return <label className={`settings-field${wide ? " is-wide" : ""}`}>
    <span>{label}</span>
    <textarea name={label} rows={3} />
  </label>;
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="settings-form-card">
    <header><h2>{title}</h2>{description && <p>{description}</p>}</header>
    {children}
  </section>;
}

function IdentitySection() {
  return <div className="settings-card-grid">
    <Card title="Información institucional del despacho" description="Datos registrales, domicilio y presentación del estudio.">
      <div className="settings-fields-grid">
        <Field label="Nombre comercial" wide />
        <Field label="Razón social" />
        <Field label="CUIT / identificación tributaria" />
        <Field label="Domicilio del estudio" wide />
        <Field label="Localidad" />
        <Field label="Provincia" />
        <Field label="Código postal" />
        <Field label="Teléfono institucional" />
        <Field label="Correo institucional" type="email" />
        <Field label="Sitio web oficial" type="url" />
        <TextField label="Reseña institucional para documentos" wide />
      </div>
    </Card>
    <Card title="Identidad visual" description="Incorporá la identidad que se utilizará en el espacio de trabajo y en documentos.">
      <div className="settings-fields-grid">
        <Field label="Nombre de la persona representante" wide />
        <div className="settings-upload-field settings-field is-wide">
          <span>Logotipo del estudio</span>
          <input type="file" accept="image/png,image/jpeg,image/svg+xml" aria-label="Seleccionar logotipo del estudio" />
          <small>PNG, JPG o SVG. El archivo se incorporará al almacenamiento conectado.</small>
        </div>
      </div>
    </Card>
  </div>;
}

function ProfessionalSection() {
  return <div className="settings-card-grid">
    <Card title="Profesional responsable" description="Datos de identificación profesional y contacto. Los campos están vacíos hasta que se completen.">
      <div className="settings-fields-grid">
        <Field label="Nombre y apellido" />
        <Field label="Correo profesional" type="email" />
        <Field label="Teléfono" />
        <Field label="Domicilio profesional" wide />
      </div>
    </Card>
    <Card title="Matrículas profesionales" description="Agregá las matrículas correspondientes a cada jurisdicción.">
      <div className="settings-fields-grid settings-license-row">
        <Field label="Tipo de matrícula" placeholder="Federal, provincial u otra" />
        <Field label="Colegio / jurisdicción" />
        <Field label="Tomo" />
        <Field label="Folio / número" />
      </div>
      <p className="settings-empty-note">Aún no se cargaron matrículas.</p>
    </Card>
  </div>;
}

function TeamSection({ members, loading }: { members: AuthorizedMember[]; loading: boolean }) {
  return <div className="settings-card-grid">
    <Card title="Personas autorizadas" description="Definí quién puede acceder al espacio de trabajo y qué tareas puede realizar.">
      <div className="settings-fields-grid">
        <Field label="Nombre y apellido" required />
        <Field label="Correo de la cuenta autorizada" type="email" required />
        <label className="settings-field"><span>Función en el estudio</span><select name="Función en el estudio" defaultValue="" required><option value="" disabled>Seleccionar función</option><option>Profesional</option><option>Administración</option><option>Procuración</option><option>Asistencia jurídica</option></select></label>
        <label className="settings-field"><span>Permiso inicial</span><select name="Permiso inicial" defaultValue="" required><option value="" disabled>Seleccionar permiso</option><option>Consulta</option><option>Carga y edición</option><option>Administración</option></select></label>
      </div>
      <p className="settings-empty-note">Completá los datos y elegí “Guardar y agregar” para registrar a la persona.</p>
    </Card>
    <Card title="Personas asignadas" description="Integrantes registrados para este espacio de trabajo.">
      {loading ? <p className="settings-empty-note">Cargando equipo desde Firebase…</p> : members.length === 0 ? <p className="settings-empty-note">Todavía no hay personas asignadas.</p> : <div className="settings-member-list">{members.map((member) => <article className="settings-member-row" key={member.id}>
        <div><strong>{member.name}</strong><span>{member.email}</span></div>
        <div className="settings-member-permissions"><span>{member.role}</span><span>{member.permission}</span></div>
      </article>)}</div>}
      <p className="settings-member-footnote">Integrantes guardados en Firebase para este espacio de trabajo.</p>
    </Card>
  </div>;
}

function DocumentsSection() {
  return <div className="settings-card-grid">
    <Card title="Membrete y presentación" description="Datos que podrán incorporarse a escritos y documentos del estudio.">
      <div className="settings-fields-grid">
        <Field label="Nombre que aparecerá en el membrete" wide />
        <Field label="Domicilio para documentos" wide />
        <Field label="Teléfono de contacto" />
        <Field label="Correo de contacto" type="email" />
        <Field label="Sitio web" type="url" />
        <Field label="Formato de página" placeholder="A4 u otro" />
        <Field label="Márgenes" placeholder="Medida en centímetros" />
        <Field label="Tipografía" />
      </div>
    </Card>
    <Card title="Vista previa" description="La vista se completará con los datos institucionales ingresados.">
      <div className="settings-document-preview" aria-label="Vista previa vacía del membrete">
        <span>Vista previa del documento</span>
      </div>
    </Card>
  </div>;
}

function DevicesSection({ members, assignments, enrollmentQr, loading }: { members: AuthorizedMember[]; assignments: MobileAssignment[]; enrollmentQr: MobileEnrollmentQr | null; loading: boolean }) {
  return <div className="settings-card-grid">
    <Card title="Vinculación de la aplicación móvil" description="Cada persona del estudio tendrá su propia vinculación para registrar actividad desde el teléfono.">
      <div className="settings-fields-grid">
        <label className="settings-field is-wide"><span>Integrante previamente agregado al equipo</span><select name="Integrante de la aplicación móvil" defaultValue="" required disabled={members.length === 0}><option value="" disabled>Seleccionar persona del equipo</option>{members.map((member) => <option key={member.id} value={member.email}>{member.name} · {member.email}</option>)}</select></label>
        <label className="settings-field is-wide"><span>Permiso de la aplicación</span><select name="Permiso de la aplicación móvil" defaultValue="Consulta" required><option>Consulta</option><option>Carga de actividad</option></select></label>
      </div>
      <p className="settings-empty-note">Al generar el QR, la persona lo escanea y después inicia sesión con Google. Solo se activa si su correo coincide con el integrante seleccionado.</p>
      {members.length === 0 && <p className="settings-empty-note">Primero agregá y guardá a la persona en “Equipo y permisos”.</p>}
    </Card>
    <Card title="Accesos y dispositivos" description="Asignaciones móviles de integrantes del estudio y sus dispositivos activos.">
      {enrollmentQr && <div className="settings-mobile-qr"><img src={enrollmentQr.qrDataUrl} alt={`QR de vinculación para ${enrollmentQr.email}`} /><div><strong>QR listo para escanear</strong><span>{enrollmentQr.email}</span><span>Permiso: {enrollmentQr.permission}</span><span>ID de aplicación: {enrollmentQr.appId}</span><small>Vence a las {new Date(enrollmentQr.expiresAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}. Es de un solo uso.</small></div></div>}
      {loading ? <p className="settings-empty-note">Cargando accesos desde Firebase…</p> : assignments.length === 0 ? <p className="settings-empty-note">Todavía no hay integrantes habilitados para la aplicación.</p> : <div className="settings-member-list">{assignments.map((assignment) => <article className="settings-member-row" key={assignment.memberId}>
        <div><strong>{assignment.name}</strong><span>{assignment.email}</span><span>ID de aplicación: {assignment.appId}</span></div>
        <div className="settings-member-permissions"><span>{assignment.permission}</span><span>{assignment.devices.length ? `${assignment.devices.length} dispositivo(s) vinculado(s)` : "QR generado; esperando vinculación"}</span>{assignment.devices.map((device) => <small key={device.id}>{device.name}</small>)}</div>
      </article>)}</div>}
    </Card>
  </div>;
}

function AppearanceSection() {
  return <div className="settings-card-grid">
    <Card title="Preferencias visuales" description="Opciones para adaptar la lectura y el uso del panel.">
      <fieldset className="settings-choice-group"><legend>Tema de interfaz</legend>
        <label><input type="radio" name="theme" value="light" /> Claro</label>
        <label><input type="radio" name="theme" value="dark" /> Oscuro</label>
        <label><input type="radio" name="theme" value="system" /> Según el dispositivo</label>
      </fieldset>
      <label className="settings-field"><span>Tamaño del texto</span><select name="Tamaño del texto" defaultValue=""><option value="" disabled>Elegir tamaño</option><option>Pequeño</option><option>Estándar</option><option>Grande</option><option>Muy grande</option></select></label>
      <label className="settings-check"><input name="Alto contraste" type="checkbox" /> Alto contraste</label>
      <label className="settings-check"><input name="Reducir animaciones" type="checkbox" /> Reducir animaciones</label>
      <label className="settings-check"><input name="Resaltar el foco del teclado" type="checkbox" /> Resaltar el foco del teclado</label>
    </Card>
  </div>;
}

function SecuritySection() {
  return <div className="settings-card-grid">
    <Card title="Sesión y acceso" description="Opciones de protección del acceso al panel.">
      <label className="settings-field"><span>Cierre automático por inactividad</span><select name="Cierre automático por inactividad" defaultValue=""><option value="" disabled>Seleccionar duración</option><option>15 minutos</option><option>30 minutos</option><option>1 hora</option></select></label>
    </Card>
    <Card title="Registro de actividad" description="Los cambios de configuración y accesos se presentarán cuando el registro esté integrado.">
      <p className="settings-empty-note">No hay actividad para mostrar.</p>
    </Card>
  </div>;
}

function StorageSection() {
  return <div className="settings-card-grid settings-storage-grid">
    <div className="settings-storage-intro"><h2>Almacenamiento en la nube</h2><p>Conectá la cuenta donde querés guardar los documentos y escaneos del estudio.</p></div>
    <GoogleDriveStorageCard />
    <OneDriveStorageCard />
  </div>;
}

type WorkspaceSectionProps = { members: AuthorizedMember[]; loading: boolean; assignments: MobileAssignment[]; enrollmentQr: MobileEnrollmentQr | null };

const content: Record<string, (props: WorkspaceSectionProps) => ReactNode> = {
  identity: IdentitySection,
  professionals: ProfessionalSection,
  team: TeamSection,
  documents: DocumentsSection,
  storage: StorageSection,
  devices: DevicesSection,
  appearance: AppearanceSection,
  security: SecuritySection,
};

export default function WorkspaceSettings() {
  const [active, setActive] = useState<string>("identity");
  const [saveMessage, setSaveMessage] = useState("");
  const [members, setMembers] = useState<AuthorizedMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [mobileAssignments, setMobileAssignments] = useState<MobileAssignment[]>([]);
  const [mobileLoading, setMobileLoading] = useState(false);
  const [mobileEnrollmentQr, setMobileEnrollmentQr] = useState<MobileEnrollmentQr | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ActiveSection = content[active];
  useEffect(() => {
    setSaveMessage("");
    const uid = getClientAuth().currentUser?.uid;
    if (!uid) return;
    if (active === "team" || active === "devices") {
      formRef.current?.reset();
      setTeamLoading(true);
      if (active === "devices") {
        setMobileLoading(true);
        setMobileEnrollmentQr(null);
        void Promise.all([listTeamMembers(), listMobileAssignments()])
          .then(([team, linked]) => { setMembers(team); setMobileAssignments(linked); })
          .catch(() => setSaveMessage("No se pudo cargar el equipo o los accesos móviles de Firebase."))
          .finally(() => { setTeamLoading(false); setMobileLoading(false); });
      } else {
        void listTeamMembers()
          .then(setMembers)
          .catch(() => setSaveMessage("No se pudo leer el equipo de Firebase. Revisá el acceso del usuario y las reglas de Firestore."))
          .finally(() => setTeamLoading(false));
      }
      return;
    }
    const saved = localStorage.getItem(settingsKey(uid, active));
    if (!saved || !formRef.current) return;
    const values = JSON.parse(saved) as Record<string, string | boolean>;
    formRef.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "file") return;
      const value = values[control.name];
      if (value === undefined) return;
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
        control.checked = control.type === "checkbox" ? value === true : value === control.value;
      } else if (typeof value === "string") {
        control.value = value;
      }
    });
  }, [active]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const uid = getClientAuth().currentUser?.uid;
    if (!uid) {
      setSaveMessage("Iniciá sesión nuevamente para guardar los cambios.");
      return;
    }
    if (active === "team") {
      const formData = new FormData(form);
      const name = String(formData.get("Nombre y apellido") ?? "").trim();
      const email = String(formData.get("Correo de la cuenta autorizada") ?? "").trim().toLowerCase();
      const role = String(formData.get("Función en el estudio") ?? "");
      const permission = String(formData.get("Permiso inicial") ?? "");
      if (!name || !email || !role || !permission) {
        setSaveMessage("Completá nombre, correo, función y permiso.");
        return;
      }
      const user = getClientAuth().currentUser;
      if (!user?.email) {
        setSaveMessage("No se pudo identificar la cuenta que administra este estudio.");
        return;
      }
      try {
        await saveTeamMember({ name, email, role, permission }, { uid, email: user.email });
        setMembers(await listTeamMembers());
        form.reset();
        setSaveMessage("Persona guardada en Firebase y agregada al equipo.");
      } catch {
        setSaveMessage("No se pudo guardar en Firebase. Revisá las reglas de Firestore y los permisos del estudio.");
      }
      return;
    }
    if (active === "devices") {
      const email = String(new FormData(form).get("Integrante de la aplicación móvil") ?? "").trim().toLowerCase();
      const permission = String(new FormData(form).get("Permiso de la aplicación móvil") ?? "");
      if (!email) {
        setSaveMessage("Primero agregá a la persona al equipo y luego seleccionala aquí.");
        return;
      }
      try {
        const enrollment = await createMobileEnrollment(email, permission);
        setMobileEnrollmentQr(enrollment);
        setMobileAssignments(await listMobileAssignments());
        setSaveMessage("Acceso móvil asignado en Firebase. El QR vence en 10 minutos y se usa una sola vez.");
      } catch (reason) {
        const code = (reason as { code?: string })?.code;
        setSaveMessage(code === "functions/failed-precondition" ? "La persona debe estar guardada primero en Equipo y permisos." : "No se pudo asignar el acceso móvil. Revisá la sesión y los permisos del estudio.");
      }
      return;
    }
    const values: Record<string, string | boolean> = {};
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]").forEach((control) => {
      if (control instanceof HTMLInputElement && control.type === "file") return;
      if (control instanceof HTMLInputElement && control.type === "radio") {
        if (control.checked) values[control.name] = control.value;
      } else if (control instanceof HTMLInputElement && control.type === "checkbox") {
        values[control.name] = control.checked;
      } else {
        values[control.name] = control.value;
      }
    });
    const storageKey = settingsKey(uid, active);
    const existing = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, string | boolean>;
    if (active === "identity") {
      const logoInput = form.querySelector<HTMLInputElement>('input[type="file"]');
      const file = logoInput?.files?.[0];
      if (file && file.size > 1024 * 1024) {
        setSaveMessage("El logotipo debe pesar menos de 1 MB.");
        return;
      }
      if (file) {
        let logoDataUrl: string;
        try {
          logoDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("No se pudo leer el logotipo."));
            reader.readAsDataURL(file);
          });
        } catch {
          setSaveMessage("No se pudo cargar el logotipo seleccionado.");
          return;
        }
        values.logoDataUrl = logoDataUrl;
      } else if (existing.logoDataUrl) {
        values.logoDataUrl = existing.logoDataUrl;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(values));
    setSaveMessage("Cambios guardados para esta cuenta en este navegador.");
  }

  return <>
    <header className="domain-heading settings-page-heading">
      <div><span className="agenda-eyebrow">ESPACIO DE TRABAJO</span><h1>Configuración del espacio de trabajo</h1><p>Identidad del estudio, profesionales, documentos, accesos y preferencias.</p></div>
    </header>
    <nav className="settings-section-nav" aria-label="Secciones de configuración">
      {sections.map(([id, label]) => <button key={id} type="button" className={active === id ? "is-active" : ""} onClick={() => setActive(id)} aria-current={active === id ? "page" : undefined}>
        <span>{label}</span>
      </button>)}
    </nav>
    <form className="settings-active-panel" key={active} ref={formRef} onSubmit={saveSettings}>
      <ActiveSection members={members} loading={active === "devices" ? mobileLoading : teamLoading} assignments={mobileAssignments} enrollmentQr={mobileEnrollmentQr} />
      <div className="settings-save-bar"><p role="status" aria-live="polite">{saveMessage}</p><button type="submit">{active === "team" ? "Guardar y agregar" : active === "devices" ? "Asignar y generar QR" : "Guardar cambios"}</button></div>
    </form>
  </>;
}
