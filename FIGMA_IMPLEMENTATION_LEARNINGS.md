# Figma implementation learnings

These checks are required before calling a Figma implementation complete.

## Source of truth

- Reload every supplied Figma frame during the final audit. Do not compare from memory.
- Map each frame to a named application state, including empty, filled, repeated, loading, success, failure, modal and sheet states.
- Preserve calculated product data unless the product owner explicitly asks for Figma mock values.

## Static visual checks

- Capture the implementation at the exact Figma viewport.
- Repeat the capture in a wide browser viewport when the product is a fixed-width mobile surface; viewport media queries can otherwise silently restore legacy layouts.
- Scope responsive decisions to the product container when the application remains mobile-width on desktop.
- Compare bounding boxes for the header, content sections, cards, chart, fixed footer and overlays.
- Check typography, wrapping, control geometry, colors, borders, radii and spacing.
- Verify the full painted area of containers, not only the content inside them.
- Verify every supplied icon or visual is present in every relevant state.

## Interaction checks

- Replay forward and backward navigation and inspect the transition itself.
- Test horizontal and vertical overflow at the target viewport.
- Exercise add, repeat, edit and delete flows for collection-based inputs.
- Verify active navigation items remain visible without changing width.
- Test sliders at minimum, middle and maximum positions.

## Motion checks

- Capture intermediate frames for loading-to-result and sheet transitions.
- Define one destination geometry and animate directly toward it.
- Do not use a temporary layout as an animation waypoint unless Figma explicitly shows it.
- Verify that remounts and state changes do not cause a one-frame jump.

## Final result checks

- Audit the final page independently from onboarding.
- Confirm the chart container and the chart canvas have the same intended dimensions.
- Confirm chart tooltips, selected markers and retirement markers represent distinct concepts.
- Check fixed actions at both the top and bottom of the viewport.
- Run visual checks after the final source edit; earlier screenshots are no longer evidence.

## Required handoff evidence

- Exact viewport used.
- Screens and interaction states captured.
- Known intentional differences from Figma.
- Lint, typecheck/build and layout regression status.
