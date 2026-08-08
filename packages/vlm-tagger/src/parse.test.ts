import { describe, expect, it } from "vitest";
import { VlmParseError, parseVlmResponse } from "./parse.js";

describe("parseVlmResponse", () => {
  it("parses a clean JSON object", () => {
    const result = parseVlmResponse(
      '{"tags": ["box", "cardboard"], "caption": "A cardboard box."}',
    );
    expect(result).toEqual({ tags: ["box", "cardboard"], caption: "A cardboard box." });
  });

  it("lowercases and trims tags, and trims the caption", () => {
    const result = parseVlmResponse('{"tags": [" Box ", "CARDBOARD"], "caption": "  A box.  "}');
    expect(result.tags).toEqual(["box", "cardboard"]);
    expect(result.caption).toBe("A box.");
  });

  it("includes readableText when present and non-empty", () => {
    const result = parseVlmResponse(
      '{"tags": ["box"], "caption": "A box.", "readableText": "SKU-1234"}',
    );
    expect(result.readableText).toBe("SKU-1234");
  });

  it("omits readableText when absent", () => {
    const result = parseVlmResponse('{"tags": ["box"], "caption": "A box."}');
    expect(result.readableText).toBeUndefined();
  });

  it("omits readableText when it is an empty/whitespace string", () => {
    const result = parseVlmResponse(
      '{"tags": ["box"], "caption": "A box.", "readableText": "   "}',
    );
    expect(result.readableText).toBeUndefined();
  });

  it("strips a markdown JSON code fence around the object", () => {
    const text = '```json\n{"tags": ["box"], "caption": "A box."}\n```';
    const result = parseVlmResponse(text);
    expect(result.tags).toEqual(["box"]);
  });

  it("extracts the object even with stray prose before/after it", () => {
    const text = 'Sure, here you go:\n{"tags": ["box"], "caption": "A box."}\nHope that helps!';
    const result = parseVlmResponse(text);
    expect(result.caption).toBe("A box.");
  });

  it("throws VlmParseError when there is no JSON object at all", () => {
    expect(() => parseVlmResponse("I cannot tag this image.")).toThrow(VlmParseError);
  });

  it("throws VlmParseError on syntactically invalid JSON", () => {
    expect(() => parseVlmResponse('{"tags": ["box",], "caption": "A box."}')).toThrow(
      VlmParseError,
    );
  });

  it("throws VlmParseError when tags is missing", () => {
    expect(() => parseVlmResponse('{"caption": "A box."}')).toThrow(VlmParseError);
  });

  it("throws VlmParseError when tags is an empty array", () => {
    expect(() => parseVlmResponse('{"tags": [], "caption": "A box."}')).toThrow(VlmParseError);
  });

  it("throws VlmParseError when a tag normalizes to an empty string", () => {
    expect(() => parseVlmResponse('{"tags": ["box", "   "], "caption": "A box."}')).toThrow(
      VlmParseError,
    );
  });

  it("throws VlmParseError when tags contains a non-string element", () => {
    expect(() => parseVlmResponse('{"tags": ["box", 5], "caption": "A box."}')).toThrow(
      VlmParseError,
    );
  });

  it("throws VlmParseError when caption is missing", () => {
    expect(() => parseVlmResponse('{"tags": ["box"]}')).toThrow(VlmParseError);
  });

  it("throws VlmParseError when caption is an empty string", () => {
    expect(() => parseVlmResponse('{"tags": ["box"], "caption": "  "}')).toThrow(VlmParseError);
  });

  it("throws VlmParseError when readableText is present but not a string", () => {
    expect(() =>
      parseVlmResponse('{"tags": ["box"], "caption": "A box.", "readableText": 123}'),
    ).toThrow(VlmParseError);
  });
});
