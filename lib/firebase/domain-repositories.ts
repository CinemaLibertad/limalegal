import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp,
  Timestamp, where,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { firestore } from "./services";
import type { Client, ClientInput } from "../clients/client.model";
import type { LegalCase, LegalCaseInput } from "../cases/case.model";
import type { Activity, ActivityAudit, ActivityInput, ActivityStatus } from "../activities/activity.model";
import { createActivityNotification } from "../notifications/notification.repository";
import type { NotificationKind } from "../notifications/notification.model";
import { STUDIO_ID } from "../activities/activity.model";

const studio = String(STUDIO_ID);
const clients = collection(firestore, "studios", studio, "clients");
const cases = collection(firestore, "studios", studio, "cases");
const activities = collection(firestore, "studios", studio, "activities");
const actor = (user: User) => user.email ?? user.uid;
const iso = (value: unknown): string => value instanceof Timestamp ? value.toDate().toISOString() : "";
const fromClient = (id: string, data: Record<string, unknown>): Client => ({ ...data, id, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), archivedAt: data.archivedAt instanceof Timestamp ? iso(data.archivedAt) : null } as Client);
const fromCase = (id: string, data: Record<string, unknown>): LegalCase => ({ ...data, id, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), archivedAt: data.archivedAt instanceof Timestamp ? iso(data.archivedAt) : null } as LegalCase);
const fromActivity = (id: string, data: Record<string, unknown>): Activity => ({ ...data, id, startAt: iso(data.startAt), endAt: data.endAt instanceof Timestamp ? iso(data.endAt) : null, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), deletedAt: data.deletedAt instanceof Timestamp ? iso(data.deletedAt) : null } as Activity);
const toActivity = (input: ActivityInput) => ({ ...input, startAt: Timestamp.fromDate(new Date(input.startAt)), endAt: input.endAt ? Timestamp.fromDate(new Date(input.endAt)) : null });

export function newActivityId(): string { return doc(activities).id; }

export async function listClients(): Promise<Client[]> {
  const result = await getDocs(query(clients, orderBy("displayName")));
  return result.docs.map((item) => fromClient(item.id, item.data() as Record<string, unknown>)).filter((item) => !item.archivedAt);
}

export async function saveClient(input: ClientInput, user: User, id?: string): Promise<string> {
  const ref = id ? doc(clients, id) : doc(clients);
  await runTransaction(firestore, async (tx) => {
    const old = id ? await tx.get(ref) : null;
    tx.set(ref, { ...input, studioId: studio, createdAt: old?.exists() ? old.data().createdAt : serverTimestamp(), createdBy: old?.exists() ? old.data().createdBy : actor(user), updatedAt: serverTimestamp(), updatedBy: actor(user), archivedAt: null });
  });
  return ref.id;
}

export async function listCases(): Promise<LegalCase[]> {
  const result = await getDocs(query(cases, orderBy("updatedAt", "desc")));
  return result.docs.map((item) => fromCase(item.id, item.data() as Record<string, unknown>)).filter((item) => !item.archivedAt);
}

export async function saveCase(input: LegalCaseInput, user: User, id?: string): Promise<string> {
  const ref = id ? doc(cases, id) : doc(cases);
  const uniqueClientIds = [...new Set(input.clientIds)];
  await runTransaction(firestore, async (tx) => {
    const old = id ? await tx.get(ref) : null;
    const clientRefs = uniqueClientIds.map((clientId) => doc(clients, clientId));
    const linkedClients = await Promise.all(clientRefs.map((clientRef) => tx.get(clientRef)));
    if (linkedClients.some((item) => !item.exists() || item.data().studioId !== studio || item.data().archivedAt)) throw new Error("Uno o más clientes no existen, están archivados o no pertenecen a este estudio.");
    tx.set(ref, { ...input, ...(old?.exists() && old.data().latestCourtObservation ? { latestCourtObservation: old.data().latestCourtObservation } : {}), clientIds: uniqueClientIds, studioId: studio, createdAt: old?.exists() ? old.data().createdAt : serverTimestamp(), createdBy: old?.exists() ? old.data().createdBy : actor(user), updatedAt: serverTimestamp(), updatedBy: actor(user), archivedAt: null });
  });
  return ref.id;
}

export async function listActivities(from: Date, to: Date, includeArchived = false): Promise<Activity[]> {
  const result = await getDocs(query(activities, where("startAt", ">=", Timestamp.fromDate(from)), where("startAt", "<", Timestamp.fromDate(to)), orderBy("startAt")));
  return result.docs.map((item) => fromActivity(item.id, item.data() as Record<string, unknown>)).filter((item) => includeArchived || !item.deletedAt);
}

export async function listTasksAndDeadlines(): Promise<Activity[]> {
  const result = await getDocs(query(activities, where("type", "in", ["tarea", "vencimiento"]), limit(200)));
  return result.docs.map((item) => fromActivity(item.id, item.data() as Record<string, unknown>)).filter((item) => !item.deletedAt).sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export async function listActivityHistory(id: string): Promise<ActivityAudit[]> {
  const result = await getDocs(query(collection(doc(activities, id), "history"), orderBy("at", "desc")));
  return result.docs.map((item) => ({ ...item.data(), at: iso(item.data().at) } as ActivityAudit));
}

export async function getActivity(id: string): Promise<Activity | null> {
  const result = await getDoc(doc(activities, id));
  if (!result.exists() || result.data().studioId !== studio || result.data().deletedAt) return null;
  return fromActivity(result.id, result.data() as Record<string, unknown>);
}

export async function saveActivity(input: ActivityInput, user: User, id?: string, reason = ""): Promise<string> {
  const ref = id ? doc(activities, id) : doc(activities);
  await runTransaction(firestore, async (tx) => {
    const oldSnapshot = id ? await tx.get(ref) : null;
    const oldData = oldSnapshot?.exists() ? oldSnapshot.data() : null;
    const old = oldData ? fromActivity(ref.id, oldData as Record<string, unknown>) : null;
    if (old && (old.studioId !== studio || old.deletedAt)) throw new Error("La actividad no existe o ya fue archivada.");
    const uniqueCaseIds = [...new Set(input.caseIds)];
    const uniqueClientIds = [...new Set(input.clientIds)];
    if (uniqueCaseIds.length !== input.caseIds.length || uniqueClientIds.length !== input.clientIds.length) throw new Error("La actividad contiene relaciones duplicadas.");
    const linkedCases = await Promise.all(uniqueCaseIds.map((caseId) => tx.get(doc(cases, caseId))));
    if (linkedCases.some((item) => !item.exists() || item.data().studioId !== studio || item.data().archivedAt)) throw new Error("Uno o más expedientes no existen, están archivados o pertenecen a otro estudio.");
    const linkedClients = await Promise.all(uniqueClientIds.map((clientId) => tx.get(doc(clients, clientId))));
    if (linkedClients.some((item) => !item.exists() || item.data().studioId !== studio || item.data().archivedAt)) throw new Error("Uno o más clientes no existen, están archivados o pertenecen a otro estudio.");
    tx.set(ref, { ...toActivity(input), studioId: studio, createdAt: oldData ? oldData.createdAt : serverTimestamp(), createdBy: oldData ? oldData.createdBy : actor(user), updatedAt: serverTimestamp(), updatedBy: actor(user), deletedAt: null });
    const changedFields = old ? (Object.keys(input) as Array<keyof ActivityInput>).filter((key) => JSON.stringify(old[key]) !== JSON.stringify(input[key])) : [];
    const history = doc(collection(ref, "history"));
    tx.set(history, { action: !old ? "created" : old.startAt !== input.startAt ? "rescheduled" : "updated", actor: actor(user), at: serverTimestamp(), ...(old ? { previousStartAt: old.startAt, nextStartAt: input.startAt, changedFields } : { nextStartAt: input.startAt }), reason });
    const notificationKind: NotificationKind | null = !old
      ? "created"
      : old.startAt !== input.startAt
        ? "rescheduled"
        : old.status !== input.status
          ? "status_changed"
          : null;
    if (notificationKind) {
      const notificationActivity = { ...input, id: ref.id, studioId: studio, createdAt: "", updatedAt: "", createdBy: actor(user), updatedBy: actor(user), deletedAt: null } as Activity;
      createActivityNotification(tx, notificationActivity, notificationKind, actor(user));
    }
  });
  return ref.id;
}

export async function changeActivityStatus(id: string, status: ActivityStatus, user: User, reason = ""): Promise<void> {
  const ref = doc(activities, id);
  await runTransaction(firestore, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists() || snapshot.data().studioId !== studio) throw new Error("La actividad ya no existe.");
    const previous = fromActivity(snapshot.id, snapshot.data() as Record<string, unknown>);
    tx.update(ref, { status, updatedAt: serverTimestamp(), updatedBy: actor(user) });
    tx.set(doc(collection(ref, "history")), { action: status === "cancelado" ? "cancelled" : "updated", actor: actor(user), at: serverTimestamp(), reason });
    if (previous.status !== status) createActivityNotification(tx, { ...previous, status, updatedBy: actor(user) } as Activity, "status_changed", actor(user));
  });
}

export async function archiveActivity(id: string, user: User, reason: string): Promise<void> {
  const ref = doc(activities, id);
  await runTransaction(firestore, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists() || snapshot.data().studioId !== studio) throw new Error("La actividad ya no existe.");
    tx.update(ref, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor(user) });
    tx.set(doc(collection(ref, "history")), { action: "deleted", actor: actor(user), at: serverTimestamp(), reason });
  });
}

export async function getClient(id: string): Promise<Client | null> {
  const result = await getDoc(doc(clients, id));
  return result.exists() && result.data().studioId === studio ? fromClient(result.id, result.data() as Record<string, unknown>) : null;
}
