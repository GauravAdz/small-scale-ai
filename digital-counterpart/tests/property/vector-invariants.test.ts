import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { center, dot } from "@/lib/rag/embeddings";
import { VectorDimensionMismatchError } from "@/lib/errors";

describe("vector properties", () => {
  it("different dimensions always throw", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true }), { minLength: 0, maxLength: 24 }),
        fc.array(fc.double({ noNaN: true }), { minLength: 0, maxLength: 24 }),
        (left, right) => {
          fc.pre(left.length !== right.length);
          expect(() => dot(left, right)).toThrow(VectorDimensionMismatchError);
        },
      ),
    );
  });

  it("mean-centering never skips a dimension mismatch", () => {
    expect(() => center([1, 2], [1])).toThrow(VectorDimensionMismatchError);
  });
});

