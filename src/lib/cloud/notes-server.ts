// Server side of Cloud notes: the viewer's state, dismissals, the org switch.

import { db } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { CLOUD_NOTES_OFF, cloudTrialUrl, isCloudNoteKey, roleSeesCloudNotes, type CloudNoteKey, type CloudNotesState } from "./notes";

export async function cloudNotesStateFor(user: { id?: string | null; role?: string | null } | null | undefined): Promise<CloudNotesState> {
  if (!user?.id || !roleSeesCloudNotes(user.role)) return CLOUD_NOTES_OFF;
  try {
    const [settings, rows] = await Promise.all([
      getExerciseSettings(),
      db.cloudNoteDismissal.findMany({ where: { userId: user.id }, select: { note: true } }),
    ]);
    if (settings && !settings.showCloudNotes) return CLOUD_NOTES_OFF;
    return {
      enabled: true,
      dismissed: rows.map((r) => r.note).filter(isCloudNoteKey),
      trial: cloudTrialUrl() !== null,
    };
  } catch {
    return CLOUD_NOTES_OFF;
  }
}

export async function dismissCloudNote(userId: string, note: CloudNoteKey): Promise<void> {
  await db.cloudNoteDismissal.upsert({
    where: { userId_note: { userId, note } },
    create: { userId, note },
    update: {},
  });
}

/** Bring back every note this user dismissed. */
export async function resetCloudNotes(userId: string): Promise<number> {
  return (await db.cloudNoteDismissal.deleteMany({ where: { userId } })).count;
}
