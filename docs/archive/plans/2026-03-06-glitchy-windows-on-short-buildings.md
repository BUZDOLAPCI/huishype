# Glitchy Windows on Short/Fallback-Height Buildings

## The Problem

Buildings with "fallback heights" (sheds, garages, small structures near houses) have glitchy, depth-fight-looking procedural windows. Buildings of similar height that are NOT using the fallback height look fine.

## Where to See It

- Beeldbuisring 41, Eindhoven — the separate shed buildings nearby
- Zoom to z17-z18 to see the procedural windows clearly
- Screenshots of examples: `docs/plans/glitchy-windows/`

## What We Ruled Out

- **Not a height threshold issue**: Changed the shader's window activation threshold from `>= 3.0` to `>= 2.5` — no effect.
- **Not tile-boundary duplicates**: Added centroid-based tile assignment to eliminate buildings appearing in multiple tiles — no effect.
