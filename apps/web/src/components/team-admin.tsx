"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Dialog } from "@/components/dialog";
import { Notice } from "@/components/notice";
import { LoadingIndicator, useToast } from "@/components/toast";
import { UiIcon } from "@/components/ui-icon";
import { ApiError } from "@/lib/api/client";
import { getMembers } from "@/lib/api/members";
import { addTeamMember, changeTeamMemberLevel, createTeam, listTeamMembers, listTeams, removeTeamMember } from "@/lib/api/teams";
import type { TeamItem, TeamLevel, TeamMemberItem } from "@/lib/api/types";
import { RequireSession, useSession, type Session } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

const LOAD_ERROR = "No pudimos cargar los equipos. Inténtalo de nuevo.";
const GENERIC_ERROR = "No se pudo completar la operación. Inténtalo de nuevo.";

/** SPEC-220 §5 y §7: mensajes en español para los errores de equipos. */
function teamErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR;
  if (error.status === 0) return error.message;
  if (error.status === 404) return "Este equipo o miembro ya no está disponible.";
  if (error.status === 403) return "No tienes permiso para esta acción.";
  switch (error.code) {
    case "TEAM_NAME_CONFLICT":
      return "Ya existe un equipo con ese nombre.";
    case "TEAM_MEMBER_EXISTS":
      return "Esa persona ya pertenece al equipo.";
    case "USER_NOT_IN_ORGANIZATION":
      return "Esa persona no tiene una cuenta activa en la organización.";
    default:
      return GENERIC_ERROR;
  }
}

function levelLabel(level: TeamLevel | null) {
  if (level === "write") return "Edición";
  if (level === "read") return "Lectura";
  return "Sin nivel";
}

/** SPEC-223 escenario 1 y 2: `/equipos`. El administrador gestiona; el colaborador solo ve sus equipos y su nivel. */
export function TeamAdmin() {
  return <RequireSession>{(session) => <TeamAdminSession session={session} />}</RequireSession>;
}

function TeamAdminSession({ session }: { session: Session }) {
  const token = session.accessToken;
  const isAdmin = session.role === "tenant_admin";
  const { failSession } = useSession();
  const notify = useToast();
  const fetchTeams = useCallback(async (signal: AbortSignal) => (await listTeams(token, { signal })).items, [token]);
  const { state, reload } = useLoad(fetchTeams, true, LOAD_ERROR);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const teams = state.status === "ready" ? state.data : [];

  async function createSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 150) {
      notify("error", "El nombre debe tener entre 1 y 150 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await createTeam({ name: trimmed }, token);
      setName("");
      notify("success", `Se creó el equipo «${trimmed}».`);
      reload();
    } catch (error) {
      if (!failSession(error)) notify("error", teamErrorMessage(error));
    } finally { setBusy(false); }
  }

  return <AppShell active="/equipos">
    <div className="team-page">
      <div className="dashboard-page-heading">
        <div>
          <p className="eyebrow">GESTIÓN DE ARCHIVOS</p>
          <h1>Equipos</h1>
          <p>{isAdmin ? "Crea equipos y decide quién puede leer o editar sus archivos." : "Los equipos a los que perteneces y tu nivel en cada uno."}</p>
        </div>
      </div>

      {isAdmin && <form className="team-create-form" onSubmit={createSubmit}>
        <label className="drive-form-label" htmlFor="team-name">Nombre del equipo</label>
        <div className="team-create-row">
          <input id="team-name" className="drive-modal-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={150} required />
          <button className="drive-primary-button" type="submit" disabled={busy}>{busy ? "Creando…" : "Crear equipo"}</button>
        </div>
      </form>}

      {state.status === "loading" && <LoadingIndicator>Cargando equipos…</LoadingIndicator>}
      {state.status === "error" && <Notice title="No se pudieron cargar los equipos" message={state.message} onRetry={reload} />}
      {state.status === "ready" && teams.length === 0 && (
        <div className="drive-empty-state team-state-card">
          <span><UiIcon name="team" size={21} /></span>
          <b>Todavía no hay equipos</b>
          <p>{isAdmin ? "Crea el primero con el formulario de arriba." : "Cuando te agreguen a un equipo, aparecerá aquí."}</p>
        </div>
      )}

      {teams.length > 0 && <div className="team-list">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            isAdmin={isAdmin}
            token={token}
            open={openTeamId === team.id}
            onToggle={() => setOpenTeamId(openTeamId === team.id ? null : team.id)}
            onChanged={reload}
          />
        ))}
      </div>}
    </div>
  </AppShell>;
}

function TeamCard({ team, isAdmin, token, open, onToggle, onChanged }: {
  team: TeamItem;
  isAdmin: boolean;
  token: string;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const memberWord = team.memberCount === 1 ? "miembro" : "miembros";
  const levelText = isAdmin ? "Administras este equipo" : `Tu nivel: ${levelLabel(team.myLevel)}`;
  return <section className="team-card" aria-labelledby={`team-${team.id}`}>
    <div className="team-card-head">
      <div>
        <h2 id={`team-${team.id}`}>{team.name}</h2>
        <p>{team.memberCount} {memberWord} · {levelText}</p>
      </div>
      <div className="team-card-actions">
        {team.driveId && <Link className="button" href={`/archivos?drive=${encodeURIComponent(team.driveId)}`}>Abrir Drive</Link>}
        {isAdmin && <button className="button" type="button" onClick={onToggle} aria-expanded={open}>{open ? "Ocultar miembros" : "Administrar miembros"}</button>}
      </div>
    </div>
    {isAdmin && open && <TeamMembers teamId={team.id} token={token} onChanged={onChanged} />}
  </section>;
}

/** Solo se monta para `tenant_admin`: las rutas de miembros y la lista de la organización son de administración. */
function TeamMembers({ teamId, token, onChanged }: { teamId: string; token: string; onChanged: () => void }) {
  const { failSession } = useSession();
  const notify = useToast();
  const fetchMembers = useCallback(async (signal: AbortSignal) => (await listTeamMembers(teamId, token, { signal })).items, [teamId, token]);
  const fetchOrganization = useCallback(async (signal: AbortSignal) => (await getMembers(token, { signal })).members, [token]);
  const membersLoad = useLoad(fetchMembers, true, "No pudimos cargar los miembros. Inténtalo de nuevo.");
  const organizationLoad = useLoad(fetchOrganization, true, "No pudimos cargar las personas de la organización.");
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<TeamLevel>("read");
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberItem | null>(null);

  const members = membersLoad.state.status === "ready" ? membersLoad.state.data : [];
  const organization = organizationLoad.state.status === "ready" ? organizationLoad.state.data : [];
  // Solo personas con cuenta activa que todavía no están en el equipo.
  const candidates = organization.filter((person) => person.status === "active" && !members.some((member) => member.userId === person.userId));

  function handleError(error: unknown) {
    if (failSession(error)) return;
    notify("error", teamErrorMessage(error));
    if (error instanceof ApiError && error.status === 404) membersLoad.reload();
  }

  async function addSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;
    setBusy(true);
    try {
      await addTeamMember(teamId, { userId, level }, token);
      setUserId("");
      notify("success", "Miembro agregado al equipo.");
      membersLoad.reload();
      onChanged();
    } catch (error) {
      handleError(error);
    } finally { setBusy(false); }
  }

  async function changeLevel(member: TeamMemberItem, next: TeamLevel) {
    if (member.level === next) return;
    setBusy(true);
    try {
      await changeTeamMemberLevel(teamId, member.userId, { level: next }, token);
      notify("success", `Nivel de ${member.fullName} actualizado.`);
      membersLoad.reload();
    } catch (error) {
      handleError(error);
    } finally { setBusy(false); }
  }

  async function removeConfirmed(member: TeamMemberItem) {
    setRemoveTarget(null);
    setBusy(true);
    try {
      await removeTeamMember(teamId, member.userId, token);
      notify("success", `${member.fullName} salió del equipo.`);
      membersLoad.reload();
      onChanged();
    } catch (error) {
      handleError(error);
    } finally { setBusy(false); }
  }

  return <div className="team-members">
    {membersLoad.state.status === "loading" && <LoadingIndicator>Cargando miembros…</LoadingIndicator>}
    {membersLoad.state.status === "error" && <Notice title="No se pudieron cargar los miembros" message={membersLoad.state.message} onRetry={membersLoad.reload} />}

    {membersLoad.state.status === "ready" && <>
      {members.length === 0 && <p className="team-muted">Este equipo todavía no tiene miembros.</p>}
      <ul className="team-member-list">
        {members.map((member) => (
          <li key={member.userId} className="team-member-row">
            <span><b>{member.fullName}</b><small>{member.email}</small></span>
            <select aria-label={`Nivel de ${member.fullName}`} value={member.level} disabled={busy} onChange={(event) => changeLevel(member, event.target.value as TeamLevel)}>
              <option value="read">Lectura</option>
              <option value="write">Edición</option>
            </select>
            <button type="button" className="text-button" disabled={busy} onClick={() => setRemoveTarget(member)} aria-label={`Quitar a ${member.fullName} del equipo`}>Quitar</button>
          </li>
        ))}
      </ul>

      <form className="team-add-form" onSubmit={addSubmit}>
        <label className="drive-form-label" htmlFor={`add-member-${teamId}`}>Agregar miembro</label>
        <div className="team-add-row">
          <select id={`add-member-${teamId}`} className="drive-modal-input" value={userId} onChange={(event) => setUserId(event.target.value)} required>
            <option value="" disabled>Elige a una persona</option>
            {candidates.map((person) => <option key={person.userId} value={person.userId}>{person.fullName} · {person.email}</option>)}
          </select>
          <select aria-label="Nivel del nuevo miembro" value={level} onChange={(event) => setLevel(event.target.value as TeamLevel)}>
            <option value="read">Lectura</option>
            <option value="write">Edición</option>
          </select>
          <button className="drive-primary-button" type="submit" disabled={busy || !userId}>Agregar</button>
        </div>
      </form>
    </>}

    {removeTarget && (
      <Dialog labelledBy={`remove-member-${teamId}`} onClose={() => setRemoveTarget(null)} disabled={busy}>
        <h2 id={`remove-member-${teamId}`}>¿Quitar a {removeTarget.fullName} del equipo?</h2>
        <p>Dejará de ver el Drive de este equipo desde su siguiente solicitud.</p>
        <div className="drive-modal-actions">
          <button type="button" className="drive-subtle-button" onClick={() => setRemoveTarget(null)}>Cancelar</button>
          <button type="button" className="drive-primary-button" onClick={() => removeConfirmed(removeTarget)} disabled={busy}>Quitar del equipo</button>
        </div>
      </Dialog>
    )}
  </div>;
}
