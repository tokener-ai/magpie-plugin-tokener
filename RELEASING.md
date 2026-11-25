# Releases

`package.json` is the version source for `@tokener-ai/magpie-plugin-tokener`.
This plugin uses the L2 release tier because it integrates with a plugin host.
Use beta and release candidates before a new stable version.
The existing `0.1.2` npm release is the changelog baseline. Do not republish it or move its tag.

Use `X.Y.Z` for stable versions and `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, or `X.Y.Z-rc.N` for prereleases.
The gate accepts nonnegative integers without leading zeros, including prerelease sequence zero.
Increase the version for each publication. During `0.y.z`, increase MINOR for incompatible changes.
Keep the public plugin API and configuration compatible across two minor releases before `1.0.0`.

Before the first automated publication, configure an npm Trusted Publisher for this repository and `.github/workflows/release.yml`.
The workflow uses Node 24, npm 11.21.2, and `id-token: write` for that authentication path.
Alternatively, provide a GitHub Actions secret named `NPM_TOKEN` with permission to publish this package.
The workflow creates token authentication only when that secret is present.

1. Set the next version in `package.json`.
2. Run `git-cliff --unreleased --tag "v$(node -p 'require("./package.json").version')" --prepend CHANGELOG.md`.
3. Edit the generated section to describe the release. Keep its exact `## v<version>` heading and a nonempty body.
4. Run `node scripts/release.mjs preflight "v$(node -p 'require("./package.json").version')"`.
5. Run `bun test` and `bun run check`.
6. Merge the release changes into `main` through a reviewed PR.
7. After explicit release authorization, create and push the matching `v<version>` tag at that commit.

The tag workflow validates the version, changelog, and commit ancestry before it runs the test and package gates.
The registry gate rejects an existing npm version and stops on failed or invalid registry responses.
Prereleases publish to their `alpha`, `beta`, or `rc` npm channel. Stable versions publish to `latest`.
GitHub Releases combine the changelog section with generated notes. Prereleases never become the latest GitHub Release.

If npm publication fails, inspect the registry before retrying. Do not reuse a published version.
If only GitHub Release creation fails after npm publication, rerun only the failed Release job.
That retry preserves the successful publish job. Rerunning all jobs stops at the registry immutability gate.
