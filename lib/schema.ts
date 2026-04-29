// Schema with chunk-id round-trip preservation.
// Copied verbatim from https://docs.superdocs.app/guides/editor-integration
// (ProseMirror tab). Both the per-block data-chunk-id attr AND the
// chunk_wrapper Node for <div data-chunk-id="…"> are required — drop
// either and multi-element chunks silently lose their id during parsing.
import { Schema, NodeSpec } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";

function withChunkId(spec: NodeSpec): NodeSpec {
  const attrs = { ...(spec.attrs ?? {}), "data-chunk-id": { default: null } };

  const parseDOM = (spec.parseDOM ?? []).map((rule) => ({
    ...rule,
    getAttrs: (node: string | HTMLElement) => {
      const base =
        typeof rule.getAttrs === "function"
          ? rule.getAttrs(node as HTMLElement) ?? {}
          : rule.attrs ?? {};
      if (typeof node === "string") return base;
      return { ...base, "data-chunk-id": node.getAttribute("data-chunk-id") };
    },
  }));

  const originalToDOM = spec.toDOM;
  const toDOM: NodeSpec["toDOM"] = originalToDOM
    ? (node) => {
        const out = originalToDOM(node);
        if (!Array.isArray(out)) return out;
        const [tag, maybeAttrs, ...rest] = out as [string, unknown, ...unknown[]];
        const chunkId = node.attrs["data-chunk-id"];
        if (!chunkId) return out;
        const isAttrs =
          maybeAttrs &&
          typeof maybeAttrs === "object" &&
          !Array.isArray(maybeAttrs) &&
          !(maybeAttrs as { nodeType?: unknown }).nodeType;
        return isAttrs
          ? [tag, { ...(maybeAttrs as Record<string, unknown>), "data-chunk-id": chunkId }, ...rest]
          : [tag, { "data-chunk-id": chunkId }, maybeAttrs, ...rest];
      }
    : undefined;

  return { ...spec, attrs, parseDOM, toDOM };
}

// Wrapper node for multi-element chunks: <div data-chunk-id="…">…</div>.
const chunkWrapperSpec: NodeSpec = {
  group: "block",
  content: "block+",
  attrs: { "data-chunk-id": { default: null } },
  parseDOM: [
    {
      tag: "div[data-chunk-id]",
      getAttrs: (node) =>
        typeof node === "string"
          ? {}
          : { "data-chunk-id": node.getAttribute("data-chunk-id") },
    },
  ],
  toDOM: (node) => [
    "div",
    node.attrs["data-chunk-id"]
      ? { "data-chunk-id": node.attrs["data-chunk-id"] }
      : {},
    0,
  ],
};

let nodes = basicSchema.spec.nodes;
for (const name of ["paragraph", "blockquote", "heading", "horizontal_rule", "code_block"]) {
  const spec = nodes.get(name);
  if (spec) nodes = nodes.update(name, withChunkId(spec));
}
nodes = addListNodes(nodes, "paragraph block*", "block");
for (const name of ["ordered_list", "bullet_list", "list_item"]) {
  const spec = nodes.get(name);
  if (spec) nodes = nodes.update(name, withChunkId(spec));
}
nodes = nodes.addToEnd("chunk_wrapper", chunkWrapperSpec);

export const schema = new Schema({ nodes, marks: basicSchema.spec.marks });
