# Story Templates - Authoring Guide

Templates live in `src/story-templates/<slug>/`. Each folder must contain `meta.json`, `index.html`, `styles.css`, and a generated `preview.jpg`.

Shared brand variables are in `src/story-templates/_brand/tokens.css`. Template canvases are fixed at 1080 by 1920 and should declare a HyperFrames root with `data-composition-id`, `data-width`, `data-height`, and `data-duration`.

Use `data-hf-image="<slot_id>"` on image tags and match each slot in `meta.json`. Use `data-hf-text="<override_id>"` for editable text. Required slots without values fail the render.

Run `yarn regen-previews` after adding or editing templates. Test one template with `POST /admin/stories/templates/<slug>/render-sample`, then use the slot detail page to render against real product images.

