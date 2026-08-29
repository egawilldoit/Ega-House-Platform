import type {
  ApplyOperatorProposalRequest,
  ApplyOperatorProposalResponse,
  ApproveOperatorProposalResponse,
  CreateOperatorProposalRequest,
  CreateOperatorProposalResponse,
  DismissOperatorProposalResponse,
  GetOperatorProposalResponse,
  ListOperatorProposalsResponse,
  ReviseOperatorProposalRequest,
  ReviseOperatorProposalResponse,
} from "@ega/contracts/operator";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type OperatorApi = {
  create(input: CreateOperatorProposalRequest): Promise<ApiResult<CreateOperatorProposalResponse>>;
  revise(proposalId: string, input: ReviseOperatorProposalRequest): Promise<ApiResult<ReviseOperatorProposalResponse>>;
  approve(proposalId: string): Promise<ApiResult<ApproveOperatorProposalResponse>>;
  apply(proposalId: string, input?: ApplyOperatorProposalRequest): Promise<ApiResult<ApplyOperatorProposalResponse>>;
  dismiss(proposalId: string): Promise<ApiResult<DismissOperatorProposalResponse>>;
  get(proposalId: string): Promise<ApiResult<GetOperatorProposalResponse>>;
  list(params?: { localDate?: string; status?: string; limit?: number }): Promise<ApiResult<ListOperatorProposalsResponse>>;
};

function encoded(id: string) {
  return encodeURIComponent(id);
}

export function createOperatorApi(http: HttpClient): OperatorApi {
  return {
    create(input) {
      return http.request<CreateOperatorProposalResponse>({
        path: "/api/operator/proposals",
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      });
    },
    revise(proposalId, input) {
      return http.request<ReviseOperatorProposalResponse>({
        path: `/api/operator/proposals/${encoded(proposalId)}/revise`,
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      });
    },
    approve(proposalId) {
      return http.request<ApproveOperatorProposalResponse>({
        path: `/api/operator/proposals/${encoded(proposalId)}/approve`,
        method: "POST",
      });
    },
    apply(proposalId, input) {
      return http.request<ApplyOperatorProposalResponse>({
        path: `/api/operator/proposals/${encoded(proposalId)}/apply`,
        method: "POST",
        ...(input ? { body: input as unknown as Record<string, unknown> } : {}),
      });
    },
    dismiss(proposalId) {
      return http.request<DismissOperatorProposalResponse>({
        path: `/api/operator/proposals/${encoded(proposalId)}/dismiss`,
        method: "POST",
      });
    },
    get(proposalId) {
      return http.request<GetOperatorProposalResponse>({
        path: `/api/operator/proposals/${encoded(proposalId)}`,
      });
    },
    list(params) {
      return http.request<ListOperatorProposalsResponse>({
        path: "/api/operator/proposals",
        query: params as Record<string, string> | undefined,
      });
    },
  };
}
