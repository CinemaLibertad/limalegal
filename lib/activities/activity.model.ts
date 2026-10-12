import type { ClientId, CaseId, StudioId, UserId } from "../shared/ids";

export const STUDIO_ID = "lima-legal" as StudioId;
export const ACTIVITY_TYPES = ["audiencia", "vencimiento", "reunion", "tarea", "recordatorio", "nota", "otro"] as const;
export const ACTIVITY_PRIORITIES = ["normal", "importante", "urgente"] as const;
export const ACTIVITY_STATUSES = ["pendiente", "confirmado", "realizado", "postergado", "cancelado"] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type DateVerification = "no_aplica" | "pendiente" | "verificada";
export type ActivityRecurrence = { frequency: "diaria" | "semanal" | "mensual"; interval: number; until: string } | null;
export type ActivityAttachment = { name: string; path: string; contentType: string; size: number };

export type Activity = {
  id: string;
  studioId: StudioId;
  type: ActivityType;
  title: string;
  description: string;
  notes: string;
  startAt: string;
  endAt: string | null;
  timeZone: string;
  allDay: boolean;
  isHighlighted: boolean;
  priority: ActivityPriority;
  status: ActivityStatus;
  caseIds: CaseId[];
  clientIds: ClientId[];
  jurisdiction: string;
  branch: string;
  location: string;
  organization: string;
  meetingUrl: string;
  references: string[];
  attachments: ActivityAttachment[];
  remindersMinutes: number[];
  recurrence: ActivityRecurrence;
  dateVerification: DateVerification;
  createdAt: string;
  updatedAt: string;
  createdBy: UserId;
  updatedBy: UserId;
  deletedAt: string | null;
};

export type ActivityInput = Omit<Activity, "id" | "studioId" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "deletedAt">;

export type ActivityAudit = {
  action: "created" | "updated" | "rescheduled" | "cancelled" | "deleted" | "duplicated";
  actor: UserId;
  at: string;
  previousStartAt?: string | null;
  nextStartAt?: string | null;
  changedFields?: string[];
  reason?: string;
};

export type ActivityActor = { studioId: StudioId; userId: UserId; email: string };
