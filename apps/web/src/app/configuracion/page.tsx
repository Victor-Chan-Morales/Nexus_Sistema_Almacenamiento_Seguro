"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { addMember, getMembers } from "@/lib/api/members";
import type { MemberRole, OrganizationMember } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";
import { useSession } from "@/lib/session";

const roleLabels: Record<MemberRole, string> = {
  tenant_admin: "Administrador",
  colaborador: "Colaborador",
};

export default function SettingsPage() {
  const { session } = useSession();
  const isAdmin = session?.role === "tenant_admin";
  const accessToken = session?.accessToken;

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [userLimit, setUserLimit] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  // Estado del formulario de agregar miembro
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("colaborador");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !accessToken) return;

    let ignore = false;

    async function load() {
      try {
        const response = await getMembers(accessToken);
        if (ignore) return;
        setMembers(response.members || []);
        setTotalMembers(response.totalMembers ?? response.members?.length ?? 0);
        setUserLimit(response.userLimit);
        setError(null);
      } catch (err) {
        if (ignore) return;
        if (err instanceof ApiError) {
          setError(err.message || "No fue posible cargar la lista de miembros.");
        } else {
          setError("Error de conexión al cargar miembros.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      ignore = true;
    };
  }, [isAdmin, accessToken, refreshCount]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setRefreshCount((c) => c + 1);
  }

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
      handleRefresh();
    } catch (err) {
      // Escenario 3: Errores de negocio 422 mapeados
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

        {/* Escenario 4: Vista para colaborador */}
        {!isAdmin ? (
          <section className="dashboard-card" style={{ padding: "2rem" }}>
            <div className="auth-alert" role="status" style={{ margin: 0 }}>
              Solo los administradores gestionan miembros.
            </div>
          </section>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {/* Formulario: Agregar miembro */}
            <section className="dashboard-card" style={{ padding: "1.75rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Agregar miembro al equipo
              </h2>
              <p style={{ color: "var(--muted, #64748b)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
                Invita a una nueva persona a colaborar en el espacio de trabajo.
              </p>

              {formSuccess && (
                <div
                  className="auth-result-notice"
                  style={{ marginBottom: "1.25rem", borderColor: "#10b981", background: "rgba(16, 185, 129, 0.08)" }}
                >
                  <strong style={{ color: "#059669" }}>Invitación enviada</strong>
                  <span>{formSuccess}</span>
                </div>
              )}

              {formError && (
                <div className="auth-alert" role="alert" style={{ marginBottom: "1.25rem" }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleAddMember} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", alignItems: "flex-end" }}>
                <div className="field" style={{ margin: 0 }}>
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

                <div className="field" style={{ margin: 0 }}>
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

                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="member-role">Rol en el equipo</label>
                  <select
                    id="member-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    disabled={formSubmitting}
                    style={{
                      height: "2.65rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border, #cbd5e1)",
                      padding: "0 0.75rem",
                      background: "var(--surface, #fff)",
                    }}
                  >
                    <option value="colaborador">Colaborador</option>
                    <option value="tenant_admin">Administrador</option>
                  </select>
                </div>

                <button
                  className="button button-primary"
                  type="submit"
                  disabled={formSubmitting}
                  style={{ height: "2.65rem" }}
                >
                  {formSubmitting ? "Enviando invitación..." : "Agregar miembro"}
                </button>
              </form>

              {/* Escenario 6: Advertencia permanente de invitación vencida */}
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--muted, #64748b)",
                  marginTop: "1.25rem",
                  lineHeight: "1.4",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <UiIcon name="shield" size={14} />
                <span>Si el enlace de invitación vence (24 h), la persona puede usar «Olvidé mi contraseña» para recibir uno nuevo.</span>
              </p>
            </section>

            {/* Tabla: Miembros del equipo */}
            <section className="dashboard-card" style={{ padding: "1.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Miembros del equipo</h2>
                  <span style={{ fontSize: "0.875rem", color: "var(--muted, #64748b)" }}>
                    {/* Escenario 1: Contador N de {userLimit} usuarios */}
                    {userLimit ? `${totalMembers} de ${userLimit} usuarios` : `${totalMembers} usuarios`}
                  </span>
                </div>

                <button
                  className="text-button"
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  style={{ fontSize: "0.875rem" }}
                >
                  Actualizar lista
                </button>
              </div>

              {/* Escenario 5: Estados de carga, error y tabla */}
              {loading ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted, #64748b)" }}>
                  Cargando miembros...
                </div>
              ) : error ? (
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div className="auth-alert" role="alert" style={{ marginBottom: "1rem" }}>
                    {error}
                  </div>
                  <button className="button button-primary" type="button" onClick={handleRefresh}>
                    Reintentar
                  </button>
                </div>
              ) : members.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted, #64748b)" }}>
                  No hay miembros registrados aparte de tu cuenta.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border, #e2e8f0)", color: "var(--muted, #64748b)" }}>
                        <th style={{ padding: "0.75rem 1rem" }}>Nombre</th>
                        <th style={{ padding: "0.75rem 1rem" }}>Correo</th>
                        <th style={{ padding: "0.75rem 1rem" }}>Rol</th>
                        <th style={{ padding: "0.75rem 1rem" }}>Fecha de ingreso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id} style={{ borderBottom: "1px solid var(--border, #f1f5f9)" }}>
                          <td style={{ padding: "0.875rem 1rem", fontWeight: 500 }}>{m.fullName}</td>
                          <td style={{ padding: "0.875rem 1rem", color: "var(--muted, #475569)" }}>{m.email}</td>
                          <td style={{ padding: "0.875rem 1rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.2rem 0.6rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 500,
                                background: m.role === "tenant_admin" ? "rgba(79, 70, 229, 0.1)" : "rgba(100, 116, 139, 0.1)",
                                color: m.role === "tenant_admin" ? "#4f46e5" : "#475569",
                              }}
                            >
                              {roleLabels[m.role] || m.role}
                            </span>
                          </td>
                          <td style={{ padding: "0.875rem 1rem", color: "var(--muted, #64748b)" }}>
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