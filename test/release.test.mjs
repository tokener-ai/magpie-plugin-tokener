import { expect, test } from "bun:test";
import { checkRegistry, prepareRelease } from "../scripts/release.mjs";

const name = "@tokener-ai/magpie-plugin-tokener";
const prepare = (tag, version = tag.slice(1), changelog = `# Changelog\n\n## ${tag}\n\n- Release content.\n\n## v0.0.1\n\n- Older content.\n`) =>
  prepareRelease(tag, { name, version }, changelog);

test("stable and each prerelease use their own publication channel and notes", () => {
  for (const [tag, distTag] of [["v0.2.0", "latest"], ["v0.2.0-alpha.0", "alpha"], ["v0.2.0-beta.2", "beta"], ["v0.2.0-rc.10", "rc"]]) {
    expect(prepare(tag)).toEqual({ name, version: tag.slice(1), distTag, prerelease: distTag !== "latest", notes: "- Release content." });
  }
});

test("invalid release identities stop before publication", () => {
  for (const tag of ["0.2.0", "v01.2.3", "v1.02.3", "v1.2.03", "v1.2.3-beta.01", "v1.2.3-beta", "v1.2.3-stage.1", "v1.2.3+build", "v1.2.3\n", "v1.2.3;echo unsafe"]) {
    expect(() => prepare(tag)).toThrow("Invalid release tag");
  }
  expect(() => prepare("v0.2.0", "0.1.2")).toThrow("package.json version");
  expect(() => prepareRelease("v0.2.0", { name: "other-package", version: "0.2.0" }, "## v0.2.0\nNotes")).toThrow("package name");
});

test("missing, duplicate, and empty changelog sections stop publication", () => {
  for (const changelog of ["## v0.1.2\nOld notes", "## v0.2.0\n\n## v0.1.2\nOld notes", "## v0.2.0\n<!-- empty -->", "## v0.2.0\nNotes\n## v0.2.0\nDuplicate"]) {
    expect(() => prepare("v0.2.0", "0.2.0", changelog)).toThrow();
  }
  expect(prepare("v0.2.0", "0.2.0", "## v0.2.0\r\n\r\n- Notes.\r\n").notes).toBe("- Notes.");
});

test("registry permits only unpublished versions with valid metadata", async () => {
  const release = prepare("v0.2.0");
  const lookup = (metadata, status = 200) => async (url) => {
    expect(url).toBe("https://registry.npmjs.org/%40tokener-ai%2Fmagpie-plugin-tokener");
    return Response.json(metadata, { status });
  };
  await checkRegistry(release, lookup({ name, versions: { "0.1.2": {} } }));
  await expect(checkRegistry(release, lookup({ name, versions: { "0.2.0": {} } }))).rejects.toThrow("already published");
  for (const status of [404, 429, 500]) {
    await expect(checkRegistry(release, lookup({ name, versions: {} }, status))).rejects.toThrow();
  }
  for (const metadata of [{}, { name, versions: [] }, { name: "other-package", versions: {} }]) {
    await expect(checkRegistry(release, lookup(metadata))).rejects.toThrow("Invalid registry metadata");
  }
  await expect(checkRegistry(release, async () => { throw new Error("Network unavailable"); })).rejects.toThrow("Network unavailable");
});
