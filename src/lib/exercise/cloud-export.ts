// "Export for Cloud": one JSON file an administrator downloads and uploads to
// Crucible Cloud by hand. It holds the organization's own templates (portable
// format) plus any built-in library template the organization edited (Cloud
// has the unedited library already), its source documents (title, kind, text, sha256) and the emails of
// active users, for invites. Nothing else: no exercises, after-action reports,
// incidents, names or settings. CE never connects to Cloud.

import { db } from "@/lib/db";
import { installOrgId } from "@/lib/exercise/settings";
import { exportTemplate, type PortableTemplate } from "@/lib/exercise/templates/portable";
import { editedLibraryTemplateIds } from "@/lib/exercise/templates/library-edits";

export const CLOUD_EXPORT_FORMAT = "crucible-ce-cloud-export";
export const CLOUD_EXPORT_VERSION = 1;

export interface CloudExportFile {
  format: typeof CLOUD_EXPORT_FORMAT;
  version: typeof CLOUD_EXPORT_VERSION;
  exportedAt: string;
  templates: PortableTemplate[];
  documents: Array<{ title: string; kind: string; text: string; sha256: string }>;
  users: Array<{ email: string }>;
}

/** Templates are skipped when `canRead` says the admin may not see their hidden scoring (playing in a live run). */
export async function buildCloudExport(opts: { canRead?: (templateId: string) => Promise<boolean>; now?: Date } = {}): Promise<{ file: CloudExportFile; skippedTemplates: number }> {
  const orgId = await installOrgId();
  const editedLibrary = await editedLibraryTemplateIds();
  const [templates, documents, users] = await Promise.all([
    db.exerciseTemplate.findMany({
      where: {
        status: { in: ["draft", "published"] },
        OR: [{ scope: "local" }, { id: { in: editedLibrary } }],
        ...(orgId ? { organizationId: orgId } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    db.sourceDocument.findMany({
      where: orgId ? { organizationId: orgId } : {},
      orderBy: { createdAt: "asc" },
      select: { title: true, kind: true, text: true, sha256: true },
    }),
    db.user.findMany({
      where: { isActive: true, ...(orgId ? { organizationId: orgId } : {}) },
      orderBy: { email: "asc" },
      select: { email: true },
    }),
  ]);
  const portable: PortableTemplate[] = [];
  let skippedTemplates = 0;
  for (const t of templates) {
    if (opts.canRead && !(await opts.canRead(t.id))) {
      skippedTemplates++;
      continue;
    }
    portable.push(await exportTemplate(t.id));
  }
  return {
    file: {
      format: CLOUD_EXPORT_FORMAT,
      version: CLOUD_EXPORT_VERSION,
      exportedAt: (opts.now ?? new Date()).toISOString(),
      templates: portable,
      documents: documents.map((d) => ({ title: d.title, kind: d.kind, text: d.text, sha256: d.sha256 })),
      users: users.map((u) => ({ email: u.email })),
    },
    skippedTemplates,
  };
}
