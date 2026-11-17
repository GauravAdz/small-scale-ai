import type { EnvConfig } from "@/lib/config";
import {
  EmbeddingFingerprintMismatchError,
  EvidenceVerificationError,
  ProviderUnavailableError,
  StaleKnowledgeIndexError,
  KnowledgeSchemaError,
  VectorDimensionMismatchError,
  VerificationBudgetExceededError,
} from "@/lib/errors";

export const VERIFICATION_UNAVAILABLE_MESSAGE = "I couldn't verify that answer right now. You can still explore Gaurav's projects or contact him directly.";

export function publicChatErrorMessage(error: unknown): string {
  return error instanceof VerificationBudgetExceededError
    ? "That's more than I can verify in one answer. Ask about one project or topic at a time."
    : VERIFICATION_UNAVAILABLE_MESSAGE;
}

function fail(message: string, status: number, headers?: HeadersInit): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

export function chatErrorResponse(
  error: unknown,
  requestId = "unassigned",
  env?: EnvConfig,
): Response {
  if (error instanceof ProviderUnavailableError || error instanceof EvidenceVerificationError) {
    console.error("[chat] evidence verifier unavailable", {
      request_id: requestId,
      provider: error instanceof ProviderUnavailableError
        ? error.provider
        : env?.models.verifier.provider,
      model: error instanceof ProviderUnavailableError
        ? error.model
        : env?.models.verifier.model,
      error_class: error.name,
      error_reason: error.message,
      upstream_error_class: error instanceof ProviderUnavailableError
        ? error.upstreamErrorClass
        : undefined,
      error_code: error instanceof ProviderUnavailableError ? error.code : error.name,
      provider_request_id: error instanceof ProviderUnavailableError ? error.requestId : undefined,
      retryable: error instanceof ProviderUnavailableError ? error.retryable : false,
    });
    return fail(
      publicChatErrorMessage(error),
      503,
      error instanceof ProviderUnavailableError && error.retryable !== false
        ? { "Retry-After": "30" }
        : undefined,
    );
  }

  console.error("[chat] request failed", {
    request_id: requestId,
    error_class: error instanceof Error ? error.name : "unknown",
  });
  if (error instanceof StaleKnowledgeIndexError) {
    return fail(publicChatErrorMessage(error), 503);
  }
  if (error instanceof EmbeddingFingerprintMismatchError || error instanceof KnowledgeSchemaError || error instanceof VectorDimensionMismatchError) {
    return fail(publicChatErrorMessage(error), 503);
  }
  return fail(publicChatErrorMessage(error), error instanceof VerificationBudgetExceededError ? 422 : 500);
}
