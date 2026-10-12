import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "@/lib/firebase/services";
import { STUDIO_ID } from "@/lib/activities/activity.model";

export type AuthorizedMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  permission: string;
};

const membersCollection = collection(firestore, "studios", STUDIO_ID, "teamMembers");

async function memberDocumentId(email: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listTeamMembers(): Promise<AuthorizedMember[]> {
  const snapshot = await getDocs(query(membersCollection, orderBy("createdAt", "asc")));
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    name: String(entry.get("name") ?? ""),
    email: String(entry.get("email") ?? ""),
    role: String(entry.get("role") ?? ""),
    permission: String(entry.get("permission") ?? ""),
  }));
}

export async function saveTeamMember(
  member: Omit<AuthorizedMember, "id">,
  actor: { uid: string; email: string },
) {
  const id = await memberDocumentId(member.email.trim().toLowerCase());
  const memberRef = doc(membersCollection, id);
  await runTransaction(firestore, async (transaction) => {
    const existing = await transaction.get(memberRef);
    transaction.set(memberRef, {
      ...member,
      email: member.email.trim().toLowerCase(),
      studioId: STUDIO_ID,
      createdAt: existing.exists() ? existing.get("createdAt") as Timestamp : serverTimestamp(),
      createdBy: existing.exists() ? existing.get("createdBy") : actor.email,
      updatedAt: serverTimestamp(),
      updatedBy: actor.email,
      updatedByUid: actor.uid,
    });
  });
}
