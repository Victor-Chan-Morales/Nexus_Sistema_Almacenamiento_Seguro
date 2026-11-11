import { notFound } from "next/navigation";
import { FileBrowserLive } from "@/components/file-browser-live";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FolderPage({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  if (!UUID_PATTERN.test(folderId)) notFound();
  return <FileBrowserLive />;
}
