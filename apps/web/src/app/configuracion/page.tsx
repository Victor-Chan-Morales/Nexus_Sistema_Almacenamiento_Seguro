"use client";

import { FormEvent, useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { addMember, getMembers } from "@/lib/api/members";
import type { MemberRole, OrganizationMembersResponse } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const roleLabels: Record<MemberRole, string> = {
  tenant_admin: "Administrador",
  colaborador: "Colaborador",
};

export default function SettingsPage() {
  const { session } = useSession();
  const isAdmin = session?.role === "tenant_admin";
  const accessToken = session?.accessToken;

  // Carga reactiva de miembros mediante el hook useLoad del proyecto (Desviación 1)
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
      // Escenario 3: Mapeo de errores de negocio 422
      if (err instanceof ApiError) {
        switch (err.code) {
          case "MEMBER_ALREADY_EXISTS":
            setFormError("Este correo ya es miembro de la organización.");
            break;
          case "EMAIL_BELONGS_TO_OTHER_ORGANIZATION":
            setFormError("El correo electrónico ya pertenece a otra organización.");
            break;
          case "USER_LIMIT_EXCEEDED":
            setFormError("La organización alcanzó el límite de usuarios de su plan.");
            break;
          case "VALIDATION_ERROR":
            setFormError(err.message || "Los datos ingresados no son válidos.");
            break;
          default:
            setFormError(err.message || "Error al registrar el miembro.");
            break;
        }
      } else {
        setFormError("Error de conexión. Intenta nuevamente.");
      }
    } finally {
      setFormSubmitting(false);
    }
  }

  const members = state.status === "ready" ? state.data.members || [] : [];
  const totalMembers = state.status === "ready" ? state.data.totalMembers ?? members.length : 0;
  const userLimit = state.status === "ready" ? state.data.userLimit : null;

  return (
    <AppShell active="settings">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <div>
            <h1 className="dashboard-title">Configuración</h1>
            <p className="dashboard-subtitle">
              Administración de miembros y políticas del espacio de trabajo.
            </p>
          </div>
        </header>

        {/* Escenario 4: Restricción para colaborador */}
        {!isAdmin ? (
          <section className="dashboard-card">
            <div className="auth-alert" role="status">
              Solo los administradores gestionan miembros.
            </div>
          </section>
        ) : (
          <div className="settings-layout">
            {/* Formulario: Invitar miembro */}
            <section className="dashboard-card">
              <h2 className="settings-section-title">Agregar miembro al equipo</h2>
              <p className="settings-section-subtitle">
                Invita a una nueva persona a colaborar en el espacio de trabajo.
              </p>

              {formSuccess && (
                <div className="auth-result-notice">
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

              {/* Escenario 6: Aviso permanente */}
              <div className="notice settings-notice-invite">
                <UiIcon name="shield" size={16} />
                <span>
                  Si el enlace de invitación vence (24 h), la persona puede usar «Olvidé mi contraseña» para recibir uno nuevo.
                </span>
              </div>
            </section>

            {/* Tabla de Miembros */}
            <section className="dashboard-card">
              <div className="settings-header-row">
                <div>
                  <h2 className="settings-section-title">Miembros del equipo</h2>
                  <span className="settings-counter">
                    {/* Escenario 1: Contador N de {userLimit} usuarios */}
                    {userLimit ? `${totalMembers} de ${userLimit} usuarios` : `${totalMembers} usuarios`}
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

              {/* Escenario 5: Manejo de estados mediante useLoad */}
              {state.status === "loading" ? (
                <div className="settings-state-box">
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
                /* Desviación 3: Texto de estado vacío exacto */
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
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td className="settings-cell-name">{m.fullName}</td>
                          <td className="settings-cell-muted">{m.email}</td>
                          <td>
                            <span
                              className={`settings-badge ${
                                m.role === "tenant_admin"
                                  ? "settings-badge-admin"
                                  : "settings-badge-colab"
                              }`}
                            >
                              {roleLabels[m.role] || m.role}
                            </span>
                          </td>
                          <td className="settings-cell-muted">
                            {formatIsoDate(m.joinedAt || m.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}