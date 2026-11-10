import { MembershipStatus, Role, UserStatus } from '../domain/enums';
import { AccountNotices } from './account-notices.service';

const member = (
  userId: string,
  role: Role,
  status = MembershipStatus.ACTIVE,
  userStatus = UserStatus.ACTIVE,
) => ({
  userId,
  role,
  status,
  user: { email: `${userId}@example.test`, status: userStatus, passwordHash: 'hash-de-prueba' },
});

function setup() {
  const tx = { transaction: jest.fn(async (work) => work('savepoint')) };
  const uow = { run: jest.fn(async (work) => work(tx)) };
  const memberships = {
    listByOrganization: jest.fn().mockResolvedValue([
      member('admin', Role.TENANT_ADMIN),
      member('collab', Role.COLABORADOR),
      member('suspended', Role.TENANT_ADMIN, MembershipStatus.SUSPENDED),
      member('inactive', Role.TENANT_ADMIN, MembershipStatus.ACTIVE, UserStatus.INACTIVE),
    ]),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue('message-1') };
  const notices = new AccountNotices(memberships as never, uow as never, outbox as never);
  return { notices, outbox, memberships, tx, uow };
}

describe('AccountNotices (SPEC-115)', () => {
  it('avisa solo a administradores activos y encola sin datos de la operación ni token', async () => {
    const { notices, outbox, memberships, tx } = setup();
    await notices.planChanged('org-1');

    expect(memberships.listByOrganization).toHaveBeenCalledWith('org-1');
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(tx, {
      kind: 'plan_changed',
      userId: 'admin',
      recipientEmail: 'admin@example.test',
      recipientName: '',
      rawToken: '',
      expiresAt: expect.any(Date),
    });
  });

  it('captura a los miembros activos dentro del cierre y los encola por separado', async () => {
    const { notices, outbox, memberships, tx, uow } = setup();
    const recipients = await notices.captureClosureRecipients(tx as never, 'org-1');
    expect(memberships.listByOrganization).toHaveBeenCalledWith('org-1', 'savepoint');
    expect(uow.run).not.toHaveBeenCalled();

    await notices.organizationClosed(recipients);
    expect(uow.run).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue.mock.calls.map(([, data]) => [data.kind, data.recipientEmail])).toEqual([
      ['organization_closed', 'admin@example.test'],
      ['organization_closed', 'collab@example.test'],
    ]);
  });

  it('si falla la escritura del aviso, el fallo queda aislado de la operación original', async () => {
    const { notices, outbox } = setup();
    outbox.enqueue.mockRejectedValueOnce(new Error('base de datos indisponible'));

    await expect(notices.memberStatusChanged({ userId: 'collab', email: 'collab@example.test' }))
      .resolves.toBeUndefined();
  });

  it('si falla la captura en el cierre, permite cerrarlo sin destinatarios', async () => {
    const { notices, memberships, tx, outbox } = setup();
    memberships.listByOrganization.mockRejectedValueOnce(new Error('consulta fallida'));

    await expect(notices.captureClosureRecipients(tx as never, 'org-1')).resolves.toEqual([]);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
