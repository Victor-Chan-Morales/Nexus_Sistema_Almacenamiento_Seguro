import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";
import type { Drive } from "@/lib/api/types";

/** SPEC-223 escenario 3: "Mi espacio" y los Drives de equipo en la barra lateral del explorador. */
export function DriveSwitcher({ drives, activeDriveId }: { drives: Drive[]; activeDriveId: string | null }) {
  const personal = drives.find((drive) => drive.type === "personal");
  const teams = drives.filter((drive) => drive.type === "team");
  return <>
    <Link href="/archivos" aria-current={personal && personal.id === activeDriveId ? "page" : undefined}><UiIcon name="files" />Mi espacio</Link>
    {teams.length > 0 && <>
      <span className="drive-nav-section drive-nav-section-spaced">DRIVES DE EQUIPO</span>
      {teams.map((drive) => (
        <Link key={drive.id} href={`/archivos?drive=${encodeURIComponent(drive.id)}`} aria-current={drive.id === activeDriveId ? "page" : undefined}>
          <UiIcon name="team" />{drive.name}
        </Link>
      ))}
    </>}
  </>;
}
