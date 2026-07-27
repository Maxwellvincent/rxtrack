import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import {
  resolveShellChoice,
  shouldClearLocal,
  readQueryShell,
  readLocalShell,
  setLocalShell,
  clearLocalShell,
  SHELL_NEW,
  SHELL_OLD,
  LOCAL_KEY,
} from "./shellSelection.js";

describe("resolveShellChoice precedence", () => {
  it("query beats everything", () => {
    expect(resolveShellChoice({ query: "old", remote: "new", local: "new" })).toEqual({
      shell: SHELL_OLD,
      source: "query",
    });
  });

  it("remote beats local — this is the kill switch", () => {
    expect(resolveShellChoice({ remote: "old", local: "new" })).toEqual({
      shell: SHELL_OLD,
      source: "remote",
    });
    expect(resolveShellChoice({ remote: "new", local: "old" }).shell).toBe(SHELL_NEW);
  });

  it("local beats the default", () => {
    expect(resolveShellChoice({ local: "new" })).toEqual({ shell: SHELL_NEW, source: "local" });
  });

  it("falls back to the default, which is currently the old shell", () => {
    expect(resolveShellChoice({})).toEqual({ shell: SHELL_OLD, source: "default" });
    expect(resolveShellChoice({}, {}).shell).toBe(SHELL_OLD);
    expect(resolveShellChoice({ fallback: SHELL_NEW })).toEqual({ shell: SHELL_NEW, source: "default" });
  });

  it("ignores junk at every level instead of booting something undefined", () => {
    expect(resolveShellChoice({ query: "banana", remote: "", local: null })).toEqual({
      shell: SHELL_OLD,
      source: "default",
    });
    expect(resolveShellChoice({ query: "banana", local: "new" }).source).toBe("local");
  });

  it("accepts the legacy 1/0 encoding the local flag has always used", () => {
    expect(resolveShellChoice({ local: "1" }).shell).toBe(SHELL_NEW);
    expect(resolveShellChoice({ local: "0" }).shell).toBe(SHELL_OLD);
  });
});

describe("shouldClearLocal", () => {
  it("clears only when remote actively disagrees with the stored choice", () => {
    expect(shouldClearLocal({ remote: "old", local: "new" })).toBe(true);
    expect(shouldClearLocal({ remote: "new", local: "new" })).toBe(false);
    expect(shouldClearLocal({ remote: null, local: "new" })).toBe(false);
    expect(shouldClearLocal({ remote: "old", local: null })).toBe(false);
  });
});

describe("flag storage", () => {
  beforeEach(() => installDomStorage());

  it("reads the query string", () => {
    expect(readQueryShell("?shell=new")).toBe(SHELL_NEW);
    expect(readQueryShell("?shell=old")).toBe(SHELL_OLD);
    expect(readQueryShell("?probe=schedule")).toBeNull();
  });

  it("round-trips and clears the local choice", () => {
    setLocalShell(SHELL_NEW);
    expect(localStorage.getItem(LOCAL_KEY)).toBe("1");
    expect(readLocalShell()).toBe(SHELL_NEW);

    setLocalShell(SHELL_OLD);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(readLocalShell()).toBeNull();

    setLocalShell(SHELL_NEW);
    clearLocalShell();
    expect(readLocalShell()).toBeNull();
  });
});

describe("the sticky-state bug this fixes", () => {
  beforeEach(() => installDomStorage());

  it("a remote rollback overrides the sticky local choice and then forgets it", () => {
    setLocalShell(SHELL_NEW);
    const local = readLocalShell();
    const remote = SHELL_OLD;

    expect(resolveShellChoice({ remote, local }).shell).toBe(SHELL_OLD);
    expect(shouldClearLocal({ remote, local })).toBe(true);

    clearLocalShell();
    // Next boot, with the remote flag gone: back to the default, not to "new".
    expect(resolveShellChoice({ local: readLocalShell() })).toEqual({ shell: SHELL_OLD, source: "default" });
  });
});
