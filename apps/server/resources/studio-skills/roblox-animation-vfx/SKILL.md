---
name: roblox-animation-vfx
description: "Use when adding, changing, or fixing Roblox animations, particles, beams, trails, tweens, camera shake, or other visual effects."
when_to_use: "Also when an effect is invisible, too weak, laggy or doesn't clean up, an animation won't play or blend, and when reviewing game feel or hit feedback."
last_reviewed: 2026-10-29
sources:
  - https://create.roblox.com/docs/reference/engine/classes/AnimationTrack
  - https://create.roblox.com/docs/animation/using
  - https://create.roblox.com/docs/reference/engine/classes/Animator
  - https://create.roblox.com/docs/reference/engine/classes/ParticleEmitter
  - https://create.roblox.com/docs/effects/particle-emitters
  - https://create.roblox.com/docs/tutorials/use-case-tutorials/vfx/create-volcanoes
  - https://create.roblox.com/docs/tutorials/use-case-tutorials/vfx/create-waterfalls
  - https://create.roblox.com/docs/reference/engine/classes/TweenService
  - https://create.roblox.com/docs/projects/server-authority
  - https://create.roblox.com/docs/projects/server-authority/techniques
  - original
  - https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine/classes/Instance.yaml
---

# roblox animation and vfx

## When to Load

Load when implementing character animation, particle or beam effects, tweens, camera feedback, or visual cleanup.

## Quick Reference

- Load tracks through an `Animator` on a `Humanoid` or `AnimationController`; set `AnimationTrack.Priority` deliberately.
- Use `GetMarkerReachedSignal()` for named gameplay or presentation cues, then disconnect or replace the listener when the track ends.
- Track lifecycle: `Ended` is post-fade cleanup; `Stopped` includes explicit stops. Same-priority tracks blend by weight; see full.md for control and loading guards.
- A burst `ParticleEmitter` usually has `Rate = 0` and uses `:Emit(count)` with a bounded lifetime; use pooling for frequent effects.
- Shape each effect as readable phases: warning, contact, brief peak, and fade. Give impact a clear silhouette before adding secondary particles, light, sound, or camera feedback.
- Use native particle flipbooks for animated textures; choose OneShot for a single impact or vary start frames for organic repetition. Custom mesh/image flipbooks may need their own playback code.
- Beams and trails need two attachments with a stable world-space relationship and a cleanup owner.
- Tween a bounded set of properties with `TweenService:Create`; cancel or destroy temporary effects when their owner ends, and use `Debris:AddItem` for simple lifetimes.
- In Server Authority projects, keep synchronized animation logic in `RunService:BindToSimulation()` (requires `Workspace.UseFixedSimulation` enabled in Studio), query current tracks instead of caching handles across rollback, and make predicted effects reversible.
- Profile particle counts, lights, post-processing, and per-frame camera work on the target device class.
- When an ability's look is open, prototype the current effect plus 3 variants side by side on a grey stage, loop them with the real animations in Run mode, and let the user pick and mix per ability (verified).
- Start simple: 3 or 4 layers per burst at Brightness 1 to 2, built from particles, trails and beams. Neon or ForceField parts as the effect only when the user confirms; keep each character's colour and theme, and make "cooler" mean a signature element, not more brightness (guideline from user feedback).
- Measure before timing: sample the animation in Edit with `Animator:StepAnimations(1/30)`, time trails and marks to the measured weapon-tip peaks, and match the server's damage timings (verified).
- Never render server-moved projectile parts (about 30 Hz, choppy): simulate them on each client from a shared deterministic module or one server message, and play impacts on the client (verified).
- `VelocityParallel` aligns the texture's horizontal axis with the velocity, so vertical streaks need Rotation 90 or -90; flat rings need Speed 0.01 to 0.5 to follow the attachment's tilt; ground particles never get a negative `ZOffset` (verified).
- Changing an emitter's `Color` recolours live particles, so clone the host per colour and per hit; smoke is a smooth flipbook with LightEmission 0 and LightInfluence 0, because lit smoke turns black in dark maps (verified).
- Captures: freeze Edit previews with emitter `TimeScale = 0` after preloading textures. Screenshots fail in Run mode and with Studio in the background, so fall back to functional checks instead of retrying (verified).

**Need the details?** Load `references/full.md` for animation and effect recipes.

## Harp playbooks

Two practical playbooks written by Harp from live Studio research (verified in Studio on
2026-10-20; the VFX playbook was extended on 2026-10-29 from a user-approved rework of a production
game's ability effects). Load them in addition to `references/full.md` when the task matches:

- `references/vfx-sealcode.md`: building, adapting, triggering and reviewing visual effects:
  explosion, fire, aura, hit, slash, lightning, portal, heal, shockwave, gun tracer and smoke recipes
  with numbers, the Emit and attribute trigger pattern, client versus server, adapting toolbox packs
  (recolour and scale helpers), performance budgets, a from-scratch effect with verified texture
  ids, and a playtest screenshot checklist. Also the user's taste defaults, a prototype stage of
  variants for the user to pick, measuring animations before timing effects, client-side
  projectiles, drain wisps, dash afterimages, charge indicators, Studio capture techniques and
  texture sourcing. Load it for any effect that must look good.
- `references/animation-sealcode.md`: using toolbox animations (and why most third-party ids will
  not play), publishing (ask the user: Roblox Assistant or user publishes), R15 joint axes and
  ranges, building KeyframeSequences by code or with the bridge `animation` tool, a hand-made
  animation recipe, and procedural tween recipes for doors and pickups. Load it before playing,
  making, publishing or reviewing an animation.
