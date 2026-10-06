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
      canAutomaticallyMutatePathWithExclusions,
    } from './src/utils/template-protection.ts';
    export { BodySubitemLinkService } from './src/services/body-subitem-link-service.ts';

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
    plugins: [{
      name: "deleted-link-obsidian-host",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/u }, () => ({ path: "obsidian", namespace: "deleted-link-host" }));
        build.onLoad({ filter: /.*/u, namespace: "deleted-link-host" }, () => ({
          contents: "export class TFile {} export const normalizePath = value => value;",
          loader: "js",
        }));
      },
    }],
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
  const mutationAttempts = [];
  const rawReadPaths = [];
  const readPaths = [];
  const processedBodyPaths = [];
  const refreshedPaths = [];
  const metadataPaths = [];

  const plugin = {
    settings: {
      parentLinkFrontmatterKey: "childOf",
      frontmatterAutoWriteExclusions: "tag:template",
      dataArchitectureMode: options.dataArchitectureMode ?? "legacy",
    },
    app: {
      vault: {
        getAbstractFileByPath: (path) => byPath.get(path) ?? null,
        read: async (file) => {
          rawReadPaths.push(file.path);
          if (file.extension !== "md") throw new Error(`Tried to read binary body: ${file.path}`);
          return bodies.get(file.path) ?? "";
        },
        cachedRead: async (file) => {
          readPaths.push(file.path);
          if (file.extension !== "md") throw new Error(`Tried to read binary body: ${file.path}`);
          await options.beforeCachedRead?.(file, bodies, logicalFrontmatter);
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
        getFileCache: (file) => {
          metadataPaths.push(file.path);
          return options.getFileCache ? options.getFileCache(file) : { frontmatter: logicalFrontmatter.get(file.path) ?? {} };
        },
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
        mutationAttempts.push(file.path);
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
    mutationAttempts,
    rawReadPaths,
    readPaths,
    processedBodyPaths,
    refreshedPaths,
    metadataPaths,
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
  assert.match(runSource, /if \(!isMarkdown \|\| this\.plugin\.settings\.dataArchitectureMode === 'native-records'\)/u);
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
    "Markdown cleanup reuses cached inspection unless its own frontmatter mutation changed the source",
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


test("unrelated deletion uses one cached source inspection and no writer attempts in a large vault", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, Array.from({ length: 1000 }, (_, i) => ({
    path: `Notes/Unrelated ${i}.md`,
    frontmatter: { childOf: "[[Parents/Keep]]", attachments: ["[[Assets/Keep.png]]"] },
    body: "---\ntags: [keep]\n---\nPreserved body\n- [[Parents/Keep]]",
  })));
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Parents/Unreferenced.md");
  assert.equal(result.touchedFiles, 0);
  assert.equal(result.removedReferences, 0);
  assert.equal(fixture.mutationAttempts.length, 0);
  assert.equal(fixture.rawReadPaths.length, 0);
  assert.equal(fixture.readPaths.length, 1000);
  assert.equal(fixture.processedBodyPaths.length, 0);
});

test("native deletion bursts never inspect bodies or enter a file write queue", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{
    path: "Notes/Unrelated.md", frontmatter: { parent: "[[Keep]]", attachments: "[[Keep.png]]" }, body: "unchanged",
  }], { dataArchitectureMode: "native-records" });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  await Promise.all(Array.from({ length: 20 }, (_, i) => service.cleanupLinksForDeletedFile(`Unreferenced ${i}.md`)));
  assert.equal(fixture.includeIgnoredCalls.length, 20);
  assert.equal(fixture.mutationAttempts.length, 0);
  assert.equal(fixture.rawReadPaths.length, 0);
  assert.equal(fixture.readPaths.length, 0);
  assert.equal(service.deletedLinkCleanupPending, 0);
});

test("native deletion ignores historical body links across 4,000 plain and list notes", async () => {
  const { DeletedLinkCleanupHarness, TFile, BodySubitemLinkService } = await importCleanupHarness();
  const fixture = createFixture(TFile, Array.from({ length: 4000 }, (_, i) => ({
    path: `Notes/Ordinary ${i}.md`,
    frontmatter: { title: `Ordinary ${i}`, childOf: "[[Keep]]", attachments: ["[[Keep.png]]"] },
    body: `---\ntitle: Ordinary ${i}\nchildOf: '[[Keep]]'\nattachments: ["[[Keep.png]]"]\n---\n${i % 3 === 0 ? "[[Deleted]]" : i % 3 === 1 ? "- [ ] [[Deleted]]" : "Ordinary text"}\nBody sentinel`,
  })), { dataArchitectureMode: "native-records" });
  fixture.plugin.bodySubitemLinkService = new BodySubitemLinkService(fixture.plugin);
  const before = new Map(fixture.bodies);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.scannedFiles, 4000);
  assert.equal(fixture.readPaths.length, 0);
  assert.equal(fixture.metadataPaths.length, 0, "body-link cache freshness is irrelevant to native ownership");
  assert.equal(fixture.rawReadPaths.length, 0);
  assert.equal(fixture.mutationAttempts.length, 0);
  assert.equal(fixture.processedBodyPaths.length, 0);
  assert.equal(result.touchedFiles, 0);
  assert.deepEqual(fixture.bodies, before);
});

test("native deletion still removes scalar and array frontmatter links while preserving body and completion", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Notes/Scalar.md", frontmatter: { childOf: "[[Deleted]]", status: "complete", completedDate: "2026-10-06T12:00:00" }, body: "[[Deleted]]\nKeep scalar body" },
    { path: "Notes/Array.md", frontmatter: { attachments: ["[[Deleted]]", "[[Keep]]"], parents: ["[[Deleted]]", "[[Keep]]"] }, body: "- [ ] [[Deleted]]\nKeep array body" },
    { path: "Notes/Unrelated.md", frontmatter: { childOf: "[[Keep]]" }, body: "Keep unrelated body" },
  ], { dataArchitectureMode: "native-records" });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 2);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Scalar.md"), { status: "complete", completedDate: "2026-10-06T12:00:00" });
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Array.md"), { attachments: ["[[Keep]]"], parents: ["[[Keep]]"] });
  assert.equal(fixture.readPaths.includes("Notes/Unrelated.md"), false);
  assert.equal(fixture.bodies.get("Notes/Scalar.md"), "[[Deleted]]\nKeep scalar body");
  assert.equal(fixture.bodies.get("Notes/Array.md"), "- [ ] [[Deleted]]\nKeep array body");
  assert.deepEqual(fixture.readPaths, ["Notes/Scalar.md", "Notes/Array.md"], "only possible frontmatter changes inspect current exclusions");
  assert.deepEqual(fixture.processedBodyPaths, []);
});

test("legacy deletion inspects current body despite complete but stale link metadata", async () => {
  const { DeletedLinkCleanupHarness, TFile, BodySubitemLinkService } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Notes/Newly linked.md", body: "[[Deleted]]\nKeep body" },
    { path: "Notes/Legacy malformed.md", body: "- [Deleted]]\nKeep body" },
  ], { getFileCache: () => ({ links: [], embeds: [], listItems: [], sections: [{ type: "paragraph" }] }) });
  fixture.plugin.bodySubitemLinkService = new BodySubitemLinkService(fixture.plugin);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 2);
  assert.equal(fixture.readPaths.length, 2);
  assert.equal(fixture.bodies.get("Notes/Newly linked.md"), "Keep body");
  assert.equal(fixture.bodies.get("Notes/Legacy malformed.md"), "Keep body");
});

test("legacy deletion admits frontmatter metadata that arrives during cachedRead", async () => {
  const { DeletedLinkCleanupHarness, TFile, BodySubitemLinkService } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{
    path: "Notes/Metadata arriving.md",
    frontmatter: {},
    body: "---\nchildOf: '[[Deleted]]'\nstatus: complete\ncompletedDate: 2026-10-06T12:00:00\n---\nKeep body",
  }], {
    beforeCachedRead(file, _bodies, frontmatter) {
      if (!frontmatter.get(file.path)?.completedDate) {
        frontmatter.set(file.path, {
          childOf: "[[Deleted]]",
          status: "complete",
          completedDate: "2026-10-06T12:00:00",
        });
      }
    },
  });
  fixture.plugin.bodySubitemLinkService = new BodySubitemLinkService(fixture.plugin);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 1);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Metadata arriving.md"), {
    status: "complete",
    completedDate: "2026-10-06T12:00:00",
  });
  assert.deepEqual(fixture.mutatedPaths, ["Notes/Metadata arriving.md"]);
  assert.deepEqual(fixture.processedBodyPaths, []);
});

test("native deletion rechecks fresh frontmatter after cache candidate admission", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{
    path: "Notes/Changed.md", frontmatter: { childOf: "[[Deleted]]" }, body: "- [[Deleted]]\nKeep body",
  }], {
    dataArchitectureMode: "native-records",
    beforeFrontmatterProcess(file, _bodies, frontmatter) {
      frontmatter.set(file.path, { childOf: "[[Keep]]", status: "complete", completedDate: "New authored date" });
    },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 0);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Changed.md"), { childOf: "[[Keep]]", status: "complete", completedDate: "New authored date" });
  assert.equal(fixture.bodies.get("Notes/Changed.md"), "- [[Deleted]]\nKeep body");
  assert.deepEqual(fixture.processedBodyPaths, []);
  assert.deepEqual(service.notifiedPaths, []);
});

test("native frontmatter deletion cleanup still respects current tag and path exclusions", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{
    path: "Notes/Protected.md", frontmatter: { childOf: "[[Deleted]]" }, body: "---\ntags: [keep]\n---\n[[Deleted]]",
  }], {
    dataArchitectureMode: "native-records",
    beforeFrontmatterProcess(file, bodies, frontmatter) {
      bodies.set(file.path, "---\ntags: [template]\n---\n[[Deleted]]");
      frontmatter.set(file.path, { tags: ["template"], childOf: "[[Deleted]]" });
    },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Protected.md"), { tags: ["template"], childOf: "[[Deleted]]" });
  assert.equal(fixture.bodies.get("Notes/Protected.md"), "---\ntags: [template]\n---\n[[Deleted]]");
  assert.deepEqual(fixture.mutatedPaths, []);
  assert.deepEqual(fixture.processedBodyPaths, []);
  fixture.plugin.settings.frontmatterAutoWriteExclusions = "path:Notes/";
  const reads = fixture.readPaths.length;
  await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(fixture.readPaths.length, reads);
});

test("a mode change to native at the atomic body boundary refuses a pending legacy deletion write", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  let fixture;
  fixture = createFixture(TFile, [{ path: "Notes/Changed.md", body: "[[Deleted]]\nKeep body" }], {
    beforeBodyProcess() { fixture.plugin.settings.dataArchitectureMode = "native-records"; },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 0);
  assert.equal(result.removedReferences, 0);
  assert.equal(fixture.bodies.get("Notes/Changed.md"), "[[Deleted]]\nKeep body");
  assert.deepEqual(service.notifiedPaths, []);
});

test("a legacy body link resolving to another live target remains untouched", async () => {
  const { DeletedLinkCleanupHarness, TFile, BodySubitemLinkService } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Archive/A/Report.md", body: "Other report" },
    { path: "Notes/Referrer.md", body: "[[A/Report]]\nKeep body" },
  ], { linkDestinations: { "A/Report": "Archive/A/Report.md" } });
  fixture.plugin.bodySubitemLinkService = new BodySubitemLinkService(fixture.plugin);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Projects/A/Report.md");
  assert.equal(result.touchedFiles, 0);
  assert.equal(result.removedReferences, 0);
  assert.deepEqual(fixture.readPaths, ["Archive/A/Report.md", "Notes/Referrer.md"]);
  assert.deepEqual(fixture.processedBodyPaths, []);
  assert.equal(fixture.bodies.get("Notes/Referrer.md"), "[[A/Report]]\nKeep body");
});

test("cached matching frontmatter only permits an attempt; current values still own the mutation", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{
    path: "Notes/Changing.md", frontmatter: { childOf: "[[Deleted]]" }, body: "Preserved body",
  }], {
    beforeFrontmatterProcess(file, _bodies, frontmatter) {
      frontmatter.set(file.path, { childOf: "[[New parent]]", userEdit: "preserved" });
    },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(fixture.mutationAttempts.length, 1);
  assert.equal(result.touchedFiles, 0);
  assert.equal(result.removedReferences, 0);
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Changing.md"), { childOf: "[[New parent]]", userEdit: "preserved" });
});

test("current exclusion settings are rechecked inside both atomic deletion writers", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  let fixture;
  fixture = createFixture(TFile, [{path: "Notes/Changing.md", frontmatter: { childOf: "[[Deleted]]" }, body: "ordinary"}], {
    beforeFrontmatterProcess() { fixture.plugin.settings.frontmatterAutoWriteExclusions = "path:Notes/"; },
  });
  let service = new DeletedLinkCleanupHarness(fixture.plugin);
  await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.deepEqual(fixture.logicalFrontmatter.get("Notes/Changing.md"), { childOf: "[[Deleted]]" });
  assert.deepEqual(fixture.mutatedPaths, []);
  fixture = createFixture(TFile, [{path: "Notes/Changing.md", body: "- [[Deleted]]"}], {
    beforeBodyProcess() { fixture.plugin.settings.frontmatterAutoWriteExclusions = "path:Notes/"; },
  });
  service = new DeletedLinkCleanupHarness(fixture.plugin);
  await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(fixture.bodies.get("Notes/Changing.md"), "- [[Deleted]]");
  assert.deepEqual(service.notifiedPaths, []);
});

test("ambiguous and differently resolved parents stay unchanged without a writer attempt", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [
    { path: "Other/Deleted.md" },
    { path: "Notes/Parent.md", frontmatter: { parent: ["[[Deleted]]", "[[Other/Deleted]]"] }, body: "- [[Deleted]]" },
  ]);
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Removed/Deleted.md");
  assert.equal(result.preservedAmbiguousReferences, 1);
  assert.equal(result.removedReferences, 0);
  assert.deepEqual(fixture.mutationAttempts, []);
  assert.deepEqual(fixture.processedBodyPaths, []);
});

test("missing core link metadata does not suppress the existing body parser", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{ path: "Notes/Parent.md", body: "- [Deleted]]\nPreserved body" }]);
  fixture.plugin.app.metadataCache.getFileCache = () => ({ links: [] });
  fixture.plugin.bodySubitemLinkService.parseLine = line => line === "- [Deleted]]" ? { linkTarget: "Deleted", wikilink: "[[Deleted]]" } : null;
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 1);
  assert.equal(fixture.bodies.get("Notes/Parent.md"), "Preserved body");
});


test("body cleanup computes its result from concurrent current source, preserving added content", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{ path: "Notes/Parent.md", body: "- [[Deleted]]\nOriginal body" }], {
    beforeBodyProcess(file, bodies) { bodies.set(file.path, "User-added text\n- [[Deleted]]\n- [[Keep]]\nOriginal body"); },
  });
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 1);
  assert.equal(result.removedReferences, 1);
  assert.equal(fixture.bodies.get("Notes/Parent.md"), "User-added text\n- [[Keep]]\nOriginal body");
  assert.deepEqual(fixture.processedBodyPaths, ["Notes/Parent.md"]);
});

test("path-excluded cleanup does not inspect bodies or enter writers", async () => {
  const { DeletedLinkCleanupHarness, TFile } = await importCleanupHarness();
  const fixture = createFixture(TFile, [{ path: "Notes/Protected.md", frontmatter: { parent: "[[Deleted]]" }, body: "- [[Deleted]]" }]);
  fixture.plugin.settings.frontmatterAutoWriteExclusions = "path:Notes/";
  const service = new DeletedLinkCleanupHarness(fixture.plugin);
  const result = await service.cleanupLinksForDeletedFile("Deleted.md");
  assert.equal(result.touchedFiles, 0);
  assert.deepEqual(fixture.readPaths, []);
  assert.deepEqual(fixture.rawReadPaths, []);
  assert.deepEqual(fixture.mutationAttempts, []);
  assert.deepEqual(fixture.processedBodyPaths, []);
});
