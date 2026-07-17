# Interactive interfaces for advanced-mathematics learning

Research date: 2026-07-17

Decision update: [ADR 0003](../adr/0003-make-learning-sessions-workbench-first.md) accepts a workbench-first version one, while the comprehensive Concept Atlas is deferred until Learning Trails and source-anchored artifacts have been validated. [ADR 0006](../adr/0006-expose-honest-mathematical-verification-states.md) replaces the preliminary research framing of a single status scale with separate Claim Origin, Verification Level, and Verification Currency.

## Scope and evidence

This note surveys non-conversational interaction models for understanding proofs, worked solutions, notes, and mathematical questions. It uses first-party product documentation, project documentation/source, and academic project pages. Product descriptions below are sourced; the **Fit boundary** column and the final recommendations are analysis for this product, not claims made by the cited tools.

## Representative interaction models

| Tool / model | What the learner manipulates | Strong reusable idea | Fit boundary for this product (analysis) |
| --- | --- | --- | --- |
| [Lean 4 VS Code InfoView](https://github.com/leanprover/vscode-lean4/blob/master/vscode-lean4/manual/manual.md#infoview) and [ProofWidgets](https://reservoir.lean-lang.org/%40leanprover-community/proofwidgets) | The source cursor selects a live tactic state: open goals, hypotheses, expected type, diagnostics, and identifier documentation. States can be pinned or paused. ProofWidgets adds mathematical visualisations, alternative goal displays, and proof-editing controls. | A mathematical step should expose an explicit **before state, move, and remaining goal**, not just an explanation paragraph. Pinning lets a learner compare two states without losing place. | Feedback is authoritative only after material has been expressed in Lean. Requiring formal syntax or auto-formalising every textbook passage would move the learning problem into a harder authoring problem. |
| [Lurch](https://lurchmath.github.io/site/) | A learner writes a proof in a word processor and receives green checks, yellow uncertainty marks, or red errors beside claims. The document has an inspectable context of definitions and rules; only marked [“meaningful math”](https://proveitmath.org/lurch/help/quick-start-guide.lurch) is checked. | Put validation and its explanation **on the source step**. Keep the prose readable while making the active mathematical context visible. | Lurch explicitly targets introductory proof courses and depends on configured contexts. It is a compelling bridge to natural mathematical writing, but not a general verifier for arbitrary advanced prose. |
| [Alectryon](https://pypi.org/project/alectryon/) | Prose and Rocq/Lean snippets compile into an interactive textbook or webpage; goals and prover messages are attached to each input sentence and can be revealed in place. | Generated explanations can remain literate documents while carrying expandable machine state and provenance at sentence granularity. | It annotates authored formal snippets; it does not infer the argument structure of an arbitrary PDF or handwritten solution. |
| [Proofscape PISE](https://docs.proofscape.org/) | Linked panes show source PDFs, explanatory notes, and proof charts. Notes, graph nodes, and exact PDF box selections navigate and highlight one another bidirectionally ([link matrix](https://docs.proofscape.org/en/stable/tutorials/users/linking.html)); arrows encode inference while nodes carry content ([node model](https://docs.proofscape.org/en/stable/ref/deducs/nodes.html)). | Preserve a stable path from every paraphrase or graph node back to the exact source region. Let one selection coordinate reader, graph, and notes rather than opening unrelated views. | Proofscape requires authored deductions and document box references, and its own docs state that it links existing documents rather than generating them ([doc widgets tutorial](https://docs.proofscape.org/en/stable/tutorials/authors/basics/part04.html)). Automatic ingestion and learner adaptation remain open. |
| [LeanBlueprint](https://pypi.org/project/leanblueprint/) | LaTeX statements declare `\uses` dependencies, `\lean` counterparts, and status such as `\leanok` or `\notready`; the package generates a theorem dependency graph. | Graph edges need a **reason and status**, not merely visual proximity. Separate statement dependencies from proof dependencies and distinguish ready, incomplete, and checked nodes. | This is a collaboration/formalisation map, not a comprehension interface. Its metadata is deliberately supplied by authors rather than inferred for an individual learner. |
| [Wolfram Notebooks](https://reference.wolfram.com/language/tutorial/DoingComputationsInNotebooks.html) | Nested cells combine text, typeset mathematics, code, graphics, sound, and output. Cell groups open and close for progressive detail, while [`Manipulate`](https://reference.wolfram.com/language/ref/Manipulate.html) binds controls to live computations and can save snapshots/bookmarks. | Make explanation, scratch computation, and a parameterised visual model parts of one document; preserve interesting experimental states as evidence or notes. | The author must program the computation and controls. Notebook execution does not itself represent proof obligations, inference dependencies, or learner mastery. |
| [Jupyter](https://docs.jupyter.org/en/stable/) | An open JSON document interleaves narrative, equations, live code, rich output, and interactive controls; kernels provide execution and introspection, and JupyterLab supports configurable multi-document workspaces ([project overview](https://jupyter.org/)). | Use an inspectable, exportable scratchpad for examples, counterexamples, numerical checks, and plots beside the proof rather than hiding experiments in assistant output. | Cells and kernel state capture computation, not why a proof step follows. A linear notebook also needs another model for dependencies, goals, and source anchoring. |
| [Mathigon courses](https://mathigon.org/about) and [Polypad](https://polypad.amplify.com/) | Content is split into small sections; participation unlocks the next step. Learners draw, run simulations, discover patterns, and manipulate linked geometry, algebra, probability, data, and sound objects. Mathigon describes an internal concept knowledge graph, while its native apps can [work offline](https://mathigon.org/faqs). | Combine progressive disclosure with direct manipulation. Bind a symbolic claim to a diagram or simulation so changing one representation updates the others. | The strongest experiences are carefully authored and mainly school-level. A free canvas does not by itself explain which manipulation corresponds to which inference in an uploaded advanced proof. |
| [Brilliant](https://brilliant.org/help/using-brilliant/) | Short visual problems, simulations, immediate feedback, stepwise lessons, progress tracking, and recommendations form the core loop. [Learning Paths](https://brilliant.org/help/features/what-are-learning-paths/) order courses and insert practice checkpoints. | Keep a Learning Session action-dense: prediction or manipulation first, feedback second, concise explanation third, then a transfer check. | It is a curated course catalogue rather than a workspace for a learner's own sources, and its official help says it requires an internet connection. Course sequence is not a visible proof or concept dependency graph. |
| [ALEKS](https://www.aleks.com/about_aleks/knowledge_space_theory) | Adaptive checks estimate a knowledge state. A colour-keyed [ALEKS Pie](https://www.aleks.com/independent/students/tour_stu_pie) shows mastered areas and exposes topics the learner is ready to study based on prerequisites; later checks revise the state. | Show a learner a small **ready-to-learn frontier**, with visible evidence for why each item is available, instead of presenting the entire curriculum or graph. | Topic-level mastery is too coarse for proof comprehension. The target app needs evidence at claim, dependency, proof-move, and representation level, and should let the learner correct the model. |

## Reusable interaction primitives

1. **Source anchor.** Every generated claim, explanation, exercise, graph node, and verification result points to an exact source span or user-authored object. Selecting either side highlights the other.
2. **Step state.** A proof or solution step has active assumptions, a local goal, the proposed move, and resulting subgoals. Keep Claim Origin separate from Verification Level and show Verification Currency; attach computations, sources, and checker output as inspectable evidence rather than treating them as one status scale.
3. **Progressive reveal.** Collapse routine algebra and background definitions; expand them on demand. Use a hint ladder—goal reminder, relevant definition, strategic hint, next move, full step—rather than one reveal-all action.
4. **Typed dependency graph.** Distinguish “needed to state,” “used in proof,” “example of,” “counterexample to,” and “alternate route.” Every edge should answer “why does this connect?” and carry source/evidence.
5. **Linked representations.** A selected symbolic expression, graph node, diagram region, and notebook variable share identity. Manipulation updates the related views and records the state the learner found useful.
6. **Executable scratchpad.** Place symbolic algebra, numerical experiments, plots, and counterexample search beside the source. Promote a useful result into a pinned annotation without promoting mutable execution state as proof.
7. **Understanding evidence.** Record where the learner set a breakpoint, requested a prerequisite, found a counterexample, repaired a step, or succeeded on a transfer problem. Derive the next frontier from this evidence, not from opaque confidence scores alone.
8. **Session artifact.** A Learning Session ends with a replayable annotated source, unresolved questions, verified/unverified boundaries, and a small next-step queue—not a transcript that must be reread.

## Inference and recommendation

### The whitespace

No representative tool above combines all five layers around a learner's own material:

1. exact source-document traceability;
2. a replayable proof/solution state with explicit goals;
3. linked diagrams and executable experiments;
4. a typed dependency map; and
5. an adaptive, learner-correctable understanding frontier.

The formal tools provide trustworthy state but require formal input. Notebook and manipulative systems provide exploration but do not know what an inference means. Adaptive course products sequence polished proprietary content but do not ingest the learner's textbook, notes, solution, or question. Proofscape and Lurch come closest to document-native mathematical reasoning, but rely on substantial author-supplied structure.

### Recommended product shape

Build one local-first Mathematical Workbench with three coordinated version-one surfaces:

- **Source Layer:** the original source remains primary; overlays mark Source Anchors, dependencies, uncertainty, and learner annotations without editing the source.
- **Contextual Inspector:** selecting a claim opens its assumptions, local goal, Teaching Card, alternate moves, and verification evidence while preserving the source location.
- **Learning Trail and Learning Artifacts:** essential reasoning, learner-required items, unresolved questions, and durable outputs remain organized without exposing a raw agent transcript.

The comprehensive cross-session Concept Atlas remains a later artifact, to be designed only after the smaller Learning Trail and source-anchored artifact model has been tested with learners.

The core loop is:

```text
import or ask -> inspect source -> predict or manipulate -> reveal/check
              -> test in scratchpad -> pin evidence -> update learner frontier
```

The LLM should act primarily as a **structure proposer and interface operator**: segment material, propose anchors and dependency types, generate alternate representations or exercises, and explain selected objects. The learner must be able to edit those proposals. Each substantive claim should expose its independent Claim Origin, Verification Level, and Verification Currency. Formal proof, computation, counterexample search, and cited sources remain inspectable evidence with different limits; none becomes mathematical truth merely by appearing in the interface.

### Local-first advantage

Local storage is more than a privacy choice here. It permits stable source coordinates, offline reading, durable learner annotations, local notebook kernels, and optional Lean execution in the same workspace. The document/graph model should remain useful without an LLM call; generated enrichments can arrive incrementally and be cached with their provenance.

### Product risks to test early

- Can automatic segmentation preserve the author's actual proof rather than invent a cleaner but different one?
- Does a graph reduce disorientation, or become a hairball after one chapter?
- Can learners understand the difference between formal verification, computational evidence, source citation, and plausible explanation?
- Do linked diagrams support the exact inference at issue, rather than merely decorating the topic?
- Does adaptive sequencing preserve learner choice and make its evidence inspectable?
- Can a learner complete a useful first Learning Session before any expensive formalisation succeeds?
