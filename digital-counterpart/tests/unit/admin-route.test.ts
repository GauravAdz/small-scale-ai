import { beforeEach, describe, expect, it, vi } from "vitest";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/auth", () => ({ isAdmin: admin }));

import { GET, POST } from "@/app/api/admin/content/route";

describe("admin content API", () => {
  beforeEach(() => admin.mockReset());

  it("does not reveal the content list without an owner session", async () => {
    admin.mockResolvedValue(false);
    const response = await GET(new Request("https://example.com/api/admin/content"));
    expect(response.status).toBe(401);
  });

  it("rejects a cross-site publish attempt even with an owner session", async () => {
    admin.mockResolvedValue(true);
    const response = await POST(new Request("https://example.com/api/admin/content", {
      method: "POST",
      headers: { Origin: "https://other.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", path: "data/profile.json", content: "{}" }),
    }));
    expect(response.status).toBe(403);
  });
});
