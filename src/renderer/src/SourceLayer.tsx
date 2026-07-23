import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  SourceAnchor,
  SourceAnchorPaletteAction,
  SourceAnchorSelection,
  NormalizedSourceRegionBounds
} from "../../shared/learning-application";
import type { LearnerActionDisposition } from "../../shared/learner-operation";

const SOURCE_CONTEXT_CHARACTERS = 32;

interface SourceLayerProps {
  sourceId: string;
  content: string;
  mediaType?: "text/plain" | "image/png" | "image/jpeg";
  anchors: SourceAnchor[];
  highlight?: { startOffset: number; endOffset: number; exactText: string };
  onChooseAction?(selection: SourceAnchorSelection, action: SourceAnchorPaletteAction): void;
  actionAvailability?(action: SourceAnchorPaletteAction): LearnerActionDisposition;
  onChooseReplacement?(selection: SourceAnchorSelection): void;
  onActivateAnchor?(sourceAnchorId: string): void;
  focusAnchorId?: string | null;
}

interface EquationSegment {
  kind: "equation";
  equationIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

interface TextSegment {
  kind: "text";
  startOffset: number;
  endOffset: number;
  text: string;
}

type SourceSegment = EquationSegment | TextSegment;

interface PercentSourceRegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function SourceLayer({ sourceId, content, mediaType = "text/plain", anchors, highlight, onChooseAction, actionAvailability, onChooseReplacement, onActivateAnchor, focusAnchorId }: SourceLayerProps) {
  const sourceRef = useRef<HTMLElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const anchorMarkerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [selection, setSelection] = useState<SourceAnchorSelection | null>(null);
  const [drawingRegion, setDrawingRegion] = useState(false);
  const [keyboardRegion, setKeyboardRegion] = useState<PercentSourceRegionBounds | null>(null);
  const segments = useMemo(() => mediaType === "text/plain" ? sourceSegments(content) : [], [content, mediaType]);
  const validHighlight = highlight && content.slice(highlight.startOffset, highlight.endOffset) === highlight.exactText
    ? highlight
    : null;
  useEffect(() => {
    if (focusAnchorId) anchorMarkerRefs.current.get(focusAnchorId)?.focus();
  }, [focusAnchorId, sourceId]);

  const openPalette = (nextSelection: SourceAnchorSelection, origin: HTMLElement) => {
    originRef.current = origin;
    setSelection(nextSelection);
  };
  const closePalette = () => {
    setSelection(null);
    queueMicrotask(() => originRef.current?.focus());
  };
  const chooseAction = (action: SourceAnchorPaletteAction) => {
    if (!selection || !onChooseAction) return;
    onChooseAction(selection, action);
    closePalette();
  };
  const chooseReplacement = () => {
    if (!selection || !onChooseReplacement) return;
    onChooseReplacement(selection);
    closePalette();
  };
  const selectEquation = (segment: EquationSegment, origin: HTMLButtonElement) => {
    openPalette(textLocation(content, segment.startOffset, segment.endOffset, "equation", segment.equationIndex), origin);
  };
  const selectText = () => {
    const source = sourceRef.current;
    const browserSelection = window.getSelection();
    if (!source || !browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) return;
    const location = selectedTextLocation(source, browserSelection, content);
    if (!location) return;
    const equation = segments.find((segment): segment is EquationSegment => segment.kind === "equation"
      && location.startOffset >= segment.startOffset && location.endOffset <= segment.endOffset);
    openPalette(equation
      ? textLocation(content, location.startOffset, location.endOffset, "equation", equation.equationIndex)
      : textLocation(content, location.startOffset, location.endOffset, "text"), source);
  };
  const diagramSelection = (bounds: NormalizedSourceRegionBounds, origin: HTMLElement) => {
    setDrawingRegion(false);
    openPalette({ kind: "diagramRegion", bounds }, origin);
  };
  const pointerPosition = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clampRatio((event.clientX - bounds.left) / Math.max(bounds.width, 1)),
      y: clampRatio((event.clientY - bounds.top) / Math.max(bounds.height, 1))
    };
  };
  const beginDiagramRegion = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drawingRegion) return;
    drawStartRef.current = pointerPosition(event);
  };
  const finishDiagramRegion = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drawingRegion || !drawStartRef.current) return;
    const start = drawStartRef.current;
    const end = pointerPosition(event);
    drawStartRef.current = null;
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (width < 0.01 || height < 0.01) return;
    diagramSelection({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height }, event.currentTarget);
  };

  return (
    <section className="selectable-source-layer" aria-label="Source selection and anchors" data-source-id={sourceId}>
      <div className="source-selection-controls">
        <button
          className="secondary"
          aria-pressed={drawingRegion}
          onClick={() => {
            setDrawingRegion((current) => !current);
            queueMicrotask(() => sourceRef.current?.focus());
          }}
        >{drawingRegion ? "Cancel diagram-region drawing" : "Draw diagram region"}</button>
        <button
          className="secondary"
          aria-expanded={Boolean(keyboardRegion)}
          onClick={() => setKeyboardRegion((current) => current ? null : { x: 25, y: 25, width: 50, height: 50 })}
        >Define diagram region with keyboard</button>
      </div>
      {keyboardRegion && (
        <fieldset className="keyboard-region-controls">
          <legend>Diagram region bounds in percent</legend>
          {(["x", "y", "width", "height"] as const).map((coordinate) => (
            <label key={coordinate}>
              {coordinate === "x" ? "Left edge" : coordinate === "y" ? "Top edge" : coordinate === "width" ? "Width" : "Height"} percent
              <input
                type="number"
                min={coordinate === "width" || coordinate === "height" ? 1 : 0}
                max={coordinate === "x" || coordinate === "y" ? 99 : 100 - keyboardRegion[coordinate === "width" ? "x" : "y"]}
                value={keyboardRegion[coordinate]}
                onChange={(event) => setKeyboardRegion(updateKeyboardRegion(
                  keyboardRegion,
                  coordinate,
                  Number(event.target.value)
                ))}
              />
            </label>
          ))}
          <button
            className="primary"
            onClick={(event) => {
              diagramSelection({
                x: keyboardRegion.x / 100,
                y: keyboardRegion.y / 100,
                width: Math.min(keyboardRegion.width, 100 - keyboardRegion.x) / 100,
                height: Math.min(keyboardRegion.height, 100 - keyboardRegion.y) / 100
              }, event.currentTarget);
              setKeyboardRegion(null);
            }}
          >Use diagram region</button>
        </fieldset>
      )}
      <article
        ref={sourceRef}
        className={`source-selection-surface${mediaType !== "text/plain" ? " visual-source-surface" : ""}${drawingRegion ? " drawing-region" : ""}`}
        aria-label="Read-only Source Layer"
        tabIndex={0}
        onMouseUp={selectText}
        onKeyUp={selectText}
        onPointerDown={beginDiagramRegion}
        onPointerUp={finishDiagramRegion}
      >
        {mediaType === "text/plain" ? validHighlight ? (
          <>
            {content.slice(0, validHighlight.startOffset)}
            <mark aria-label="Opened Source Index match">{validHighlight.exactText}</mark>
            {content.slice(validHighlight.endOffset)}
          </>
        ) : segments.map((segment) => segment.kind === "text" ? segment.text : (
          <button
            className="source-equation"
            key={`${segment.startOffset}-${segment.endOffset}`}
            aria-label={`Select equation ${segment.equationIndex + 1}: ${segment.text}`}
            onClick={(event) => selectEquation(segment, event.currentTarget)}
          >{segment.text}</button>
        )) : <img className="source-layer-image" src={content} alt="Linked Source diagram" />}
        {anchors.flatMap((anchor) => anchor.selection.kind === "diagramRegion" ? [(
          <span
            className="diagram-anchor-marker"
            aria-label="Saved diagram-region Source Anchor"
            key={anchor.id}
            style={{
              left: `${anchor.selection.bounds.x * 100}%`,
              top: `${anchor.selection.bounds.y * 100}%`,
              width: `${anchor.selection.bounds.width * 100}%`,
              height: `${anchor.selection.bounds.height * 100}%`
            }}
          />
        )] : [])}
      </article>
      {anchors.length > 0 && (
        <section className="saved-source-anchors" aria-label="Saved Source Anchors">
          <p className="source-anchor-count" role="status">
            {anchors.length} saved {anchors.length === 1 ? "Source Anchor" : "Source Anchors"}
          </p>
          <ul>
            {anchors.map((anchor) => {
              const label = sourceAnchorLabel(anchor);
              return <li key={anchor.id}>{onActivateAnchor ? (
                <button ref={(element) => {
                  if (element) anchorMarkerRefs.current.set(anchor.id, element);
                  else anchorMarkerRefs.current.delete(anchor.id);
                }} className="anchor-marker" aria-label={`Open Anchor Marker for ${label}`} onClick={() => onActivateAnchor(anchor.id)}>{label}</button>
              ) : label}</li>;
            })}
          </ul>
        </section>
      )}
      {selection && <SelectionPalette selection={selection} onChoose={onChooseAction ? chooseAction : undefined}
        actionAvailability={actionAvailability}
        onChooseReplacement={onChooseReplacement ? chooseReplacement : undefined} onClose={closePalette} />}
    </section>
  );
}

function SelectionPalette({ selection, onChoose, actionAvailability, onChooseReplacement, onClose }: {
  selection: SourceAnchorSelection;
  onChoose?(action: SourceAnchorPaletteAction): void;
  actionAvailability?(action: SourceAnchorPaletteAction): LearnerActionDisposition;
  onChooseReplacement?(): void;
  onClose(): void;
}) {
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const selectionLabel = selection.kind === "diagramRegion" ? "selected diagram region" : `selected ${selection.kind}`;
  useEffect(() => firstActionRef.current?.focus(), []);
  return (
    <div
      className="selection-palette"
      role="dialog"
      aria-label={`Selection Palette for ${selectionLabel}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <p className="eyebrow">Selection Palette</p>
      <div className="selection-palette-actions">
        {onChooseReplacement ? <button ref={firstActionRef} className="primary"
          aria-label={`Use ${selectionLabel} as replacement location`} onClick={onChooseReplacement}>Use as replacement location</button> : <>
          <button ref={firstActionRef} className="primary" disabled={actionAvailability?.("explain") === "blocked"}
            aria-label={`Explain or unpack ${selectionLabel}`} onClick={() => onChoose?.("explain")}>Explain or unpack</button>
          <button className="secondary" disabled={actionAvailability?.("question") === "blocked"}
            aria-label={`Ask about ${selectionLabel}`} onClick={() => onChoose?.("question")}>Ask about this</button>
          <button className="secondary" disabled={actionAvailability?.("addNote") === "blocked"}
            aria-label={`Add note to ${selectionLabel}`} onClick={() => onChoose?.("addNote")}>Add note</button>
          <button className="secondary" disabled={actionAvailability?.("tellTutor") === "blocked"}
            aria-label={`Tell tutor about ${selectionLabel}`} onClick={() => onChoose?.("tellTutor")}>Tell tutor</button>
          <button className="secondary" disabled={actionAvailability?.("addToLearningTrail") === "blocked"}
            aria-label={`Add ${selectionLabel} to the Learning Trail`} onClick={() => onChoose?.("addToLearningTrail")}>Add to Learning Trail</button>
        </>}
      </div>
      <button className="text-button" aria-label="Close Selection Palette" onClick={onClose}>Cancel</button>
    </div>
  );
}

function sourceSegments(content: string): SourceSegment[] {
  const pattern = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g;
  const segments: SourceSegment[] = [];
  let cursor = 0;
  let equationIndex = 0;
  for (const match of content.matchAll(pattern)) {
    const startOffset = match.index;
    if (startOffset > cursor) {
      segments.push({ kind: "text", startOffset: cursor, endOffset: startOffset, text: content.slice(cursor, startOffset) });
    }
    const endOffset = startOffset + match[0].length;
    segments.push({ kind: "equation", equationIndex, startOffset, endOffset, text: match[0] });
    equationIndex += 1;
    cursor = endOffset;
  }
  if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: "text", startOffset: cursor, endOffset: content.length, text: content.slice(cursor) });
  }
  return segments;
}

function selectedTextLocation(
  root: HTMLElement,
  selection: Selection,
  content: string
): { startOffset: number; endOffset: number } | null {
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  const startOffset = Math.min(startRange.toString().length, endRange.toString().length);
  const endOffset = Math.max(startRange.toString().length, endRange.toString().length);
  if (startOffset === endOffset || endOffset > content.length) return null;
  return { startOffset, endOffset };
}

function textLocation(
  content: string,
  startOffset: number,
  endOffset: number,
  kind: "text",
): Extract<SourceAnchorSelection, { kind: "text" }>;
function textLocation(
  content: string,
  startOffset: number,
  endOffset: number,
  kind: "equation",
  equationIndex: number
): Extract<SourceAnchorSelection, { kind: "equation" }>;
function textLocation(
  content: string,
  startOffset: number,
  endOffset: number,
  kind: "text" | "equation",
  equationIndex = 0
): Extract<SourceAnchorSelection, { kind: "text" | "equation" }> {
  const location = {
    startOffset,
    endOffset,
    exactText: content.slice(startOffset, endOffset),
    prefix: content.slice(Math.max(0, startOffset - SOURCE_CONTEXT_CHARACTERS), startOffset),
    suffix: content.slice(endOffset, endOffset + SOURCE_CONTEXT_CHARACTERS)
  };
  return kind === "equation" ? { kind, equationIndex, ...location } : { kind, ...location };
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function updateKeyboardRegion(
  region: PercentSourceRegionBounds,
  coordinate: "x" | "y" | "width" | "height",
  value: number
): PercentSourceRegionBounds {
  const minimum = coordinate === "width" || coordinate === "height" ? 1 : 0;
  const maximum = coordinate === "x" || coordinate === "y"
    ? 99
    : 100 - region[coordinate === "width" ? "x" : "y"];
  const updated = { ...region, [coordinate]: Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)) };
  if (coordinate === "x") updated.width = Math.min(updated.width, 100 - updated.x);
  if (coordinate === "y") updated.height = Math.min(updated.height, 100 - updated.y);
  return updated;
}

function sourceAnchorLabel(anchor: SourceAnchor): string {
  if (anchor.selection.kind === "diagramRegion") {
    const { x, y, width, height } = anchor.selection.bounds;
    return `Diagram region at ${Math.round(x * 100)}% left, ${Math.round(y * 100)}% top, ${Math.round(width * 100)}% wide, ${Math.round(height * 100)}% high`;
  }
  const kind = anchor.selection.kind === "equation" ? `Equation ${anchor.selection.equationIndex + 1}` : "Text";
  return `${kind} Source Anchor: ${anchor.selection.exactText} (characters ${anchor.selection.startOffset}–${anchor.selection.endOffset})`;
}
