"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";
import { initialsOf, useSession } from "@/lib/session";

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const { signOut } = useSession();

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }

    function closeOnEscape(event: KeyboardEvent) {
      const menu = menuRef.current;
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return <details className="account-menu" ref={menuRef}>
    <summary aria-label="Abrir menú de cuenta" title={`Cuenta de ${name}`}>
      <span className="drive-user-avatar">{initialsOf(name)}</span>
      <span className="drive-user-name">{name}</span>
      <UiIcon name="chevron" size={14} />
    </summary>
    <div className="account-menu-dropdown">
      <div className="account-menu-summary"><b>{name}</b><span>{email}</span></div>
      <Link href="/perfil"><UiIcon name="user" size={16} />Mi perfil</Link>
      <Link href="/configuracion"><UiIcon name="settings" size={16} />Configuración</Link>
      <button type="button" onClick={handleSignOut}><UiIcon name="logout" size={16} />Cerrar sesión</button>
    </div>
  </details>;
}
