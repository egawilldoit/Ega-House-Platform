export type IssueCredentialState = {
  status: "idle" | "success" | "error";
  token: string | null;
  tokenPrefix: string | null;
  errorMessage: string | null;
  attempt: number;
};

export const INITIAL_ISSUE_CREDENTIAL_STATE: IssueCredentialState = {
  status: "idle",
  token: null,
  tokenPrefix: null,
  errorMessage: null,
  attempt: 0,
};
