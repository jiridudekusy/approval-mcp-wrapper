declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & {
  readonly [brand]: Name;
};

export type AdminId = Brand<string, 'AdminId'>;
export type ApprovalId = Brand<string, 'ApprovalId'>;
export type CallId = Brand<string, 'CallId'>;
export type ClientTokenId = Brand<string, 'ClientTokenId'>;
export type GrantId = Brand<string, 'GrantId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type ProfileRuleId = Brand<string, 'ProfileRuleId'>;
export type TokenProfileAssignmentId = Brand<string, 'TokenProfileAssignmentId'>;
export type UpstreamId = Brand<string, 'UpstreamId'>;
