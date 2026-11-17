import { generateText, Output } from "ai";
import { z } from "zod";

import { answerPortfolioQuestion } from "../src/lib/chat/pipeline";
import { assertChatReady, readEnv } from "../src/lib/config";
import { loadProfile, loadProjects } from "../src/lib/knowledge/loader";
import { getModel, getProviderOptions } from "../src/lib/llm/provider";
import { Retriever } from "../src/lib/rag/retriever";

const landingPrompt = "Give me the 30-second version of Gaurav's background.";

async function main(): Promise<void> {
  const env = readEnv();
  const role = env.models.verifier;
  if (role.provider !== "azure") {
    throw new Error("smoke:azure requires LLM_VERIFIER_PROVIDER=azure.");
  }
  assertChatReady(role);

  const result = await generateText({
    model: getModel(role),
    output: Output.object({
      name: "azure_connectivity_check",
      schema: z.object({ ok: z.literal(true) }),
    }),
    prompt: "Return an object with ok set to true.",
    maxOutputTokens: 40,
    providerOptions: getProviderOptions(role),
  });
  if (!result.output.ok) throw new Error("Azure structured-output check failed.");

  const outcome = await answerPortfolioQuestion({
    question: landingPrompt,
    history: [],
    profile: loadProfile(),
    projects: loadProjects(),
    env,
    retriever: Retriever.fromIndexFile(undefined, env),
  });
  if (outcome.kind !== "answer" || outcome.answer.support !== "supported") {
    throw new Error("The landing-page background prompt was not supported.");
  }
  const sources = new Set(outcome.answer.citations.map(({ source }) => source));
  if (!sources.has("data/profile.json") || !sources.has("data/experience.md")) {
    throw new Error("The landing-page background prompt is missing profile/experience citations.");
  }

  console.log(`Azure verifier ready: ${role.provider}:${role.model}`);
  console.log("Landing prompt: supported with profile and experience citations.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Azure smoke check failed.");
  process.exit(1);
});
