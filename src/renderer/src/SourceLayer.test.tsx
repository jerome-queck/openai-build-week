// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceAnchorPaletteAction, SourceAnchorSelection } from "../../shared/learning-application";
import { SourceLayer } from "./SourceLayer";

describe("Source Layer selection", () => {
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  it("opens a labelled Selection Palette for selected source text without dispatching an action", async () => {
    const user = userEvent.setup();
    const onChooseAction = vi.fn();
    render(<SourceLayer
      sourceId="source-1"
      content="Every compact subset is closed."
      anchors={[]}
      onChooseAction={onChooseAction}
    />);
    const source = screen.getByRole("article", { name: "Read-only Source Layer" });
    expect(source.getAttribute("contenteditable")).toBeNull();
    const textNode = source.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 13);
    window.getSelection()!.addRange(range);

    fireEvent.mouseUp(source);

    const palette = screen.getByRole("dialog", { name: "Selection Palette for selected text" });
    expect(palette).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explain or unpack selected text" })).toBe(document.activeElement);
    expect(onChooseAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Annotate selected text" }));
    expect(onChooseAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: "text",
      startOffset: 6,
      endOffset: 13,
      exactText: "compact"
    }), "annotate");
  });

  it("preserves an equation's source offsets and surrounding context for keyboard selection", async () => {
    const user = userEvent.setup();
    const choices: Array<[SourceAnchorSelection, SourceAnchorPaletteAction]> = [];
    render(<SourceLayer
      sourceId="source-1"
      content="Assume $x^2 + y^2 = 1$ before continuing."
      anchors={[]}
      onChooseAction={(selection, action) => choices.push([selection, action])}
    />);
    const equation = screen.getByRole("button", { name: "Select equation 1: $x^2 + y^2 = 1$" });

    equation.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Selection Palette for selected equation" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Ask about selected equation" }));

    expect(choices).toEqual([[{
      kind: "equation",
      equationIndex: 0,
      startOffset: 7,
      endOffset: 22,
      exactText: "$x^2 + y^2 = 1$",
      prefix: "Assume ",
      suffix: " before continuing."
    }, "question"]]);
  });

  it("keyboard-creates normalized diagram bounds and exposes all agreed palette actions", async () => {
    const user = userEvent.setup();
    const onChooseAction = vi.fn();
    render(<SourceLayer sourceId="source-1" content="A commutative diagram" anchors={[]} onChooseAction={onChooseAction} />);

    await user.click(screen.getByRole("button", { name: "Define diagram region with keyboard" }));
    const leftEdge = screen.getByRole("spinbutton", { name: "Left edge percent" });
    await user.clear(leftEdge);
    await user.type(leftEdge, "20");
    await user.click(screen.getByRole("button", { name: "Use diagram region" }));

    expect(screen.getByRole("button", { name: "Explain or unpack selected diagram region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask about selected diagram region" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annotate selected diagram region" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add selected diagram region to the Learning Trail" }));
    expect(onChooseAction).toHaveBeenCalledWith({
      kind: "diagramRegion",
      bounds: { x: 0.2, y: 0.25, width: 0.5, height: 0.5 }
    }, "addToLearningTrail");
  });

  it("draws a bounded diagram-region selection using normalized Source Layer coordinates", async () => {
    const user = userEvent.setup();
    const onChooseAction = vi.fn();
    render(<SourceLayer
      sourceId="source-1"
      content="data:image/png;base64,c3ludGhldGljLWRpYWdyYW0="
      mediaType="image/png"
      anchors={[]}
      onChooseAction={onChooseAction}
    />);
    const source = screen.getByRole("article", { name: "Read-only Source Layer" });
    expect(screen.getByRole("img", { name: "Linked Source diagram" })).toBeTruthy();
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100,
      toJSON: () => ({})
    });

    await user.click(screen.getByRole("button", { name: "Draw diagram region" }));
    fireEvent(source, new MouseEvent("pointerdown", { bubbles: true, clientX: 30, clientY: 30 }));
    fireEvent(source, new MouseEvent("pointerup", { bubbles: true, clientX: 130, clientY: 80 }));
    await user.click(screen.getByRole("button", { name: "Annotate selected diagram region" }));

    expect(onChooseAction).toHaveBeenCalledWith({
      kind: "diagramRegion",
      bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
    }, "annotate");
  });

  it("closes the Selection Palette with Escape and restores focus to the selected source control", async () => {
    const user = userEvent.setup();
    render(<SourceLayer sourceId="source-1" content="Use $a=b$." anchors={[]} onChooseAction={vi.fn()} />);
    const equation = screen.getByRole("button", { name: "Select equation 1: $a=b$" });

    await user.click(equation);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(equation).toBe(document.activeElement);
  });

  it("renders saved diagram bounds as zoom-stable percentage markers", () => {
    render(<SourceLayer
      sourceId="source-1"
      content="data:image/png;base64,c3ludGhldGljLWRpYWdyYW0="
      mediaType="image/png"
      anchors={[{
        id: "anchor-1",
        sourceId: "source-1",
        selection: { kind: "diagramRegion", bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }
      }]}
      onChooseAction={vi.fn()}
    />);

    const marker = screen.getByLabelText("Saved diagram-region Source Anchor");
    expect(marker.getAttribute("style")).toContain("left: 10%");
    expect(marker.getAttribute("style")).toContain("top: 20%");
    expect(screen.getByText(/Diagram region at 10% left, 20% top/)).toBeTruthy();
  });

});
