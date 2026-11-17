export class KnowledgeSchemaError extends Error {
  override readonly name = "KnowledgeSchemaError";
}

export class StaleKnowledgeIndexError extends Error {
  override readonly name = "StaleKnowledgeIndexError";
}

export class EmbeddingFingerprintMismatchError extends Error {
  override readonly name = "EmbeddingFingerprintMismatchError";
}

export class VectorDimensionMismatchError extends Error {
  override readonly name = "VectorDimensionMismatchError";

  constructor(readonly left: number, readonly right: number) {
    super(`Vector dimensions differ (${left} !== ${right}).`);
  }
}

export class EvidenceVerificationError extends Error {
  override readonly name = "EvidenceVerificationError";
}

export class VerificationBudgetExceededError extends Error {
  override readonly name = "VerificationBudgetExceededError";
}

export class SemanticRecoveryInvalidError extends Error {
  override readonly name = "SemanticRecoveryInvalidError";

  constructor(
    message: string,
    readonly reason:
      | "schema_parse_failure"
      | "invalid_intent_target_pair"
      | "unknown_project_slug"
      | "invalid_channel"
      | "invalid_aspect"
      | "invalid_confidence"
      | "other_validation_failure" = "other_validation_failure",
  ) {
    super(message);
  }
}

export class SemanticRecoveryUnavailableError extends Error {
  override readonly name = "SemanticRecoveryUnavailableError";

  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ProviderFailureDetails = Readonly<{
  provider?: string;
  model?: string;
  code?: string;
  requestId?: string;
  retryable?: boolean;
  upstreamErrorClass?: string;
}>;

export class ProviderUnavailableError extends Error {
  override readonly name = "ProviderUnavailableError";

  readonly provider?: string;
  readonly model?: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable?: boolean;
  readonly upstreamErrorClass?: string;

  constructor(
    message: string,
    details: ProviderFailureDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.provider = details.provider;
    this.model = details.model;
    this.code = details.code;
    this.requestId = details.requestId;
    this.retryable = details.retryable;
    this.upstreamErrorClass = details.upstreamErrorClass;
  }
}
