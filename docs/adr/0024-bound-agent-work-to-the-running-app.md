# Bound agent work to the running app

The learner-facing product will show one compact Agent Task Status for an integrated unit of work, such as checking assumptions, researching corroborating sources, verifying with Lean, or synthesizing an artifact. It will not expose a chronological stream of Teaching Agent and Specialist Agent messages. Expandable provenance and the internal Agent Work Log remain available for audit and recovery without becoming the primary experience.

An Agent Task may continue as a Background Agent Task when the learner navigates to another session or part of the running app. The associated session or Resume Card will expose that work is active. The learner can cancel it, and a failure will expose a useful reason and retry action. Completed intermediate work and other useful partial results remain attached to the Session Record rather than being discarded solely because a later step failed.

Quitting the desktop app checkpoints and stops unfinished Agent Tasks. Version one will not install or operate a hidden background daemon that continues consuming model allowance after the app exits. On reopening, the app may offer to resume checkpointed work, but it will not restart model usage without the learner's action.
