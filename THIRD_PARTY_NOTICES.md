# Third-party notices

Masādir packages Electron and its Chromium/Node.js components. Electron 44.4.3
is distributed under the MIT license; its bundled `LICENSE` and
`LICENSES.chromium.html` are copied into the application resources from the
installed Electron distribution. Source: https://github.com/electron/electron.

The Windows build also packages `electron-squirrel-startup` 1.0.1
(Apache-2.0; source: https://github.com/mongodb-js/electron-squirrel-startup).
Its license text is bundled in resources as `LICENSE.electron-squirrel-startup`.

Recoll and helper notices are recorded by the packaged platform's
`runtime-manifest.json`. It lists exact component names, versions, sources,
checksums and paths to their bundled license texts under the runtime directory.
