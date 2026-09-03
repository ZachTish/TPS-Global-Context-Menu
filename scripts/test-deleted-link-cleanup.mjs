import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import ts from "typescript";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function extractMethod(source, methodName, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === methodName) {
      method = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(method, `Missing ${methodName} in ${sourcePath}`);
  return method;
}

async function importMatcher() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/deleted-link-cleanup.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

async function importCleanupHarness() {
  const sourcePath = fileURLToPath(new URL("../src/services/bulk-edit-service.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const cleanupMethod = extractMethod(source, "cleanupLinksForDeletedFile", sourcePath);
  const runMethod = extractMethod(source, "runDeletedLinkCleanup", sourcePath);
  const virtualSource = `
    import {
      classifyDeletedMarkdownLink,
      createDeletedMarkdownLinkContext,
    } from './src/utils/deleted-link-cleanup.ts';
    import {
      canAutomaticallyMutateTemplateFile,
      canAutomaticallyMutateTemplateFrontmatter,
      canAutomaticallyMutateTemplateSource,
    } from './src/utils/template-protection.ts';

    export class TFile {
      constructor(path) {
        this.path = path;
        this.name = path.split('/').pop() || path;
        this.basename = this.name.replace(/\\.[^.]+$/u, '');
        this.extension = this.name.includes('.') ? this.name.split('.').pop().toLowerCase() : '';
        this.stat = { ctime: 1, mtime: 1, size: 0 };
      }
    }

    function extractTarget(value) {
      const raw = String(value ?? '').trim();
      const wiki = raw.match(/^!?\\[\\[([^\\]]+)\\]\\]$/u);
      const markdown = raw.match(/^!?\\[[^\\]]*\\]\\(([^)]+)\\)$/u);
      return String(wiki?.[1] ?? markdown?.[1] ?? raw).split('|')[0].split('#')[0].trim();
    }

    function resolveLinkValueToFile(app, value) {
      const target = extractTarget(value);
      return app.metadataCache?.getFirstLinkpathDest?.(target)
        ?? app.vault.getAbstractFileByPath(target)
        ?? app.vault.getAbstractFileByPath(target.endsWith('.md') ? target : \`\${target}.md\`)
        ?? null;
    }

    const logger = {
      flow: () => undefined,
      flowWarn: () => undefined,
      warn: () => undefined,
    };
    const normalizePath = (value) => String(value ?? '').replace(/\\\\/gu, '/').replace(/^\\/+|\\/+$/gu, '');
    const setTimeout = (callback) => { callback(); return 0; };

    export class DeletedLinkCleanupHarness {
      plugin;
      deletedLinkCleanupChain = Promise.resolve();
      deletedLinkCleanupPending = 0;
      notifiedPaths = [];

      constructor(plugin) { this.plugin = plugin; }
      notifyFilesChanged(files) { this.notifiedPaths.push(...files.map((file) => file.path)); }
      ${cleanupMethod}
      ${runMethod}
    }
  `;
  const result = await esbuild.build({
    stdin: {
      contents: virtualSource,
      resolveDir: repoRoot,
      sourcefile: "deleted-link-cleanup-harness.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

function createFixture(TFile, definitions, options = {}) {
  const files = definitions.map(({ path }) => new TFile(path));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const logicalFrontmatter = new Map(definitions.map(({ path, frontmatter = {} }) => [path, structuredClone(frontmatter)]));
  const bodies = new Map(definitions.map(({ path, body = "" }) => [path, body]));
  const relationshipCandidates = definitions
    .filter(({ relationshipTarget = true }) => relationshipTarget)
    .map(({ path }) => byPath.get(path));
  const includeIgnoredCalls = [];
  const mutatedPaths = [];
  const readPaths = [];
  const processedBodyPaths = [];
  const refreshedPaths = [];

  const plugin = {
    settings: {
      parentLinkFrontmatterKey: "childOf",
      frontmatterAutoWriteExclusions: "tag:template",
    },
    app: {
      vault: {
        getAbstractFileByPath: (path) => byPath.get(path) ?? null,
        cachedRead: async (file) => {
          readPaths.push(file.path);
          if (file.extension !== "md") throw new Error(`Tried to read binary body: ${file.path}`);
          return bodies.get(file.path) ?? "";
        },
        process: async (file, mutator) => {
          processedBodyPaths.push(file.path);
          options.beforeBodyProcess?.(file, bodies, logicalFrontmatter);
          const current = bodies.get(file.path) ?? "";
          const next = await mutator(current);
          bodies.set(file.path, next);
        },
      },
      metadataCache: {
        getFirstLinkpathDest: (target) => {
          const destination = options.linkDestinations?.[target];
          return destination ? byPath.get(destination) ?? null : null;
        },
      },
    },
    parentLinkResolutionService: {
      getRelationshipCandidates: (options) => {
        includeIgnoredCalls.push(options?.includeIgnored === true);
        return relationshipCandidates;
      },
      getLogicalFrontmatter: (file) => logicalFrontmatter.get(file.path) ?? {},
    },
    filePropertiesService: {
      isCompanionFile: (file) => file.path.startsWith("_assets/TPS File Properties/"),
    },
    frontmatterMutationService: {
      process: async (file, mutator) => {
        options.beforeFrontmatterProcess?.(file, bodies, logicalFrontmatter);
        const current = logicalFrontmatter.get(file.path) ?? {};
        const before = JSON.stringify(current);
        await mutator(current);
        logicalFrontmatter.set(file.path, current);
        const changed = JSON.stringify(current) !== before;
        if (changed) mutatedPaths.push(file.path);
        return changed;
      },
    },
    bodySubitemLinkService: {
      parseLine: (line) => {
        const match = line.match(/\[\[([^\]]+)\]\]/u);
        if (!match) return null;
        return { linkTarget: `[[${match[1]}]]`, wikilink: `[[${match[1]}]]` };
      },
    },
    persistentMenuManager: {
      refreshMenusForFile: (file) => refreshedPaths.push(file.path),
    },
  };

  return {
    plugin,
    byPath,
    logicalFrontmatter,
    bodies,
    includeIgnoredCalls,
    mutatedPaths,
    readPaths,
    processedBodyPaths,
    refreshedPaths,
  };
}

test("deleted-link cleanup matches canonical full paths with optional extensions", async () => {
  const { classifyDeletedMarkdownLink, createDeletedMarkdownLinkContext } = await importMatcher();
  const context = createDeletedMarkdownLinkContext("Projects/A/Report.md", []);
  assert.ok(context);
  assert.equal(classifyDeletedMarkdownLink("[[Projects/A/Report|Report]]", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](Projects/A/Report.md)", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](A/Report.md)", "Projects/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](../../A/Report.md)", "Projects/B/Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[[A/Report]]", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink({ path: "Projects/A/Report.md#Summary" }, "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/B/Report]]", "Parents/Index.md", context), "different");
});

test("deleted-link cleanup preserves ambiguous basename-only links", async () => {
  const { classifyDeletedMarkdownLink, createDeletedMarkdownLinkContext } = await importMatcher();
  const unambiguous = createDeletedMarkdownLinkContext("Projects/A/Report.md", []);
  const ambiguous = createDeletedMarkdownLinkContext("Projects/A/Report.md", ["Projects/B/Report.md"]);
  assert.ok(unambiguous);
  assert.ok(ambiguous);
  assert.equal(classifyDeletedMarkdownLink("[[Report]]", "Parents/Index.md", unambiguous), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Report]]", "Parents/Index.md", ambiguous), "ambiguous");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/A/Report]]", "Parents/Index.md", ambiguous), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/B/Report]]", "Parents/Index.md", ambiguous), "different");
});

test("GCM deletion cleanup is serialized, logical-target aware, and atomically removes Markdown body links", () => {
  const eventSource = readFileSync(new URL("../src/events/register-events.ts", import.meta.url), "utf8");
  const bulkSource = readFileSync(new URL("../src/services/bulk-edit-service.ts", import.meta.url), "utf8");
  const runSource = extractMethod(bulkSource, "runDeletedLinkCleanup", "bulk-edit-service.ts");
  assert.match(eventSource, /if \(!deletedCompanion && file instanceof TFile\) \{[\s\S]{0,300}cleanupLinksForDeletedFile\(file\.path\)\.catch/u);
  assert.match(bulkSource, /private deletedLinkCleanupChain: Promise<void> = Promise\.resolve\(\)/);
  assert.match(bulkSource, /\.then\(\(\) => this\.runDeletedLinkCleanup\(deletedPath\)\)/);
  assert.match(bulkSource, /logger\.flow\('DeletedLinkCleanup', 'queued', \{ deletedPath, queuedBehind \}\)/);
  assert.match(runSource, /getRelationshipCandidates\(\{ includeIgnored: true \}\)/u);
  assert.match(runSource, /normalizePath\(file\.path\)\.toLowerCase\(\) !== normalizedDeletedPath[\s\S]{0,120}!this\.plugin\.filePropertiesService\?\.isCompanionFile\(file\)/u);
  assert.match(runSource, /getLogicalFrontmatter\(file\)/u);
  assert.match(runSource, /frontmatterMutationService\.process\(file,/u);
  assert.match(runSource, /const values = Array\.isArray\(raw\) \? raw : \(raw != null \? \[raw\] : \[\]\)/u);
  assert.match(runSource, /const isMarkdown = file\.extension\?\.toLowerCase\(\) === 'md'/u);
  assert.match(runSource, /if \(!isMarkdown\)/u);
  assert.doesNotMatch(runSource, /getMarkdownFiles\(\)/u);
  assert.match(runSource, /classifyDeletedMarkdownLink\(linkValue, sourcePath, matchContext\)/);
  assert.match(runSource, /if \(preflight\.length !== lines\.length\) \{[\s\S]*?vault\.process\(file, \(current\) =>/);
  assert.doesNotMatch(runSource, /vault\.modify\(file, filtered\.join\('\\n'\)\)/);
  assert.match(bulkSource, /logger\.flow\('DeletedLinkCleanup', 'done'/);
  assert.match(bulkSource, /preservedAmbiguousReferences/);
  assert.doesNotMatch(bulkSource, /target === deletedBasename/);
});

test("deleting a Markdown parent unlinks a PDF child even after an unrelated same-path recreation", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Parents/Archive.md", frontmatter: { title: "Unrelated replacement" } },
    { path: "Parents/Keep.md" },
    {
      path: "Reference/Child.pdf",
      frontmatter: {
        relationshipMode: "ignore",
        childOf: ["[[Parents/Archive]]", "[[Parents/Keep]]"],
      },
    },
    {
      path: "_assets/TPS File Properties/Reference/Child.pdf.md",
      frontmatter: { childOf: ["[[Parents/Archive]]"] },
    },
  ]);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);

  const result = await service.cleanupLinksForDeletedFile("Parents/Archive.md");

  assert.deepEqual(fixture.includeIgnoredCalls, [true]);
  assert.deepEqual(fixture.logicalFrontmatter.get("Reference/Child.pdf"), {
    relationshipMode: "ignore",
    childOf: ["[[Parents/Keep]]"],
  });
  assert.deepEqual(fixture.logicalFrontmatter.get("Parents/Archive.md"), { title: "Unrelated replacement" });
  assert.equal(fixture.mutatedPaths.includes("Parents/Archive.md"), false, "the same-path replacement is excluded from cleanup");
  assert.equal(fixture.mutatedPaths.some((path) => path.startsWith("_assets/TPS File Properties/")), false);
  assert.equal(fixture.readPaths.includes("Reference/Child.pdf"), false, "PDF bodies are never scanned");
  assert.deepEqual(service.notifiedPaths, ["Reference/Child.pdf"]);
  assert.equal(result.touchedFiles, 1);
});

test("deleting a PDF parent unlinks Markdown and PDF children while preserving other array members", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Assets/Keep.pdf" },
    {
      path: "Notes/Markdown Child.md",
      frontmatter: { parents: ["[[Assets/Source.pdf]]", "[[Assets/Keep.pdf]]"] },
      body: "- [ ] [[Assets/Source.pdf]]\n- [ ] [[Assets/Keep.pdf]]",
    },
    {
      path: "Documents/PDF Child.pdf",
      frontmatter: { childOf: ["[[Assets/Source.pdf]]", "[[Assets/Keep.pdf]]"] },
    },
    {
      path: "_assets/TPS File Properties/Documents/PDF Child.pdf.md",
      frontmatter: { childOf: ["[[Assets/Source.pdf]]"] },
    },
  ]);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);

  const result = await service.cleanupLinksForDeletedFile("Assets/Source.pdf");

  assert.deepEqual(fixture.includeIgnoredCalls, [true]);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Markdown Child.md"), {
    parents: ["[[Assets/Keep.pdf]]"],
  });
  assert.deepEqual(fixture.logicalFrontmatter.get("Documents/PDF Child.pdf"), {
    childOf: ["[[Assets/Keep.pdf]]"],
  });
  assert.equal(fixture.bodies.get("Notes/Markdown Child.md"), "- [ ] [[Assets/Keep.pdf]]");
  assert.deepEqual(
    fixture.readPaths,
    ["Notes/Markdown Child.md", "Notes/Markdown Child.md"],
    "Markdown cleanup reads current bytes once for automatic exclusions and once for body preflight",
  );
  assert.deepEqual(fixture.processedBodyPaths, ["Notes/Markdown Child.md"]);
  assert.equal(fixture.readPaths.includes("Documents/PDF Child.pdf"), false);
  assert.equal(fixture.mutatedPaths.some((path) => path.startsWith("_assets/TPS File Properties/")), false);
  assert.deepEqual(new Set(service.notifiedPaths), new Set(["Notes/Markdown Child.md", "Documents/PDF Child.pdf"]));
  assert.equal(result.touchedFiles, 2);
});

test("cleanup preserves an explicit suffix link that resolves to a different live logical target", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Archive/A/Report.pdf" },
    {
      path: "Reference/Child.pdf",
      frontmatter: { childOf: ["[[A/Report.pdf]]"] },
    },
  ], {
    linkDestinations: { "A/Report.pdf": "Archive/A/Report.pdf" },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);

  const result = await service.cleanupLinksForDeletedFile("Projects/A/Report.pdf");

  assert.deepEqual(fixture.logicalFrontmatter.get("Reference/Child.pdf"), {
    childOf: ["[[A/Report.pdf]]"],
  });
  assert.deepEqual(fixture.mutatedPaths, []);
  assert.deepEqual(service.notifiedPaths, []);
  assert.equal(result.touchedFiles, 0);
  assert.equal(result.removedReferences, 0);
});

test("automatic deleted-link cleanup leaves explicitly tag-excluded notes byte-identical", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const protectedSource = [
    "---",
    "tags: [template, keep]",
    "childOf: '[[Parents/Deleted]]'",
    "---",
    "- [ ] [[Parents/Deleted]]",
  ].join("\n");
  const fixture = createFixture(TFile, [
    {
      path: "Templates/Protected.md",
      frontmatter: { tags: ["template", "keep"], childOf: ["[[Parents/Deleted]]"] },
      body: protectedSource,
    },
    {
      path: "Notes/Ordinary.md",
      frontmatter: { childOf: ["[[Parents/Deleted]]"] },
      body: "- [ ] [[Parents/Deleted]]",
    },
  ]);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);

  const result = await service.cleanupLinksForDeletedFile("Parents/Deleted.md");

  assert.deepEqual(fixture.logicalFrontmatter.get("Templates/Protected.md"), {
    tags: ["template", "keep"],
    childOf: ["[[Parents/Deleted]]"],
  });
  assert.equal(fixture.bodies.get("Templates/Protected.md"), protectedSource);
  assert.equal(fixture.mutatedPaths.includes("Templates/Protected.md"), false);
  assert.equal(fixture.processedBodyPaths.includes("Templates/Protected.md"), false);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Ordinary.md"), {});
  assert.equal(fixture.bodies.get("Notes/Ordinary.md"), "");
  assert.equal(result.touchedFiles, 1);
});

test("deleted-link cleanup rechecks explicit exclusions at frontmatter and body mutation boundaries", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const frontmatterRace = createFixture(TFile, [{
    path: "Notes/Frontmatter race.md",
    frontmatter: { childOf: ["[[Parents/Deleted]]"] },
    body: "---\ntags: [keep]\nchildOf: '[[Parents/Deleted]]'\n---\n",
  }], {
    beforeFrontmatterProcess(file, bodies, logicalFrontmatter) {
      bodies.set(file.path, bodies.get(file.path).replace("tags: [keep]", "tags: [template, keep]"));
      logicalFrontmatter.set(file.path, {
        tags: ["template", "keep"],
        childOf: ["[[Parents/Deleted]]"],
      });
    },
  });
  const frontmatterService = new DeletedLinkCleanupHarness(frontmatterRace.plugin);

  await frontmatterService.cleanupLinksForDeletedFile("Parents/Deleted.md");

  assert.deepEqual(frontmatterRace.logicalFrontmatter.get("Notes/Frontmatter race.md"), {
    tags: ["template", "keep"],
    childOf: ["[[Parents/Deleted]]"],
  });
  assert.equal(frontmatterRace.mutatedPaths.length, 0);

  const initialBody = "---\ntags: [keep]\n---\n- [ ] [[Parents/Deleted]]";
  const protectedBody = "---\ntags: [template, keep]\n---\n- [ ] [[Parents/Deleted]]";
  const bodyRace = createFixture(TFile, [{
    path: "Notes/Body race.md",
    frontmatter: { tags: ["keep"] },
    body: initialBody,
  }], {
    beforeBodyProcess(file, bodies) {
      bodies.set(file.path, protectedBody);
    },
  });
  const bodyService = new DeletedLinkCleanupHarness(bodyRace.plugin);

  await bodyService.cleanupLinksForDeletedFile("Parents/Deleted.md");

  assert.equal(bodyRace.bodies.get("Notes/Body race.md"), protectedBody);
  assert.deepEqual(bodyRace.processedBodyPaths, ["Notes/Body race.md"]);
  assert.deepEqual(bodyService.notifiedPaths, []);
});
