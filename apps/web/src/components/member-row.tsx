"use client";

import { useState } from "react";
import { Dialog } from "@/components/dialog";
import type { MemberRole, MemberStatus, OrganizationMember } from "@/lib/api/types";
import { formatIsoDate } from "@/lib/format";

const roleLabels: Record<MemberRole, string> = {
  tenant_admin: "Administrador",
  colaborador: "Colaborador",
};

export interface MemberRowProps {
  member: OrganizationMember;
  currentUserId?: string;
  isAdmin: boolean;
  onUpdateRole: (member: OrganizationMember, newRole: MemberRole) => Promise<void>;
  onToggleStatus: (member: OrganizationMember, newStatus: MemberStatus) => Promise<void>;
  onRemove: (member: OrganizationMember) => Promise<void>;
  disabled?: boolean;
}

export function MemberRow({
  member,
  currentUserId,
  isAdmin,
  onUpdateRole,
  onToggleStatus,
  onRemove,
  disabled = false,
}: MemberRowProps) {
  const [modalType, setModalType] = useState<"none" | "suspend" | "remove">("none");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const isSelf = Boolean(currentUserId && member.userId === currentUserId);
  const isSuspended = member.status === "suspended";

  async function handleRoleChange(newRole: MemberRole) {
    if (newRole === member.role || isSelf || submitting) return;
    setSubmitting(true);
    setRowError(null);
    try {
      await onUpdateRole(member, newRole);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo actualizar el rol.";
      setRowError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmSuspend() {
    setSubmitting(true);
    setRowError(null);
    try {
      await onToggleStatus(member, "suspended");
      setModalType("none");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo suspender el miembro.";
      setRowError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReactivate() {
    if (submitting) return;
    setSubmitting(true);
    setRowError(null);
    try {
      await onToggleStatus(member, "active");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo reactivar el miembro.";
      setRowError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmRemove() {
    setSubmitting(true);
    setRowError(null);
    try {
      await onRemove(member);
      setModalType("none");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo eliminar el miembro.";
      setRowError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td className="settings-cell-name">
        {member.fullName}
        {isSelf && <span style={{ marginLeft: "6px", fontSize: "0.75rem", color: "var(--muted)" }}>(Tú)</span>}
        {rowError && (
          <div className="auth-alert" style={{ marginTop: "4px", padding: "4px 8px", fontSize: "0.75rem" }} role="alert">
            {rowError}
          </div>
        )}
      </td>
      <td className="settings-cell-muted">{member.email}</td>
      <td>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          {isAdmin && !isSelf ? (
            <select
              className="settings-select"
              style={{ minHeight: "30px", padding: "0 6px", fontSize: "0.75rem" }}
              value={member.role}
              disabled={disabled || submitting}
              aria-label={`Cambiar rol de ${member.fullName}`}
              onChange={(e) => void handleRoleChange(e.target.value as MemberRole)}
            >
              <option value="colaborador">Colaborador</option>
              <option value="tenant_admin">Administrador</option>
            </select>
          ) : (
            <span
              className={`settings-badge ${
                member.role === "tenant_admin" ? "settings-badge-admin" : "settings-badge-colab"
              }`}
            >
              {roleLabels[member.role] || member.role}
            </span>
          )}

          {isSuspended && (
            <span className="settings-badge settings-badge-suspended" role="status">
              Suspendido
            </span>
          )}
        </div>
      </td>
      <td className="settings-cell-muted">
        {formatIsoDate(member.joinedAt || member.createdAt)}
      </td>

      {isAdmin && (
        <td>
          <div className="settings-actions-cell">
            {isSuspended ? (
              <button
                type="button"
                className="settings-action-btn"
                disabled={disabled || submitting || isSelf}
                aria-label={`Reactivar a ${member.fullName}`}
                onClick={() => void handleReactivate()}
              >
                Reactivar
              </button>
            ) : (
              <button
                type="button"
                className="settings-action-btn"
                disabled={disabled || submitting || isSelf}
                aria-label={`Suspender a ${member.fullName}`}
                onClick={() => {
                  setRowError(null);
                  setModalType("suspend");
                }}
              >
                Suspender
              </button>
            )}

            <button
              type="button"
              className="settings-action-btn settings-action-danger"
              disabled={disabled || submitting || isSelf}
              aria-label={`Eliminar a ${member.fullName}`}
              onClick={() => {
                setRowError(null);
                setModalType("remove");
              }}
            >
              Eliminar
            </button>
          </div>

          {/* Modal de confirmación para Suspender */}
          {modalType === "suspend" && (
            <Dialog
              labelledBy={`suspend-title-${member.id}`}
              onClose={() => setModalType("none")}
              disabled={submitting}
            >
              <h2 id={`suspend-title-${member.id}`}>Suspender colaborador</h2>
              <p>El usuario perderá el acceso inmediato y se revocarán sus sesiones activas.</p>
              {rowError && (
                <div className="auth-alert" style={{ marginBottom: "12px" }} role="alert">
                  {rowError}
                </div>
              )}
              <div className="drive-modal-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModalType("none")}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  style={{ background: "var(--color-coral)", borderColor: "var(--color-coral)" }}
                  onClick={() => void handleConfirmSuspend()}
                  disabled={submitting}
                >
                  {submitting ? "Suspendiendo..." : "Suspender"}
                </button>
              </div>
            </Dialog>
          )}

          {/* Modal de confirmación para Eliminar */}
          {modalType === "remove" && (
            <Dialog
              labelledBy={`remove-title-${member.id}`}
              onClose={() => setModalType("none")}
              disabled={submitting}
            >
              <h2 id={`remove-title-${member.id}`}>Eliminar miembro</h2>
              <p>Los archivos se conservan en la organización y la persona pierde el acceso definitivamente.</p>
              {rowError && (
                <div className="auth-alert" style={{ marginBottom: "12px" }} role="alert">
                  {rowError}
                </div>
              )}
              <div className="drive-modal-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setModalType("none")}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  style={{ background: "var(--color-coral)", borderColor: "var(--color-coral)" }}
                  onClick={() => void handleConfirmRemove()}
                  disabled={submitting}
                >
                  {submitting ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </Dialog>
          )}
        </td>
      )}
    </tr>
  );
}
