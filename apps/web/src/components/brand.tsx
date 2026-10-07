import Image from "next/image";

export function NexusMark({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return <span className={`nexus-mark-frame ${className}`} aria-hidden="true"><Image className="nexus-mark-image" src="/logo-nexus-oficial.svg" width={667} height={492} alt="" priority={priority} /></span>;
}

export function Brand() {
  return (
    <span className="brand" aria-label="Nexus">
      <NexusMark priority />
      <span>Nexus</span>
    </span>
  );
}
