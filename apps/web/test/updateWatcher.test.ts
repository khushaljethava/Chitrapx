import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRefreshGuard, setRefreshGuard } from "@/lib/refreshGuard.ts";
import { watchForUpdate } from "@/lib/updateWatcher.ts";

const MIN = 60_000;

describe("update watcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(ids: Array<string | Error>) {
    const fetchBuildId = vi.fn(async () => { const next = ids.shift() ?? "same"; if (next instanceof Error) throw next; return next; });
    const onUpdate = vi.fn();
    let visible: (() => void) | null = null;
    const w = watchForUpdate({ current: "same", fetchBuildId, onUpdate, subscribeVisible: (cb) => { visible = cb; return () => { visible = null; }; } });
    return { w, fetchBuildId, onUpdate, fireVisible: () => visible?.(), isSubscribed: () => visible !== null };
  }

  it("checks 30 s after load, then every 5 minutes; the same id never fires", async () => {
    const { w, fetchBuildId, onUpdate } = setup([]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchBuildId).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchBuildId).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(fetchBuildId).toHaveBeenCalledTimes(2);
    expect(onUpdate).not.toHaveBeenCalled();
    w.stop();
  });

  it("reports a new id once and stops polling and listening", async () => {
    const { fetchBuildId, onUpdate, isSubscribed } = setup(["new-build"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onUpdate).toHaveBeenCalledWith("new-build");
    expect(isSubscribed()).toBe(false);
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(fetchBuildId).toHaveBeenCalledTimes(1);
  });

  it("checks right away when the tab becomes visible", async () => {
    const { fetchBuildId, onUpdate, fireVisible } = setup(["same", "next"]);
    fireVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuildId).toHaveBeenCalledTimes(1);
    fireVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledWith("next");
  });

  it("ignores network errors and empty answers, and keeps polling", async () => {
    const { fetchBuildId, onUpdate } = setup([new Error("offline"), ""]);
    await vi.advanceTimersByTimeAsync(30_000 + 5 * MIN);
    expect(fetchBuildId).toHaveBeenCalledTimes(2);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("checkNow runs one check on demand (a failed chunk load)", async () => {
    const { w, onUpdate } = setup(["fresh"]);
    w.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledWith("fresh");
  });

  it("stop() cancels everything", async () => {
    const { w, fetchBuildId, isSubscribed } = setup([]);
    w.stop();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(fetchBuildId).not.toHaveBeenCalled();
    expect(isSubscribed()).toBe(false);
  });
});

describe("refresh guard", () => {
  afterEach(() => setRefreshGuard(null));

  it("is true when nothing is registered", async () => {
    expect(await runRefreshGuard()).toBe(true);
  });
  it("awaits the registered guard (the editor's save) and reports its answer", async () => {
    setRefreshGuard(async () => false);
    expect(await runRefreshGuard()).toBe(false);
    setRefreshGuard(async () => true);
    expect(await runRefreshGuard()).toBe(true);
  });
  it("a guard that throws counts as not saved", async () => {
    setRefreshGuard(async () => { throw new Error("x"); });
    expect(await runRefreshGuard()).toBe(false);
  });
});
