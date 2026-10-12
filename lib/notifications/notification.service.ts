import type { Activity } from "../activities/activity.model";
import type { NotificationCategory, NotificationKind, NotificationSeverity } from "./notification.model";

const activityTypeLabel: Record<Activity["type"], string> = {
  audiencia: "Audiencia", vencimiento: "Vencimiento", reunion: "Reunión", tarea: "Tarea",
  recordatorio: "Recordatorio", nota: "Nota", otro: "Actividad",
};

export function describeActivityNotification(
  activity: Pick<Activity, "id" | "type" | "title" | "description" | "startAt" | "timeZone" | "priority" | "status">,
  kind: NotificationKind,
): { title: string; message: string; severity: NotificationSeverity; href: string; category: NotificationCategory } {
  const when = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "full",
    ...(activity.startAt ? { timeStyle: "short" as const } : {}),
    timeZone: activity.timeZone || "America/Argentina/Buenos_Aires",
  }).format(new Date(activity.startAt));
  const label = activityTypeLabel[activity.type];
  const title = kind === "created"
    ? `${label} registrada: ${activity.title}`
    : kind === "rescheduled"
      ? `${label} reprogramada: ${activity.title}`
      : `${label}: ${activity.title} · ${activity.status}`;
  const message = activity.type === "recordatorio" && kind === "created"
    ? `${activity.description ? `${activity.description} · ` : ""}Recordatorio programado para ${when}.`
    : kind === "rescheduled"
    ? `La fecha registrada ahora es ${when}. Abrí la actividad para consultar sus antecedentes.`
    : kind === "status_changed"
      ? `El estado se actualizó a «${activity.status}». La fecha asociada es ${when}.`
      : `Fecha registrada: ${when}. El sistema no calcula plazos jurídicos.`;
  const severity: NotificationSeverity = activity.priority === "urgente"
    ? "urgente"
    : activity.priority === "importante" || activity.type === "vencimiento"
      ? "importante"
      : "informativa";
  const category: NotificationCategory = activity.type === "recordatorio" ? "personalizada" : activity.type === "tarea" ? "tarea" : activity.type === "vencimiento" ? "vencimiento" : "agenda";
  return { title, message, severity, href: `/panel/agenda?activityId=${encodeURIComponent(activity.id)}`, category };
}
