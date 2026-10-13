export const DEMO_EVENT = "nexus-demo-change";
export const DEMO_KEY = "nexus-demo-state";
export const DEMO_SESSION = "nexus-demo-session";
export const DEMO_PLAN_BYTES = 5 * 1024 ** 3;

export type DemoFolder = { id: string; name: string; parentId: string | null; deleted?: boolean };
export type DemoVersion = { number: number; size: number; type: string; uploadedAt: string };
export type DemoFile = { id: string; name: string; folderId: string; size: number; type: string; deleted?: boolean; versionCount?: number; versions?: DemoVersion[] };
export type DemoState = { user: { name: string; email: string; organization: string }; plan: string; verified: boolean; folders: DemoFolder[]; files: DemoFile[] };

export const initialDemo: DemoState = {
  user: { name: "Ana Martínez", email: "ana@nexus.demo", organization: "Acme Guatemala" },
  plan: "Demo",
  verified: true,
  folders: [
    { id: "root", name: "Archivos", parentId: null },
    { id: "proyectos", name: "Proyectos", parentId: "root" },
    { id: "documentos", name: "Documentos", parentId: "root" },
  ],
  files: [
    { id: "f-1", name: "Resumen del proyecto.pdf", folderId: "root", size: 245760, type: "PDF", versionCount: 1, versions: [{ number: 1, size: 245760, type: "PDF", uploadedAt: "Hoy (demostración)" }] },
    { id: "f-2", name: "Requisitos.xlsx", folderId: "documentos", size: 98304, type: "XLSX", versionCount: 1, versions: [{ number: 1, size: 98304, type: "XLSX", uploadedAt: "Hoy (demostración)" }] },
    { id: "f-3", name: "Propuesta.docx", folderId: "proyectos", size: 131072, type: "DOCX", versionCount: 1, versions: [{ number: 1, size: 131072, type: "DOCX", uploadedAt: "Hoy (demostración)" }] },
  ],
};

export function readDemo(): DemoState {
  if (typeof window === "undefined") return initialDemo;
  try {
    const saved = window.localStorage.getItem(DEMO_KEY);
    return saved ? { ...initialDemo, ...JSON.parse(saved) } : initialDemo;
  } catch { return initialDemo; }
}

export function writeDemo(next: DemoState) {
  window.localStorage.setItem(DEMO_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(DEMO_EVENT));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
