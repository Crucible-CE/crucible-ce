// @vitest-environment node
import { describe, expect, it } from "vitest";
import { launchHref, templateHref } from "./labels";

describe("templateHref", () => {
  it("opens each mode in its editor", () => {
    expect(templateHref({ id: "t1", mode: "crisissim", branching: "linear", status: "draft" })).toBe("/templates/t1");
    expect(templateHref({ id: "t1", mode: "strategic", branching: "linear", status: "draft" })).toBe("/studio/t1");
    expect(templateHref({ id: "t1", mode: "strategic", branching: "branched", status: "published" })).toBe("/studio/t1");
    expect(templateHref({ id: "t1", mode: "document", branching: "linear", status: "draft" })).toBe("/documents/templates/t1");
    expect(templateHref({ id: "t1", mode: "document", branching: "branched", status: "published" })).toBe("/studio/t1");
  });
});

describe("launchHref", () => {
  it("preselects the template in the right create flow", () => {
    expect(launchHref({ id: "lib-a", mode: "strategic" })).toBe("/strategic/new?templateId=lib-a");
    expect(launchHref({ id: "t1", mode: "document" })).toBe("/exercises/new?mode=document&templateId=t1");
    expect(launchHref({ id: "t1", mode: "crisissim" })).toBe("/exercises/new?mode=crisissim&templateId=t1");
  });
});
