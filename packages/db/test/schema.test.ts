import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, schema } from "../src/client.ts";
import { createUser, makeWorkspace } from "./helpers.ts";

const asset = (workspaceId: string, appId: string | null, sha256: string) => ({
  workspaceId, appId, sha256, kind: "screenshot" as const, storagePath: `${workspaceId}/${sha256}`, mime: "image/png", bytes: 10,
});

describe("assets uniqueness", () => {
  it("dedupes per (workspace, app, sha256), nulls not distinct", async () => {
    const user = await createUser();
    const ws = await makeWorkspace(user.id);
    const [a1, a2] = await db.insert(schema.apps).values([{ workspaceId: ws, name: "A" }, { workspaceId: ws, name: "B" }]).returning();
    const sha = randomUUID();

    await db.insert(schema.assets).values(asset(ws, a1!.id, sha));
    await expect(db.insert(schema.assets).values(asset(ws, a1!.id, sha))).rejects.toThrow();
    await db.insert(schema.assets).values(asset(ws, a2!.id, sha));

    await db.insert(schema.assets).values(asset(ws, null, sha));
    await expect(db.insert(schema.assets).values(asset(ws, null, sha))).rejects.toThrow();
  });
});
