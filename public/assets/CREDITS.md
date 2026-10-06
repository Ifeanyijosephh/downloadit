# Asset credits & licences

Everything in this directory is either generated in this repository or copied
from a freely-licensed package at build time. Nothing is hotlinked at runtime.

## hero-background.mp4  (route (a): original CGI render)

- **Source:** original computer-generated imagery. It is a raymarched volumetric
  render produced entirely in this repository by `tools/make-hero-video.mjs`
  (renderer in `tools/lib/hero.mjs`). No stock footage, no Blender scene, no
  third-party clip, no hotlinked URL was used.
- **Licence:** © Ifeco Digitals, released under the project MIT licence.
- **Spec:** H.264, 854×480, 24 fps, 7 s, silent, seamless loop, ≤ 2 MB.
- **Upstream URL:** n/a (generated locally). Regenerate with `npm run assets:video`.

## hero-poster.webp

- First frame of the hero render, WebP-encoded by the same tool. Same licence.

## assets/icons/3d/*.png  (14 icons + @2x)

- **Source:** original 3D renders produced by `tools/make-icons.mjs` using the
  software renderer in `tools/lib/renderer.mjs` (per-pixel raymarched SDFs with a
  single upper-left key light, cool rim light, matte plastic + subsurface,
  contact shadow at 20% opacity). No third-party 3D pack, no SVG, no icon font.
- **Licence:** © Ifeco Digitals, MIT.
- **Trademark notice:** the platform marks (YouTube, Instagram, TikTok, X,
  Facebook, Vimeo, Snapchat, Pinterest, Reddit, LinkedIn) are the trademarks of
  their respective owners; they are depicted only to indicate compatibility.
- Regenerate with `npm run assets:icons`.

## Favicon set (favicon-32.png, favicon-180.png, favicon.ico)

- Rendered from the same 3D "logo cube" scene by `tools/make-brand-assets.mjs`.
  `favicon.ico` wraps the 32×32 PNG in an ICO container. Licence: MIT.

## og-cover.png

- 3D icon cluster rendered in-repo; the wordmark text is composited with
  ffmpeg drawtext. Licence: MIT. The raster wordmark uses **DejaVu Sans**
  (DejaVu/Bitstream Vera licence, free for any use) because it is the build
  host's system font; the *UI* font in the app is Poppins (below).

## fonts/Poppins-*.woff2  + fonts/LICENSE.txt

- **Source:** `@fontsource/poppins` (npm), latin subsets, copied unmodified by
  `tools/make-fonts.mjs`. No Google Fonts / runtime CDN.
- **Licence:** SIL Open Font License 1.1. Poppins is Copyright 2020 The Poppins
  Project Authors — the Indian Type Foundry. Full text in `fonts/LICENSE.txt`.
