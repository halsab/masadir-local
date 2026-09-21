# Third-party notices

Masādir packages Electron and its Chromium/Node.js components. Electron 44.4.3
is distributed under the MIT license; its bundled `LICENSE` and
`LICENSES.chromium.html` are copied into the application resources from the
installed Electron distribution. Source: https://github.com/electron/electron.

The Windows build also packages `electron-squirrel-startup` 1.0.1
(Apache-2.0; source: https://github.com/mongodb-js/electron-squirrel-startup).
Its license is included in the application archive with the dependency.

Recoll and helper notices must be completed from the exact platform payload
before packaging. Each runtime manifest lists the exact component names,
versions, sources, license-text paths and checksums. No Recoll binaries or
third-party license texts have been supplied to this repository yet.
