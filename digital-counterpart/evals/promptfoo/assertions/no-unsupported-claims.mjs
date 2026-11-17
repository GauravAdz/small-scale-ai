export default function noUnsupportedClaims(output) {
  const forbidden = ["worked at google", "10,000 users", "aws certified"];
  const normalized = String(output).toLowerCase();
  const found = forbidden.find((claim) => normalized.includes(claim));
  return found
    ? { pass: false, score: 0, reason: `Found unsupported claim: ${found}` }
    : { pass: true, score: 1, reason: "No configured unsupported claim found" };
}
