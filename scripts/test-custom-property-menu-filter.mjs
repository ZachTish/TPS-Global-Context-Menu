import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadFilterModule() {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/services/custom-property-menu-filter.ts", import.meta.url),
      ),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

test("Notebook Navigator suppresses only standard tag properties without hiding custom tag lists", async () => {
  const { createCustomPropertyMenuExclusionPredicate } = await loadFilterModule();
  const exclude = createCustomPropertyMenuExclusionPredicate({
    excludeCustomPropertyKeys: ["internal"],
    excludeStandardTagProperties: true,
  });

  assert.equal(exclude({ id: "tags", key: "tags", type: "list" }), true);
  assert.equal(exclude({ id: "custom-tag", key: "Tag", type: "selector" }), true);
  assert.equal(
    exclude({ id: "categories", key: "categories", type: "list", listItemType: "tag" }),
    false,
  );
  assert.equal(exclude({ id: "internal", key: "visible-name", type: "text" }), true);
  assert.equal(
    exclude({ id: "labels", key: "labels", type: "list", listItemType: "text" }),
    false,
  );
  assert.equal(
    exclude({ id: "projects", key: "projects", type: "list", listItemType: "link" }),
    false,
  );
});

test("tag properties remain available to menu surfaces that own tag editing", async () => {
  const { createCustomPropertyMenuExclusionPredicate } = await loadFilterModule();
  const exclude = createCustomPropertyMenuExclusionPredicate({});
  assert.equal(
    exclude({ id: "categories", key: "categories", type: "list", listItemType: "tag" }),
    false,
  );
});
