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
    pass: string;
    current: string;
  };
}

export type CombinedTestResults = Record<string, IndividualTest>;

export interface DefaultAPIResponse {
  user: {
    userId: number;
    username: string;
    groupMembership?: any;
    hccGamepassOwned?: boolean;
    exempt: boolean;
  };
  tests: CombinedTestResults;
}

export interface CriteriaResponse {
  pass: boolean;
  reason?: string;
}

export interface RankResponse {
  changed: boolean;
  description?: string;
}
