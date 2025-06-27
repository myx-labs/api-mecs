export interface RobloxAPI_GroupRolesetUser {
  buildersClubMembershipType?: string;
  userId?: number;
  username?: string;
  displayName?: string;
}

export interface RobloxAPI_GroupRolesetUserRole {
  id?: number;
  name?: string;
  rank?: number;
}

export interface RobloxAPI_GroupUserItem {
  user?: RobloxAPI_GroupRolesetUser;
  role?: RobloxAPI_GroupRolesetUserRole;
}

export interface RobloxAPI_GroupUsersResponse {
  previousPageCursor: string | null;
  nextPageCursor: string | null;
  data: RobloxAPI_GroupUserItem[];
}
export interface RobloxAPI_GroupRolesetUserResponse {
  previousPageCursor: string | null;
  nextPageCursor: string | null;
  data: RobloxAPI_GroupRolesetUser[];
}

export interface RobloxAPI_MultiGetUserByNameResponse {
  requestedUsername?: string;
  id?: number;
  name?: string;
  displayName?: string;
}
export interface RobloxAPI_ApiArrayResponse {
  data?: RobloxAPI_MultiGetUserByNameResponse[];
}

export interface BlacklistedGroup {
  id: number;
  name?: string;
  reason?: string;
}

export interface RobloxAPI_Group_ApiArrayResponse {
  data?: RobloxAPI_Group_GroupMembershipResponse[];
}

export interface RobloxAPI_Group_GroupMembershipResponse {
  group?: RobloxAPI_Group_GroupBasicResponse;
  role?: RobloxAPI_Group_GroupRoleBasicResponse;
}

export interface RobloxAPI_Group_GroupBasicResponse {
  id?: number;
  name?: string;
  memberCount?: number;
}

export interface RobloxAPI_Group_GroupRoleBasicResponse {
  id?: number;
  name?: string;
  rank?: number;
}

export interface IndividualTest {
  status: boolean;
  values: {
    pass: any;
    current: any;
  };
  metadata?: any;
  descriptions?: {
    pass: string | null;
    current: string | null;
  };
}

export interface TestStatus {
  [name: string]: IndividualTest;
}

export interface GroupData {
  id: number;
  rolesets: {
    pending: number;
    idc: number;
    citizen: number;
  };
  gamepasses: {
    hcc: {
      id: number;
    };
    firearms: {
      id: number;
    };
  };
  blacklists: {
    docs: {
      users: string;
      groups: string;
    };
  };
}
export interface DefaultAPIResponse {
  user: {
    userId: number;
    username: string;
    groupMembership?: any;
    hccGamepassOwned?: boolean;
    exempt: boolean;
  };
  tests: TestStatus;
  group?: GroupData;
}

export interface CriteriaResponse {
  pass: boolean;
  reason?: string;
}

export interface RankResponse {
  changed: boolean;
  description?: string;
}
