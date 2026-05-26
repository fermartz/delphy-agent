import { describe, expect, it } from "vitest";
import { parseInput } from "./parser";

describe("parseInput", () => {
  it("parses a plain message as kind: 'message'", () => {
    expect(parseInput("hello world")).toEqual({ kind: "message", text: "hello world" });
  });

  it("parses a command with no args", () => {
    expect(parseInput("/help")).toEqual({ kind: "command", name: "help", args: "" });
  });

  it("parses a command with multi-word args, preserving internal whitespace", () => {
    expect(parseInput("/model foo bar baz")).toEqual({
      kind: "command",
      name: "model",
      args: "foo bar baz",
    });
  });

  it("strips leading whitespace before the command", () => {
    expect(parseInput("  /help")).toEqual({ kind: "command", name: "help", args: "" });
  });

  it("treats a slash mid-line as message content, not a command", () => {
    expect(parseInput("do not /help mid-line")).toEqual({
      kind: "message",
      text: "do not /help mid-line",
    });
  });

  it("treats '//' as a message (no alphanumeric command name)", () => {
    expect(parseInput("//")).toEqual({ kind: "message", text: "//" });
  });

  it("treats '/ ' (slash + whitespace) as a message, preserving the verbatim text", () => {
    expect(parseInput("/ ")).toEqual({ kind: "message", text: "/ " });
  });

  it("treats '///' as a message", () => {
    expect(parseInput("///")).toEqual({ kind: "message", text: "///" });
  });
});
