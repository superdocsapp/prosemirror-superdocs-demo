import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { DOMParser } from "prosemirror-model";
import { schema } from "./schema";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { proposedChangeDecoration } from "./proposed-change-decoration";

function createPlugins() {
  return [history(), keymap(baseKeymap), proposedChangeDecoration()];
}

function htmlToDoc(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(el);
}

describe("horizontal_rule + data-chunk-id — the real bug", () => {
  it("toDOM output has no malformed trailing undefined entry", () => {
    const doc = htmlToDoc('<hr data-chunk-id="ac223126-d24c-4173-8eaa-a03d10855245"/>');
    let hrNode: ReturnType<typeof doc.nodeAt> = null;
    doc.descendants((node) => {
      if (node.type.name === "horizontal_rule") hrNode = node;
    });
    expect(hrNode).not.toBeNull();
    const spec = schema.nodes.horizontal_rule.spec;
    const out = spec.toDOM!(hrNode!);
    expect(out).toEqual(["hr", { "data-chunk-id": "ac223126-d24c-4173-8eaa-a03d10855245" }]);
  });

  it("EditorView construction succeeds with a realistic doc containing a chunk-id-tagged <hr>", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const html =
      '<p data-chunk-id="a">closing text before the divider</p>' +
      '<hr data-chunk-id="ac223126-d24c-4173-8eaa-a03d10855245"/>' +
      '<p data-chunk-id="b"><em>Approved by: someone</em></p>';
    const doc = htmlToDoc(html);
    const state = EditorState.create({ doc, plugins: createPlugins() });
    expect(() => {
      const view = new EditorView(mount, { state });
      view.destroy();
    }).not.toThrow();
  });

  it("CONTRAST: a doc WITHOUT any horizontal_rule constructs fine (isolates hr as the cause)", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const html =
      '<p data-chunk-id="a">closing text</p>' +
      '<p data-chunk-id="b"><em>Approved by: someone</em></p>';
    const doc = htmlToDoc(html);
    const state = EditorState.create({ doc, plugins: createPlugins() });
    expect(() => {
      const view = new EditorView(mount, { state });
      view.destroy();
    }).not.toThrow();
  });
});
