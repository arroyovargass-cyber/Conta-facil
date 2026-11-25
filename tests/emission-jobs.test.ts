import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { EmissionJobs } from "../apps/api/src/services/emission-jobs";

describe("emission queue environment selection", () => {
  it("does not open a lease or expire work when all environments are disabled", async () => {
    const connect = vi.fn(() => {
      throw new Error("A disabled queue must not connect");
    });
    const queue = new EmissionJobs({ connect } as unknown as pg.Pool);
    expect(await queue.claim(1, [])).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an unknown environment before opening a connection", async () => {
    const connect = vi.fn(() => {
      throw new Error("Invalid environments must not connect");
    });
    const queue = new EmissionJobs({ connect } as unknown as pg.Pool);
    await expect(queue.claim(1, ["sandbox" as "test"])).rejects.toThrow(
      "INVALID_JOB_ENVIRONMENTS",
    );
    expect(connect).not.toHaveBeenCalled();
  });
  it("rejects unsupported trust policy filters before opening a connection", async () => {
    const connect = vi.fn();
    const queue = new EmissionJobs({ connect } as unknown as pg.Pool);
    await expect(
      queue.claim(1, ["test"], { test: ["trust_anything" as "official_api"] }),
    ).rejects.toThrow("INVALID_JOB_TRUST_POLICIES");
    expect(connect).not.toHaveBeenCalled();
  });
});
