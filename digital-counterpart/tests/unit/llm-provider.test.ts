import { describe, expect, it, vi } from "vitest";
import type { createAzure } from "@ai-sdk/azure";
import type { LanguageModel } from "ai";

import type { AzureModelRoleConfig } from "@/lib/config";
import { createAzureModel, getProviderOptions } from "@/lib/llm/provider";

describe("Azure model provider contract", () => {
  it("passes the Azure resource, key, API version, and deployment separately", () => {
    const model = { specificationVersion: "v4" } as unknown as LanguageModel;
    const provider = vi.fn(() => model);
    const factory = vi.fn(() => provider) as unknown as typeof createAzure;
    const role: AzureModelRoleConfig = {
      provider: "azure",
      model: "gauravgpt-gpt54",
      apiKey: "azure-secret",
      resourceName: "gauravgpt-resource",
      apiVersion: "v1",
    };

    expect(createAzureModel(role, factory)).toBe(model);
    expect(factory).toHaveBeenCalledWith({
      resourceName: "gauravgpt-resource",
      apiKey: "azure-secret",
      apiVersion: "v1",
    });
    expect(provider).toHaveBeenCalledWith("gauravgpt-gpt54");
    expect(getProviderOptions(role)).toBeUndefined();
  });
});
