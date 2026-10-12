"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getClientAuth } from "../../lib/firebase/client";
import { listCases, listClients } from "../../lib/firebase/domain-repositories";
import { archiveNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from "../../lib/notifications/notification.repository";
import type { NotificationCategory, StudioNotification } from "../../lib/notifications/notification.model";
import type { LegalCase } from "../../lib/cases/case.model";
import type { Client } from "../../lib/clients/client.model";
import { saveActivity } from "../../lib/firebase/domain-repositories";
import type { ActivityInput } from "../../lib/activities/activity.model";

type Filter = "todas" | "no_leidas" | "urgentes" | NotificationCategory | "archivadas";
const filterOptions: Array<{ value: Filter; label: string }> = [
  { value: "todas", label: "Todas" }, { value: "no_leidas", label: "No leídas" }, { value: "urgentes", label: "Urgentes" },
  { value: "tarea", label: "Tareas" }, { value: "vencimiento", label: "Vencimientos" }, { value: "agenda", label: "Agenda" }, { value: "personalizada", label: "Personalizadas" }, { value: "archivadas", label: "Archivadas" },
];
const categoryLabel: Record<NotificationCategory, string> = { tarea: "Tarea", vencimiento: "Vencimiento", agenda: "Agenda", personalizada: "Alerta personalizada" };
const categoryIcon: Record<NotificationCategory, string> = { tarea: "✓", vencimiento: "◷", agenda: "▦", personalizada: "✎" };
const localDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

export function NotificationsWorkspace() {
  const router = useRouter();
  const [items, setItems] = useState<StudioNotification[]>([]);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("todos");
  const [selected, setSelected] = useState<StudioNotification | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [customAt, setCustomAt] = useState("");
  const [customPriority, setCustomPriority] = useState<ActivityInput["priority"]>("normal");
  const [customCaseId, setCustomCaseId] = useState("");
  const [customClientId, setCustomClientId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [notifications, caseRows, clientRows] = await Promise.all([listNotifications(), listCases(), listClients()]);
      setItems(notifications); setCases(caseRows); setClients(clientRows); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron consultar las notificaciones."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const unreadCount = items.filter((item) => !item.readAt && !item.archivedAt).length;
  const urgentCount = items.filter((item) => item.severity === "urgente" && !item.archivedAt).length;
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    const today = localDay(new Date().toISOString());
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() - 7);
    return items.filter((item) => {
      if (filter === "archivadas" ? !item.archivedAt : Boolean(item.archivedAt)) return false;
      if (filter === "no_leidas" && item.readAt) return false;
      if (filter === "urgentes" && item.severity !== "urgente") return false;
      if (["tarea", "vencimiento", "agenda", "personalizada"].includes(filter) && item.category !== filter) return false;
      if (period === "hoy" && localDay(item.createdAt) !== today) return false;
      if (period === "7dias" && new Date(item.createdAt) < weekEnd) return false;
      if (needle && [item.title, item.message, item.category ?? "", ...(item.caseIds ?? []), ...(item.clientIds ?? [])].join(" ").toLocaleLowerCase("es-AR").includes(needle) === false) return false;
      return true;
    });
  }, [items, filter, search, period]);

  async function markRead(item: StudioNotification) {
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    setBusyId(item.id);
    try { await markNotificationRead(item.id, user); setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)); setSelected((current) => current?.id === item.id ? { ...current, readAt: new Date().toISOString() } : current); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo marcar como leída."); }
    finally { setBusyId(""); }
  }

  async function openOrigin(item: StudioNotification) {
    if (!item.readAt) await markRead(item);
    setSelected(null);
    router.push(item.href);
  }

  async function archive(item: StudioNotification) {
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    setBusyId(item.id);
    try { await archiveNotification(item.id, user); const archivedAt = new Date().toISOString(); setItems((current) => current.map((row) => row.id === item.id ? { ...row, archivedAt } : row)); if (selected?.id === item.id) setSelected(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo archivar la notificación."); }
    finally { setBusyId(""); }
  }

  async function markAllRead() {
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    setBusy(true);
    try { await markAllNotificationsRead(user); const readAt = new Date().toISOString(); setItems((current) => current.map((item) => !item.archivedAt ? { ...item, readAt: item.readAt ?? readAt } : item)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudieron actualizar las notificaciones."); }
    finally { setBusy(false); }
  }

  async function createCustomReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    if (!customAt || new Date(customAt).getTime() <= Date.now()) { setError("Elegí una fecha y hora futura para el recordatorio."); return; }
    setBusy(true); setError("");
    const linkedCase = cases.find((item) => item.id === customCaseId);
    const linkedClient = clients.find((item) => item.id === customClientId);
    const activity: ActivityInput = {
      type: "recordatorio", title: customTitle.trim(), description: customMessage.trim(), notes: "Recordatorio personal creado desde el Centro de Notificaciones.",
      startAt: new Date(customAt).toISOString(), endAt: null, timeZone: "America/Argentina/Buenos_Aires", allDay: false,
      isHighlighted: customPriority === "urgente", priority: customPriority, status: "pendiente",
      caseIds: customCaseId ? [customCaseId as ActivityInput["caseIds"][number]] : [], clientIds: customClientId ? [customClientId as ActivityInput["clientIds"][number]] : [],
      jurisdiction: "", branch: "", location: "", organization: "", meetingUrl: "", references: [], attachments: [],
      remindersMinutes: [0], recurrence: null, dateVerification: "no_aplica",
    };
    try {
      const id = await saveActivity(activity, user, undefined, "Recordatorio personal independiente de plazos y audiencias.");
      setCustomTitle(""); setCustomMessage(""); setCustomAt(""); setCustomPriority("normal"); setCustomCaseId(""); setCustomClientId(""); setShowCustomForm(false);
      await refresh();
      setItems((rows) => rows.map((row) => row.source.id === id ? { ...row, category: "personalizada" } : row));
      setFilter("personalizada");
      if (linkedCase || linkedClient) setSearch("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo crear el recordatorio personalizado."); }
    finally { setBusy(false); }
  }

  function contextLabel(item: StudioNotification): string {
    const names = [
      ...(item.caseIds ?? []).map((id) => cases.find((row) => row.id === id)?.caption).filter((value): value is string => Boolean(value)),
      ...(item.clientIds ?? []).map((id) => clients.find((row) => row.id === id)?.displayName).filter((value): value is string => Boolean(value)),
    ];
    return names.length ? names.join(" · ") : "Actividad del estudio";
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, StudioNotification[]>();
    visible.forEach((item) => {
      const key = item.createdAt ? localDay(item.createdAt) : "sin-fecha";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()];
  }, [visible]);
  const headingForDay = (key: string) => key === "sin-fecha" ? "Fecha no disponible" : key === localDay(new Date().toISOString()) ? `Hoy — ${new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date())}` : new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${key}T12:00:00-03:00`));

  return <main className="panel-main notifications-main">
    <div className="breadcrumbs">Inicio / Sistema / <b>Centro de notificaciones</b></div>
    <header className="notification-page-heading"><div><span className="agenda-eyebrow">BANDEJA DE EVENTOS DEL ESTUDIO</span><h1>Centro de Notificaciones {unreadCount > 0 && <span className="notification-unread-pill">{unreadCount} sin leer</span>}</h1><p>Avisos de actividad con origen identificable y acceso directo al registro relacionado.</p></div><div className="notification-heading-actions"><button className="agenda-button primary" onClick={() => setShowCustomForm((open) => !open)}>＋ Crear alerta personalizada</button><button className="agenda-button secondary" disabled={busy || unreadCount === 0} onClick={() => void markAllRead()}>{busy ? "Actualizando…" : "Marcar todas como leídas"}</button></div></header>
    {showCustomForm && <form className="notification-custom-form" onSubmit={(event) => void createCustomReminder(event)}><div><span className="agenda-eyebrow">RECORDATORIO PERSONAL</span><h2>Programar una alerta independiente</h2><p>No crea ni modifica vencimientos o audiencias. Se registra como actividad única y queda vinculada al expediente o cliente elegido.</p></div><label>Título<input required maxLength={120} value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Ej.: Llamar al cliente" /></label><label>Fecha y hora<input required type="datetime-local" value={customAt} onChange={(event) => setCustomAt(event.target.value)} /></label><label>Detalle opcional<textarea maxLength={1000} value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} placeholder="Qué necesitás recordar…" /></label><label>Prioridad<select value={customPriority} onChange={(event) => setCustomPriority(event.target.value as ActivityInput["priority"])}><option value="normal">Normal</option><option value="importante">Importante</option><option value="urgente">Urgente</option></select></label><label>Expediente opcional<select value={customCaseId} onChange={(event) => setCustomCaseId(event.target.value)}><option value="">Sin expediente</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.caption}</option>)}</select></label><label>Cliente opcional<select value={customClientId} onChange={(event) => setCustomClientId(event.target.value)}><option value="">Sin cliente</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><div className="notification-custom-actions"><small>Se mostrará en este centro y en Agenda. El envío push quedará disponible al vincular la aplicación y el dispositivo.</small><button className="agenda-button secondary" type="button" onClick={() => setShowCustomForm(false)}>Cancelar</button><button className="agenda-button primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar recordatorio"}</button></div></form>}
    {error && <p className="agenda-error" role="alert">{error}<button onClick={() => void refresh()}>Reintentar</button></p>}
    <section className="notification-toolbar"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar avisos, expedientes o clientes" aria-label="Buscar notificaciones"/><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Período"><option value="todos">Todo el período</option><option value="hoy">Hoy</option><option value="7dias">Últimos siete días</option></select><span className="notification-result-count">{loading ? "Consultando…" : `${visible.length} avisos`}</span></section>
    <nav className="notification-filter-bar" aria-label="Filtrar avisos">{filterOptions.map((option) => <button key={option.value} className={filter === option.value ? "selected" : ""} onClick={() => setFilter(option.value)}>{option.label}{option.value === "no_leidas" && unreadCount > 0 ? <span>{unreadCount}</span> : option.value === "urgentes" && urgentCount > 0 ? <span>{urgentCount}</span> : null}</button>)}</nav>
    <div className="notification-content-grid"><section className="notification-feed" aria-live="polite">{loading ? <div className="notification-empty">Consultando avisos registrados…</div> : grouped.length === 0 ? <div className="notification-empty"><strong>{items.length ? "No hay avisos que coincidan" : "Todavía no hay notificaciones"}</strong><span>Esta bandeja muestra eventos creados por los módulos que ya están conectados.</span></div> : grouped.map(([day, group]) => <section key={day}><h2 className="notification-date-heading"><span>{headingForDay(day)}</span><small>{group.length} {group.length === 1 ? "aviso" : "avisos"}</small></h2>{group.map((item) => <article key={item.id} className={`notification-card severity-${item.severity}${item.readAt ? " is-read" : " is-unread"}`}><span className="notification-icon" aria-hidden="true">{item.category ? categoryIcon[item.category] : "•"}</span><div className="notification-copy"><div className="notification-title-line"><h3>{item.title}</h3><span className="notification-read-indicator">{item.archivedAt ? "Archivada" : item.readAt ? "Leída" : "No leída"}</span></div><p>{item.message}</p><div className="notification-meta"><span>{item.category ? categoryLabel[item.category] : "Actividad"}</span><span>{contextLabel(item)}</span><span className={`notification-severity severity-text-${item.severity}`}>{item.severity}</span></div><small>{item.createdAt ? new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(item.createdAt)) : "Fecha de registro no disponible"}</small></div><div className="notification-actions"><button className="agenda-button primary" onClick={() => setSelected(item)}>Ver detalle</button><button className="agenda-button secondary" onClick={() => void openOrigin(item)}>Abrir origen →</button>{!item.readAt && !item.archivedAt && <button className="agenda-button secondary" disabled={busyId === item.id} onClick={() => void markRead(item)}>Marcar leída</button>}{!item.archivedAt && <button className="agenda-button secondary" disabled={busyId === item.id} onClick={() => void archive(item)}>Archivar</button>}</div></article>)}</section>)}</section>
      <aside className="notification-side"><section className="notification-side-card"><span className="agenda-eyebrow">ESTADO DE LA BANDEJA</span><h2>Actividad registrada</h2><div className="notification-side-stat"><span>Sin leer</span><strong>{unreadCount}</strong></div><div className="notification-side-stat"><span>Urgentes</span><strong>{urgentCount}</strong></div><div className="notification-side-stat"><span>En la consulta actual</span><strong>{items.filter((item) => !item.archivedAt).length}</strong></div></section><section className="notification-side-card"><span className="agenda-eyebrow">ORIGEN DISPONIBLE</span><h2>Eventos vinculados</h2><p>Actualmente se generan avisos al crear o reprogramar actividades y al cambiar su estado. Cada aviso conserva el ID del registro de origen.</p><p className="notification-source-note">Los recordatorios automáticos por cercanía de fechas y los avisos de documentos, finanzas o consultas requieren sus respectivos procesos de backend. No se muestran como activos en esta etapa.</p></section></aside></div>
    {selected && <div className="agenda-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="agenda-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-detail-title"><header className="agenda-dialog-header"><div><span className="agenda-eyebrow">DETALLE DEL AVISO · {selected.severity.toLocaleUpperCase("es-AR")}</span><h2 id="notification-detail-title">{selected.title}</h2><p>{selected.createdAt ? new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(selected.createdAt)) : "Fecha no disponible"}</p></div><button type="button" className="agenda-icon-button" onClick={() => setSelected(null)} aria-label="Cerrar">×</button></header><div className="agenda-detail-scroll"><dl className="agenda-detail-grid"><dt>Qué ocurrió</dt><dd>{selected.message}</dd><dt>Origen</dt><dd>{selected.category ? categoryLabel[selected.category] : "Actividad del estudio"} · identificador {selected.source.id}</dd><dt>Relacionado con</dt><dd>{contextLabel(selected)}</dd><dt>Fecha de la actividad</dt><dd>{selected.eventAt ? new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(selected.eventAt)) : "No informada"}</dd><dt>Estado de lectura</dt><dd>{selected.readAt ? "Leída" : "No leída"}</dd><dt>Acción disponible</dt><dd>Abrir el registro original para consultar sus datos o continuar su gestión.</dd></dl></div><footer className="agenda-form-actions"><button type="button" className="agenda-button secondary" onClick={() => void archive(selected)} disabled={Boolean(busyId)}>Archivar aviso</button><span className="agenda-action-spacer"/>{!selected.readAt && <button type="button" className="agenda-button secondary" onClick={() => void markRead(selected)} disabled={Boolean(busyId)}>Marcar leída</button>}<button type="button" className="agenda-button primary" onClick={() => void openOrigin(selected)}>Abrir registro de origen →</button></footer></section></div>}
  </main>;
}
