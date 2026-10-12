import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import QRCode from "qrcode";

const functions = getFunctions(getApp(), "southamerica-east1");

export type MobileAssignment = {
  memberId: string;
  name: string;
  email: string;
  permission: string;
  appId: string;
  devices: Array<{ id: string; name: string; linkedAt: string | null }>;
};

export type MobileEnrollmentQr = {
  email: string;
  permission: string;
  appId: string;
  qrDataUrl: string;
  expiresAt: number;
};

export async function listMobileAssignments() {
  const call = httpsCallable<void, { assignments: MobileAssignment[] }>(functions, "listMobileAssignments");
  return (await call()).data.assignments;
}

export async function createMobileEnrollment(email: string, permission: string): Promise<MobileEnrollmentQr> {
  const call = httpsCallable<{ email: string; permission: string }, { link: string; email: string; permission: string; appId: string; expiresAt: number }>(functions, "createMobileEnrollment");
  const result = (await call({ email, permission })).data;
  return {
    email: result.email,
    permission: result.permission,
    appId: result.appId,
    qrDataUrl: await QRCode.toDataURL(result.link, { errorCorrectionLevel: "M", margin: 2, width: 240 }),
    expiresAt: result.expiresAt,
  };
}
