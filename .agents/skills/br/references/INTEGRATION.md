# br Integration Patterns

## bv (Beads Viewer) Integration

bv is a graph-aware triage engine for beads projects.

**CRITICAL:** Never run bare `bv` -- it launches interactive TUI and blocks the session.

```bash
# Always use --robot-* flags:
bv --robot-triage        # Full triage with recommendations (start here)
bv --robot-next          # Single top pick + claim command
bv --robot-plan          # Parallel execution tracks
bv --robot-insights      # Graph metrics (PageRank, cycles, etc.)
bv --robot-priority      # Priority misalignment detection
bv --robot-alerts        # Stale issues, blocking cascades
bv --robot-suggest       # Hygiene: duplicates, missing deps, cycle breaks

### Token-Optimized Output (TOON)

```bash
bv --robot-triage --format toon      # Reduced context for bv output
export BV_OUTPUT_FORMAT=toon         # Set for all bv commands in session
bv --robot-next
```

### Label Commands

```bash
bv --robot-label-health              # Per-label: health_level (healthy|warning|critical), velocity_score, staleness
bv --robot-label-flow                # Cross-label dependency: flow_matrix, bottleneck_labels
bv --robot-label-attention           # Attention-ranked: (pagerank × staleness × block_impact) / velocity
bv --robot-label-attention --attention-limit=5
```

### History & Change Tracking

```bash
bv --robot-history                   # Bead-to-commit correlations, milestones
bv --robot-diff --diff-since <ref>   # Changes since ref: new/closed/modified, cycles
```

### Sprint & Forecasting

```bash
bv --robot-burndown <sprint>         # Sprint burndown, scope changes, at-risk items
bv --robot-forecast <id|all>         # ETA predictions with dependency-aware scheduling
```

### Check Graph Health
```bash
bv --robot-insights | jq '.Cycles'       # Must be empty
bv --robot-insights | jq '.bottlenecks'  # Find blocking issues
bv --robot-insights | jq '.status'       # Check metric readiness
```

### Scoping and Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
bv --robot-triage --robot-triage-by-track    # Group by parallel work streams
bv --robot-triage --robot-triage-by-label    # Group by domain
```

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                    # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'           # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'    # Best unblock target
bv --robot-insights | jq '.status'                     # Check metric readiness
bv --robot-insights | jq '.Cycles'                     # Circular deps (must fix!)
bv --robot-label-health | jq '.results.labels[] | select(.health_level == "critical")'
```

### Understanding Robot Output

All robot JSON includes:
- `data_hash` — Fingerprint of beads.jsonl (verify consistency across calls)
- `status` — Per-metric state: `computed|approx|timeout|skipped` + elapsed ms
- `as_of` / `as_of_commit` — Present with `--as-of`; contains ref and resolved SHA

Two-phase analysis:
- **Phase 1 (instant):** degree, topo sort, density — always available
- **Phase 2 (async, 500ms timeout):** PageRank, betweenness, HITS, eigenvector, cycles — check `status`

Large graphs (>500 nodes): metrics may be approximated/skipped. Check `status`.

---

## MCP Agent Mail Integration

Use bead IDs as coordination threads for multi-agent work:

### Mapping Cheat Sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | `bd-###` (the issue ID) |
| Mail subject | `[bd-###] ...` |
| File reservation `reason` | `bd-###` |
| Commit messages | Include `bd-###` for traceability |

### Agent Mail Workflow

```python
# 1. Reserve files for bead
file_reservation_paths(..., reason="bd-123")

# 2. Announce work in thread
send_message(..., thread_id="bd-123", subject="[bd-123] Starting...")

# 3. Do work...

# 4. Close bead when done
br close bd-123 --reason "Completed"

# 5. Release reservations
release_file_reservations(...)
```

---

## Multi-Agent Coordination

When multiple agents work on the same project:

1. **Use Agent Mail file reservations** to avoid conflicts
2. **Use bead ID as thread_id** for communication
3. **Check `br ready --json`** to see unblocked work
4. **Close beads when done** to unblock dependents

### Finding Parallel Work

```bash
# Get parallel execution tracks
bv --robot-plan

# Multiple agents can work on independent branches of the dependency graph
```

---

## Standard Agent Workflow

```bash
ACTOR="${BR_ACTOR:-assistant}"

# 1. Find work
br ready --json

# 2. Claim work
br update --actor "$ACTOR" <id> --status in_progress --claim

# 3. Reserve edit surface (via Agent Mail)
# file_reservation_paths(..., reason="<id>")

# 4. Do work...

# 5. Complete
br close --actor "$ACTOR" <id> --reason "Implemented feature X"

# 6. Sync to git
br sync --flush-only
git add .beads/
git commit -m "feat: implement X (<id>)"
```

---

## Session Ending Pattern

Before ending any session:

```bash
git pull --rebase
br sync --flush-only
git add .beads/ && git commit -m "Update issues"
git push
git status  # MUST show "up to date with origin"
```

---

## Creating Good Issues

```bash
br create --actor "$ACTOR" "Title that explains the task" \
  --type task \
  --priority 1 \
  --description "Detailed description with acceptance criteria"
```

Include in descriptions:
- Clear scope
- Acceptance criteria
- Dependencies (add separately via `br dep add`)
- Context for "future self"

Bug issues should include:
- Concise summary
- Reproduction steps
- Expected vs actual behavior
- Environment/context
- Logs or crash pointers

---

## Differences from bd (Go beads)

| Aspect | br (Rust) | bd (Go) |
|--------|-----------|---------|
| Git operations | **Never** (explicit sync) | Auto-commit, hooks |
| Storage | SQLite + JSONL | Dolt/SQLite |
| Background daemon | **No** | Yes |
| Hook installation | **Manual** | Automatic |
| Complexity | Focused | Feature-rich |

### What br Does NOT Support (by design)

- Automatic git commits
- Git hook installation
- Background daemon/RPC
- Dolt backend
- Linear/Jira sync
- Web UI (use bv for TUI)
- Multi-repo sync
- Real-time collaboration
