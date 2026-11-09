"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Dialog } from "@/components/dialog";
import { MemberRow } from "@/components/member-row";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { addMember, getMembers, removeMember, updateMember } from "@/lib/api/members";
import { closeOrganization } from "@/lib/api/organizations";
import type { MemberRole, MemberStatus, OrganizationMember, OrganizationMembersResponse } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

function mapMemberError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "LAST_ADMIN_REQUIRED":
        return "No puedes quitar el rol de administrador al único administrador de la organización.";
      case "CANNOT_MODIFY_SELF":
        return "No puedes suspenderte ni eliminarte a ti mismo.";
      case "USER_LIMIT_EXCEEDED":
        return "La organización alcanzó el límite de usuarios de su plan.";
      case "MEMBER_ALREADY_EXISTS":
        return "Este correo ya es miembro de la organización.";
      case "EMAIL_BELONGS_TO_OTHER_ORGANIZATION":
        return "El correo electrónico ya pertenece a otra organización.";
      case "VALIDATION_ERROR":
        return err.message || "Los datos ingresados no son válidos.";
      default:
        return err.message || "Error al procesar la solicitud.";
    }
  }
  return "Error de conexión. Intenta nuevamente.";
}

export default function SettingsPage() {
  const router = useRouter();
  const { session, signOut, failSession } = useSession();
  const isAdmin = session?.role === "tenant_admin";
  const accessToken = session?.accessToken;
  const orgName = session?.organization?.name || "";

  // Carga reactiva de miembros mediante el hook useLoad del proyecto
  const fetchMembers = useCallback(
    (signal: AbortSignal) => getMembers(accessToken!, { signal }),
    [accessToken],
  );

  const { state, reload } = useLoad<OrganizationMembersResponse>(
    fetchMembers,
    isAdmin && Boolean(accessToken),
    "No fue posible cargar la lista de miembros.",
  );

  // Estado del formulario de alta de miembro
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("colaborador");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Estado para SPEC-114: Cierre de empresa
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [typedOrgName, setTypedOrgName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const isCloseFormValid =
    typedOrgName.trim() === orgName.trim() &&
    adminPassword.length > 0;

  async function handleAddMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin || !accessToken || formSubmitting) return;

    setFormError(null);
    setFormSuccess(null);

    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail) {
      setFormError("Por favor completa todos los campos.");
      return;
    }

    setFormSubmitting(true);
    try {
      await addMember(
        { fullName: trimmedName, email: trimmedEmail, role },
        accessToken,
      );

      setFormSuccess(`Enviamos un correo a ${trimmedEmail} para que defina su contraseña.`);
      setFullName("");
      setEmail("");
      setRole("colaborador");
      reload();
    } catch (err) {
      if (failSession(err)) return;
      setFormError(mapMemberError(err));
    } finally {
      setFormSubmitting(false);
    }
  }

  async function handleUpdateRole(member: OrganizationMember, newRole: MemberRole) {
    if (!accessToken) return;
    try {
      await updateMember(member.id, { role: newRole }, accessToken);
      reload();
    } catch (err) {
      if (failSession(err)) return;
      throw new Error(mapMemberError(err));
    }
  }

  async function handleToggleStatus(member: OrganizationMember, newStatus: MemberStatus) {
    if (!accessToken) return;
    try {
      await updateMember(member.id, { status: newStatus }, accessToken);
      reload();
    } catch (err) {
      if (failSession(err)) return;
      throw new Error(mapMemberError(err));
    }
  }

  async function handleRemoveMember(member: OrganizationMember) {
    if (!accessToken) return;
    try {
      await removeMember(member.id, accessToken);
      reload();
    } catch (err) {
      if (failSession(err)) return;
      throw new Error(mapMemberError(err));
    }
  }

  async function handleCloseOrganization(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!isCloseFormValid || closeSubmitting || !accessToken) return;

    setCloseSubmitting(true);
    setCloseError(null);

    try {
      await closeOrganization(
        { organizationName: typedOrgName.trim(), password: adminPassword },
        accessToken,
      );
      await signOut();
      router.push("/login?empresa=cerrada");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.code === "INVALID_CREDENTIALS") {
          setCloseError("Contraseña incorrecta.");
          return;
        }
        if (err.status === 422 || err.code === "ORGANIZATION_NAME_MISMATCH") {
          setCloseError("El nombre de la empresa no coincide.");
          return;
        }
        setCloseError(err.message || "Error al procesar la solicitud de eliminación.");
        return;
      }
      setCloseError("Error de conexión. Intenta nuevamente.");
    } finally {
      setCloseSubmitting(false);
    }
  }

  const members = state.status === "ready" ? state.data.members || [] : [];
  const totalMembers = state.status === "ready" ? state.data.totalMembers ?? members.length : 0;
  const userLimit = state.status === "ready" ? state.data.userLimit : null;

  return (
    <AppShell active="/configuracion">
      <>
        <div className="dashboard-page-heading">
          <div>
            <h1>Configuración</h1>
            <p>Administración de miembros y políticas del espacio de trabajo.</p>
          </div>
        </div>

        {/* Restricción para colaborador */}
        {!isAdmin ? (
          <section className="panel">
            <div className="auth-alert" role="status">
              Solo los administradores gestionan miembros.
            </div>
          </section>
        ) : (
          <div className="settings-layout">
            {/* Formulario: Invitar miembro */}
            <section className="panel">
              <h2 className="settings-section-title">Agregar miembro al equipo</h2>
              <p className="settings-section-subtitle">
                Invita a una nueva persona a colaborar en el espacio de trabajo.
              </p>

              {formSuccess && (
                <div className="auth-result-notice" role="status">
                  <strong>Invitación enviada</strong>
                  <span>{formSuccess}</span>
                </div>
              )}

              {formError && (
                <div className="auth-alert" role="alert">
                  {formError}
                </div>
              )}

              <form onSubmit={handleAddMember} className="settings-form">
                <div className="field">
                  <label htmlFor="member-fullname">Nombre completo</label>
                  <input
                    id="member-fullname"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Ana Morales"
                    required
                    disabled={formSubmitting}
                  />
                </div>

                <div className="field">
                  <label htmlFor="member-email">Correo electrónico</label>
                  <input
                    id="member-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ana@empresa.com"
                    required
                    disabled={formSubmitting}
                  />
                </div>

                <div className="field">
                  <label htmlFor="member-role">Rol en el equipo</label>
                  <select
                    id="member-role"
                    className="settings-select"
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    disabled={formSubmitting}
                  >
                    <option value="colaborador">Colaborador</option>
                    <option value="tenant_admin">Administrador</option>
                  </select>
                </div>

                <button
                  className="button button-primary settings-submit-btn"
                  type="submit"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? "Enviando..." : "Agregar miembro"}
                </button>
              </form>

              {/* Aviso permanente */}
              <div className="notice settings-notice-invite">
                <UiIcon name="shield" size={16} />
                <span>
                  Si el enlace de invitación vence (24 h), la persona puede usar «Olvidé mi contraseña» para recibir uno nuevo.
                </span>
              </div>
            </section>

            {/* Tabla de Miembros */}
            <section className="panel">
              <div className="settings-header-row">
                <div>
                  <h2 className="settings-section-title">Miembros del equipo</h2>
                  <span className="settings-counter">
                    {userLimit !== null ? `${totalMembers} de ${userLimit} usuarios` : `${totalMembers} usuarios`}
                  </span>
                </div>

                <button
                  className="text-button"
                  type="button"
                  onClick={reload}
                  disabled={state.status === "loading"}
                >
                  Actualizar lista
                </button>
              </div>

              {state.status === "loading" ? (
                <div className="settings-state-box" role="status" aria-live="polite">
                  Cargando miembros...
                </div>
              ) : state.status === "error" ? (
                <div className="settings-state-box">
                  <div className="auth-alert" role="alert">
                    {state.message}
                  </div>
                  <button className="button button-primary" type="button" onClick={reload}>
                    Reintentar
                  </button>
                </div>
              ) : members.length === 0 ? (
                <div className="empty-state">
                  <span>
                    <UiIcon name="shield" size={24} />
                  </span>
                  <b>Sin miembros registrados</b>
                  <p>No se encontraron miembros registrados en la organización.</p>
                </div>
              ) : (
                <div className="settings-table-wrapper">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Correo</th>
                        <th>Rol</th>
                        <th>Fecha de ingreso</th>
                        {isAdmin && <th>Acciones</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <MemberRow
                          key={m.id}
                          member={m}
                          currentUserId={session?.user?.id}
                          isAdmin={isAdmin}
                          onUpdateRole={handleUpdateRole}
                          onToggleStatus={handleToggleStatus}
                          onRemove={handleRemoveMember}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* SPEC-114: Zona de riesgo para administradores */}
            <section className="panel danger-zone">
              <div className="danger-zone-header">
                <div>
                  <h2 className="danger-zone-title">
                    <UiIcon name="shield" size={20} />
                    Zona de riesgo
                  </h2>
                  <p className="danger-zone-desc">
                    Eliminar la empresa cancelará inmediatamente la suscripción activa y revocará el acceso de todos los usuarios.
                    Los archivos se conservan en la plataforma conforme a la política de retención de datos.
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => {
                    setShowCloseModal(true);
                    setTypedOrgName("");
                    setAdminPassword("");
                    setCloseError(null);
                  }}
                >
                  Eliminar empresa
                </button>
              </div>
            </section>
          </div>
        )}

        {/* SPEC-114: Modal de doble confirmación para eliminar empresa */}
        {showCloseModal && (
          <Dialog
            labelledBy="close-org-dialog-title"
            disabled={closeSubmitting}
            onClose={() => {
              if (!closeSubmitting) setShowCloseModal(false);
            }}
          >
            <div>
              <h2 id="close-org-dialog-title" style={{ color: "var(--color-coral)", marginTop: 0 }}>
                Eliminar empresa
              </h2>
              <div className="danger-modal-callout" role="alert">
                <strong>¡Atención!</strong> Esta acción es irreversible. Se cancelará la suscripción activa
                y se revocarán todas las sesiones de los colaboradores de forma inmediata. Los archivos se conservan
                en la plataforma pero ningún usuario podrá volver a ingresar.
              </div>

              {closeError && (
                <div className="auth-alert" role="alert" style={{ marginBottom: "1rem" }}>
                  {closeError}
                </div>
              )}

              <form onSubmit={handleCloseOrganization} className="settings-form">
                <div className="field">
                  <label htmlFor="confirm-org-name">
                    Escribe el nombre de la empresa para confirmar: <strong>{orgName}</strong>
                  </label>
                  <input
                    id="confirm-org-name"
                    type="text"
                    value={typedOrgName}
                    onChange={(e) => setTypedOrgName(e.target.value)}
                    placeholder={orgName}
                    disabled={closeSubmitting}
                    autoFocus
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="confirm-admin-password">
                    Ingresa tu contraseña de administrador
                  </label>
                  <input
                    id="confirm-admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    disabled={closeSubmitting}
                    required
                  />
                </div>

                <div
                  style={{
                    marginTop: "1.5rem",
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                  }}
                >
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setShowCloseModal(false)}
                    disabled={closeSubmitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="button button-danger"
                    disabled={!isCloseFormValid || closeSubmitting}
                  >
                    {closeSubmitting ? "Eliminando..." : "Eliminar definitivamente"}
                  </button>
                </div>
              </form>
            </div>
          </Dialog>
        )}
      </>
    </AppShell>
  );
}
