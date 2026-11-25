import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function prepareRelease(tag, pkg, changelog) {
  const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/.exec(tag);
  if (!match || match[0] !== tag) throw new Error("Invalid release tag.");
  const version = tag.slice(1);
  if (pkg.name !== "@tokener-ai/magpie-plugin-tokener") throw new Error("Unexpected package name.");
  if (pkg.version !== version) throw new Error("The tag must match package.json version.");
  const lines = changelog.split(/\r?\n/);
  const headings = lines.flatMap((line, index) => line === `## ${tag}` ? [index] : []);
  if (headings.length !== 1) throw new Error("CHANGELOG.md must contain exactly one heading for the release tag.");
  const start = headings[0] + 1;
  const next = lines.findIndex((line, index) => index >= start && /^## /.test(line));
  const notes = lines.slice(start, next < 0 ? undefined : next).join("\n").trim();
  if (!notes.replace(/<!--[\s\S]*?-->/g, "").trim()) throw new Error("The changelog section must not be empty.");
  return { name: pkg.name, version, distTag: match[5] ?? "latest", prerelease: Boolean(match[5]), notes };
}

export async function checkRegistry(release, fetchRegistry = fetch) {
  const response = await fetchRegistry(`https://registry.npmjs.org/${encodeURIComponent(release.name)}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Registry lookup failed: ${response.status}`);
  const metadata = await response.json();
  if (metadata.name !== release.name || !metadata.versions || typeof metadata.versions !== "object" || Array.isArray(metadata.versions)) {
    throw new Error("Invalid registry metadata.");
  }
  if (Object.hasOwn(metadata.versions, release.version)) throw new Error("This npm version is already published. Use a new version.");
}

if (import.meta.main) {
  try {
    const [mode, tag] = process.argv.slice(2);
    if (!["preflight", "registry"].includes(mode)) throw new Error("Use preflight or registry with a release tag.");
    const release = prepareRelease(tag, JSON.parse(readFileSync("package.json", "utf8")), readFileSync("CHANGELOG.md", "utf8"));
    if (mode === "registry") await checkRegistry(release);
    if (mode === "preflight") {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${release.version}\ndist_tag=${release.distTag}\nprerelease=${release.prerelease}\n`);
      if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, "release-notes.md"), `${release.notes}\n`);
    }
    console.log(`${mode}: ${release.name}@${release.version} -> ${release.distTag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
