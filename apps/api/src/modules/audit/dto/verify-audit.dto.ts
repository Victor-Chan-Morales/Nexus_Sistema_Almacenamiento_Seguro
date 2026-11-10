export type AuditVerificationReason = 'SEQUENCE_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH';

export interface AuditVerificationDto {
  valid: boolean;
  checkedEvents: number;
  firstBrokenEventId: string | null;
  reason: AuditVerificationReason | null;
  verifiedAt: string;
}
