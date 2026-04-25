import { describe, expect, it } from "vitest";
import {
  projectDisplayNameFromProjectId,
  projectIconPlaceholderLabelFromDisplayName,
} from "./project-display-name";

describe("projectDisplayNameFromProjectId", () => {
  it("shows owner and repo for GitHub remote ids", () => {
    expect(projectDisplayNameFromProjectId("remote:github.com/ottie/ottie")).toBe(
      "ottie/ottie",
    );
  });

  it("shows the trailing directory name for local projects", () => {
    expect(projectDisplayNameFromProjectId("/Users/me/dev/ottie")).toBe("ottie");
  });
});

describe("projectIconPlaceholderLabelFromDisplayName", () => {
  it("uses repo name instead of owner for GitHub-style display names", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("ottie/ottie")).toBe("ottie");
  });

  it("returns the original display name when it has no path separator", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("ottie")).toBe("ottie");
  });
});
