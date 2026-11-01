# Vendored libraries

## mermaid 11.17.2

- License: MIT (see `LICENSE-mermaid`). The bundle also contains third-party libraries (d3, dagre, cytoscape, khroma and others) under their own licenses; their notices travel inside `mermaid.min.js` itself, in its "Bundled license information" comments (lodash, DOMPurify, cytoscape and others), as the upstream build keeps them.
- Source: https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js (npm package `mermaid`, file `dist/mermaid.min.js`).
- Used by `artefatos.js`, loaded lazily the first time a mermaid code block is previewed.
- Upgrade: re-copy `dist/mermaid.min.js` and `LICENSE` from the new package version and update the version above.
