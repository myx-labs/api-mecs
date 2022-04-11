export interface AuditLogResponse {
  previousPageCursor: string | null;
  nextPageCursor: string | null;
  data: AuditLogItem[];
}

export interface AuditLogItem {
  actor: AuditLogActor;
  actionType: string;
  description: AuditLogDescription;
  created: Date;
}

export interface AuditLogActor {
  user: AuditLogUser;
  role: AuditLogRoleset;
}

export interface AuditLogRoleset {
  id: number;
  name: string;
  rank: number;
}

export interface AuditLogUser {
  buildersClubMembershipType: string;
  userId: number;
  username: string;
  displayName: string;
}

export interface AuditLogDescription {
  TargetId: number;
  NewRoleSetId: number;
  OldRoleSetId: number;
  TargetName: string;
  NewRoleSetName: string;
  OldRoleSetName: string;
}
