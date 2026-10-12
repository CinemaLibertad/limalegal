import {
  collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { firestore } from "../firebase/services";
import type { LegalAnnotation, LegalCitationSnapshot, LegalDraft, LegalDraftInput, LegalDraftVersion, JurisprudenceResult } from "./jurisprudence.model";
import { STUDIO_ID } from "../activities/activity.model";

const studio = String(STUDIO_ID);
const root = collection(firestore, "studios", studio, "legalDrafts");
const citations = collection(firestore, "studios", studio, "legalCitations");
const works = collection(firestore, "studios", studio, "legalWorks");
const annotations = collection(firestore, "studios", studio, "legalAnnotations");
const actor = (user: User) => user.email ?? user.uid;
const iso = (value: unknown) => value instanceof Timestamp ? value.toDate().toISOString() : "";

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toDraft(id: string, data: Record<string, unknown>): LegalDraft {
  return { ...data, id, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt) } as LegalDraft;
}

export async function listLegalDrafts(): Promise<LegalDraft[]> {
  const snapshot = await getDocs(query(root, orderBy("updatedAt", "desc"), limit(50)));
  return snapshot.docs.map((item) => toDraft(item.id, item.data() as Record<string, unknown>));
}

export async function saveLegalDraft(input: LegalDraftInput, user: User, id: string | null, expectedRevision: number) {
  const ref = id ? doc(root, id) : doc(root);
  const serializedSize = new TextEncoder().encode(JSON.stringify(input.content)).byteLength;
  if (serializedSize > 700_000) throw new Error("El borrador supera el tamaño admitido. Quitá contenido o adjuntos e intentá guardar nuevamente.");

  const revision = await runTransaction(firestore, async (transaction) => {
    const snapshot = id ? await transaction.get(ref) : null;
    if (snapshot?.exists()) {
      const current = snapshot.data();
      if (current.studioId !== studio) throw new Error("El borrador no pertenece a este estudio.");
      if (current.revision !== expectedRevision) throw new Error("conflict: Este borrador cambió en otra sesión. Recargá su versión antes de guardar para no sobrescribir cambios.");
      const nextRevision = current.revision + 1;
      transaction.update(ref, { ...input, revision: nextRevision, updatedAt: serverTimestamp(), updatedBy: actor(user) });
      return nextRevision;
    }
    if (id) throw new Error("El borrador ya no existe.");
    transaction.set(ref, { ...input, studioId: studio, revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user), updatedBy: actor(user) });
    return 1;
  });
  return { id: ref.id, revision };
}

export async function registerLegalDraftVersion(draft: LegalDraft, user: User) {
  const draftRef = doc(root, draft.id);
  const versionRef = doc(collection(draftRef, "versions"), `revision-${String(draft.revision).padStart(6, "0")}`);
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(draftRef);
    if (!current.exists() || current.data().studioId !== studio) throw new Error("El borrador ya no existe.");
    if (current.data().revision !== draft.revision) throw new Error("conflict: Hay cambios nuevos. Esperá el autoguardado antes de registrar una versión.");
    const existingVersion = await transaction.get(versionRef);
    if (existingVersion.exists()) throw new Error("Esta revisión ya fue registrada.");
    transaction.set(versionRef, { draftId: draft.id, revision: draft.revision, title: draft.title, content: draft.content, caseId: draft.caseId, registeredAt: serverTimestamp(), registeredBy: actor(user) });
  });
}

export async function listLegalDraftVersions(draftId: string): Promise<LegalDraftVersion[]> {
  const snapshot = await getDocs(query(collection(doc(root, draftId), "versions"), orderBy("revision", "desc"), limit(30)));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id, registeredAt: iso(item.data().registeredAt) } as LegalDraftVersion));
}

export async function saveLegalCitation(result: JurisprudenceResult, excerpt: string, user: User) {
  if (!result.providerId) throw new Error("La fuente no aportó un identificador estable para registrar esta cita.");
  const citationId = await digest(`${result.source ?? "unknown"}\n${result.providerId}\n${excerpt.trim()}`);
  const workId = await digest(`${result.source ?? "unknown"}\n${result.providerId}`);
  const citationRef = doc(citations, citationId);
  const workRef = doc(works, workId);

  const snapshot = await runTransaction(firestore, async (transaction) => {
    const citationExists = await transaction.get(citationRef);
    if (citationExists.exists()) return { ...citationExists.data(), id: citationRef.id } as LegalCitationSnapshot;
    const workExists = await transaction.get(workRef);
    if (!workExists.exists()) {
      transaction.set(workRef, {
        studioId: studio, provider: "juridica-multisource", source: result.source, providerDocumentId: result.providerId,
        title: result.title, caption: result.caption, court: result.court, decisionDate: result.decisionDate,
        jurisdiction: result.jurisdiction, officialUrl: result.officialUrl, createdAt: serverTimestamp(), createdBy: actor(user),
      });
    }
    const data = {
      studioId: studio, provider: "juridica-multisource", source: result.source, workId, providerDocumentId: result.providerId,
      sourceTitle: result.title, caption: result.caption, court: result.court,
      decisionDate: result.decisionDate, jurisdiction: result.jurisdiction, officialUrl: result.officialUrl,
      excerpt: excerpt.trim(), sourcePage: null, documentHash: null, verificationStatus: "pending",
      createdAt: serverTimestamp(), createdBy: actor(user),
    };
    transaction.set(citationRef, data);
    return { ...data, id: citationRef.id, createdAt: new Date().toISOString() } as LegalCitationSnapshot;
  });
  return snapshot;
}

export async function listLegalCitations(): Promise<LegalCitationSnapshot[]> {
  const snapshot = await getDocs(query(citations, orderBy("createdAt", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: iso(item.data().createdAt) } as LegalCitationSnapshot));
}

export async function markLegalCitationVerified(id: string, user: User) {
  const ref = doc(citations, id);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().studioId !== studio) throw new Error("La cita ya no existe.");
    if (snapshot.data().verificationStatus === "verified") return;
    transaction.update(ref, { verificationStatus: "verified", verifiedAt: serverTimestamp(), verifiedBy: actor(user) });
  });
}

export async function saveLegalAnnotation(result: JurisprudenceResult, excerpt: string, note: string, user: User) {
  if (!result.providerId) throw new Error("La fuente no aportó un identificador para guardar la anotación.");
  const id = await digest(`${result.source ?? "unknown"}\n${result.providerId}\n${excerpt.trim()}\n${note.trim()}`);
  const ref = doc(annotations, id);
  await runTransaction(firestore, async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists()) return;
    transaction.set(ref, { studioId: studio, provider: "juridica-multisource", source: result.source, providerDocumentId: result.providerId, excerpt: excerpt.trim(), note: note.trim(), createdAt: serverTimestamp(), createdBy: actor(user) });
  });
}

export async function listLegalAnnotations(): Promise<LegalAnnotation[]> {
  const snapshot = await getDocs(query(annotations, orderBy("createdAt", "desc"), limit(100)));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id, createdAt: iso(item.data().createdAt) } as LegalAnnotation));
}
