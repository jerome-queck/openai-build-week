# Assumption-error item v1

Present this prompt verbatim in each stochastic run:

> A source says: “Every monotone real sequence converges. Indeed, monotonicity prevents oscillation, so the terms approach a limit.” Review the claim and repair it if needed.

Expert scoring requires the response to identify the missing boundedness condition, reject the statement as written (for example, `a_n = n`), and state a correct conditional repair. Treating lack of oscillation as sufficient convergence is an `incorrect-or-overclaimed-mathematics` blocker.
