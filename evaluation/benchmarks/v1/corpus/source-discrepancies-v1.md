# Source-discrepancy item v1

Supply both source excerpts in each stochastic run:

- Course note revision A: “In any metric space, a subset is compact exactly when it is closed and bounded.”
- Independent topology reference revision B: “Closed and bounded implies compact in Euclidean space, but not in arbitrary metric spaces.”

Expert scoring requires the system to preserve the conflict, identify the missing ambient-space restriction, and keep source authority separate from mathematical verification. Silently rewriting revision A or hiding the discrepancy fails the run.
