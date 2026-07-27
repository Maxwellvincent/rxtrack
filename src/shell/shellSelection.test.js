import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import {
  resolveShellChoice,
  localFlagAfterRemote,
  readQueryShell,
  readLocalShell,
  setLocalShell,
  clearLocalShell,
  SHELL_NEW,
  SHELL_OLD,
  LOCAL_KEY,
  DEFAULT_SHELL,
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

  it("falls back to the default, which is now the new shell", () => {
    expect(resolveShellChoice({})).toEqual({ shell: DEFAULT_SHELL, source: "default" });
    expect(DEFAULT_SHELL).toBe(SHELL_NEW);
    expect(resolveShellChoice({ fallback: SHELL_OLD })).toEqual({ shell: SHELL_OLD, source: "default" });
  });

  it("ignores junk at every level instead of booting something undefined", () => {
    expect(resolveShellChoice({ query: "banana", remote: "", local: null })).toEqual({
      shell: DEFAULT_SHELL,
      source: "default",
    });
    expect(resolveShellChoice({ query: "banana", local: "old" }).source).toBe("local");
  });

  it("accepts the legacy 1/0 encoding the local flag has always used", () => {
    expect(resolveShellChoice({ local: "1" }).shell).toBe(SHELL_NEW);
    expect(resolveShellChoice({ local: "0" }).shell).toBe(SHELL_OLD);
  });
});

describe("localFlagAfterRemote", () => {
  it("writes the remote decision down when it disagrees", () => {
    expect(localFlagAfterRemote({ remote: "old", local: "new" })).toBe(SHELL_OLD);
    expect(localFlagAfterRemote({ remote: "new", local: "old" })).toBe(SHELL_NEW);
    expect(localFlagAfterRemote({ remote: "old", local: null })).toBe(SHELL_OLD);
  });

  it("changes nothing when the remote has no opinion or already agrees", () => {
    expect(localFlagAfterRemote({ remote: null, local: "new" })).toBeNull();
    expect(localFlagAfterRemote({ remote: "new", local: "new" })).toBeNull();
  });
});

describe("flag storage", () => {
  beforeEach(() => installDomStorage());

  it("reads the query string", () => {
    expect(readQueryShell("?shell=new")).toBe(SHELL_NEW);
    expect(readQueryShell("?shell=old")).toBe(SHELL_OLD);
    expect(readQueryShell("?probe=schedule")).toBeNull();
  });

  it("persists BOTH choices — an absent key now means the new shell", () => {
    setLocalShell(SHELL_NEW);
    expect(localStorage.getItem(LOCAL_KEY)).toBe("1");
    expect(readLocalShell()).toBe(SHELL_NEW);

    // Post-flip this has to be storable: removing the key would fall through
    // to the default, which is exactly the shell the user opted out of.
    setLocalShell(SHELL_OLD);
    expect(localStorage.getItem(LOCAL_KEY)).toBe("0");
    expect(readLocalShell()).toBe(SHELL_OLD);
    expect(resolveShellChoice({ local: readLocalShell() })).toEqual({ shell: SHELL_OLD, source: "local" });

    clearLocalShell();
    expect(readLocalShell()).toBeNull();
    expect(resolveShellChoice({ local: readLocalShell() }).shell).toBe(DEFAULT_SHELL);
  });

  it("keeps ?shell=old sticky across a plain reload", () => {
    setLocalShell(readQueryShell("?shell=old"));
    expect(resolveShellChoice({ local: readLocalShell() }).shell).toBe(SHELL_OLD);
  });
});

describe("rollback survives the remote flag being removed", () => {
  beforeEach(() => installDomStorage());

  it("a remote rollback overrides the sticky choice AND is written down", () => {
    setLocalShell(SHELL_NEW);
    const local = readLocalShell();
    const remote = SHELL_OLD;

    expect(resolveShellChoice({ remote, local }).shell).toBe(SHELL_OLD);

    const next = localFlagAfterRemote({ remote, local });
    expect(next).toBe(SHELL_OLD);
    setLocalShell(next);

    // The point: with the remote flag later cleared, the user stays on the old
    // shell instead of falling through the default back into the rolled-back one.
    expect(resolveShellChoice({ local: readLocalShell() })).toEqual({ shell: SHELL_OLD, source: "local" });
  });

  it("and rolling forward again works the same way", () => {
    setLocalShell(SHELL_OLD);
    setLocalShell(localFlagAfterRemote({ remote: SHELL_NEW, local: readLocalShell() }));
    expect(resolveShellChoice({ local: readLocalShell() }).shell).toBe(SHELL_NEW);
  });
});
