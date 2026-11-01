Brief on Electron 45 APIs for Claudie. Everything is from the official docs fetched today unless marked UNVERIFIED. Base URL is https://www.electronjs.org/docs/latest/api/.

**1. Embedding web content**

WebContentsView (`web-contents-view`)
- Main-process only, and only after `ready`.
- Constructor is `new WebContentsView({ webPreferences, webContents })`. `view.webContents` is read-only.
- A WebContents can sit in only one view at a time.
- `win.contentView.addChildView(view)` and `view.setBounds({x,y,width,height})` appear in the docs example. `removeChildView` and `setVisible` are not on that page. They belong to the `View` class (see `view`), but I did not read that page.
- `contentView` and `addChildView` are documented on `base-window`. Check that `BrowserWindow` exposes them too, since the Claudie shell is probably a BrowserWindow.
- Closing a window does not destroy the `webContents` of its child views. Call `view.webContents.close()` in the window's `closed` handler, or you get leaks.
- Claudie's renderer is HTML, so a WebContentsView floats over it. Sync it by sending IPC from the renderer with `getBoundingClientRect()` of a placeholder div, on a ResizeObserver, scroll and window `resize`.
- Hide the view with `setVisible(false)` or a zero-size bounds whenever a modal or card must overlay it. It always paints above the renderer's DOM, so z-index cannot cover it.
- BrowserWindow `resize` (all platforms) and `resized` (Windows and macOS) events are available (`base-window`).
- `BrowserView` is deprecated, so do not use it.

`<webview>` tag (`webview-tag`)
- Disabled by default since Electron 5. Enable it with `webPreferences.webviewTag`.
- The docs say Chromium's webview is going through architectural changes that affect stability, including rendering, navigation and event routing. They advise against using it.
- The docs recommend an iframe, a WebContentsView, or avoiding embedded content.
- Pro: it sits in the DOM, so layout, z-index and clipping are free.
- Con: it is the discouraged option. Enabling it also adds attack surface in the main renderer. It is acceptable only with `will-attach-webview` locked down.
- Recommendation: WebContentsView with its own `session.fromPartition`, `contextIsolation` on, `nodeIntegration` off, `sandbox` on, and a `setWindowOpenHandler` that denies or redirects. No preload should expose Claudie IPC to it.

**2. Capture and automation**

- `webContents.capturePage(rect?, {stayHidden, stayAwake})` returns `Promise<NativeImage>` (`web-contents`).
- Omitting `rect` captures the visible page. `stayHidden` keeps a hidden page hidden.
- For a view that is not shown, the doc says the page counts as visible only when its window is hidden and the capturer count is above zero. I did not verify what happens for a child view that is merely hidden.
- `webContents.debugger` (`debugger`):
  - `attach('1.3')` throws on failure, so wrap it in try/catch.
  - `sendCommand(method, params, sessionId)` returns a Promise. It may not resolve until the target navigates if called before navigation.
  - Events: `message` `(event, method, params, sessionId)` and `detach` `(event, reason)`. Opening DevTools on that webContents detaches the session.
  - `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText` and `Accessibility.getFullAXTree` are UNVERIFIED here. The CDP docs pages only returned redirect stubs.
  - From memory: `getFullAXTree` takes optional `depth` and `frameId`, is likely experimental, and nodes carry `backendDOMNodeId`. Verify against https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/ and `/Input/` before relying on them.
- `webContents.sendInputEvent` requires the containing window to be focused, so CDP `Input.*` is the safer route for background automation.
- `session.fromPartition(partition, options)` (`session`):
  - A `persist:` prefix gives a persistent session. Without it the session is in-memory.
  - Options such as `cache` only apply if the partition has never been used.
  - Pair `setPermissionRequestHandler` with `setPermissionCheckHandler`.
  - `clearStorageData({origin, storages})` is available.

**3. Screen capture**

- `desktopCapturer` is a main-process module (`desktop-capturer`). The docs example calls `getSources` inside `session.setDisplayMediaRequestHandler`. Nothing in the docs says it moved or broke in Electron 45, and I could not confirm a renderer-side change.
- `getSources({types:['screen','window'], thumbnailSize, fetchWindowIcons})`.
- The default `thumbnailSize` is 150x150. Setting width or height to 0 skips thumbnails.
- The docs do not discuss full resolution. The practical approach is to set `thumbnailSize` to the display's pixel size, `display.size * display.scaleFactor` from `screen.getPrimaryDisplay()`, and call `source.thumbnail.toPNG()`. This is UNVERIFIED in the docs, but it is the established pattern.
- With PipeWire on Linux, only one source comes back. The macOS permission notes are irrelevant on Windows.
- Electron 45 removed the `MacCatapLoopbackAudioForScreenShare` flag. This is macOS-only.

**4. Content protection** (`base-window`)
- `setContentProtection(true)` on Windows calls `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE`.
- On Windows 10 2004 and later the window is removed from capture. Older versions capture a black window.
- It takes effect at the next desktop composition, so wait a frame before capturing.
- It also applies in remote sessions. The `AllowWindowCaptureExclusionInRemoteSessions` feature can disable that.
- Consequence for Claudie: if Claudie's own window is protected, `desktopCapturer` and `capturePage` of that window will not see it. Windows other than Claudie's still capture normally.

**5. Tray, login item, power** (`tray`, `app`, `power-save-blocker`)
- `new Tray(image|path, guid?)`.
  - Events: `click`, and `right-click` and `double-click` on Windows and macOS.
  - `setContextMenu(menu)` and `destroy()` are available.
  - ICO is recommended on Windows.
  - Use a GUID only with a code-signed executable. For an unsigned one the GUID is tied to the exe path, and moving the exe breaks tray creation.
  - The docs have no GC warning, but keep the Tray in a module-level variable anyway.
- To keep the app alive in the tray, handle `window-all-closed` without quitting. The existing handler at about main.js line 1840 quits and would need changing.
- `app.setLoginItemSettings({openAtLogin, path, args, enabled, name})` is supported on Windows. Quote any paths in `args`.
  - `openAsHidden` was REMOVED in 45.0.0 (also `wasOpenedAsHidden` and `restoreState` in `getLoginItemSettings`). Start hidden by passing your own arg, for example `args:['--hidden']`, and read `process.argv`.
  - Call `getLoginItemSettings({path, args})` with the same path and args you set, or `openAtLogin` reads wrong.
  - Windows returns `executableWillLaunchAtLogin` and `launchItems`.
  - In dev, `path` defaults to `electron.exe`, which would launch the bare Electron shell. Only enable this when `app.isPackaged`.
- `powerSaveBlocker.start('prevent-app-suspension' | 'prevent-display-sleep')` returns an integer id. `stop(id)` and `isStarted(id)` follow.
  - `prevent-display-sleep` outranks `prevent-app-suspension`.
  - For long agent runs, use `prevent-app-suspension` and stop it when the run ends.

**6. Protocol handler** (`app`, plus https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- Dev, on Windows: `if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('claudie', process.execPath, [path.resolve(process.argv[1])])`.
- Packaged: `app.setAsDefaultProtocolClient('claudie')`.
- On Windows the whole link, including the scheme, arrives as an argument. `open-url` is macOS-only.
- Use `requestSingleInstanceLock()`. In `second-instance`, `commandLine` has the link as its last element. `argv` may be reordered or get extra args, so search it with `find(a => a.startsWith('claudie://'))` instead of `pop()`. On cold start, scan `process.argv` the same way.
- The existing second-instance handler at about main.js line 1725 is the place to add this.
- The Windows Store (appx) build returns `true`, but the registry key is not visible to other apps.
- The docs' packaging config covers Electron Forge and Packager only (`protocols: [{name, schemes}]`). I could not verify the electron-builder `protocols` schema, because all the electron.build URLs returned empty or 404. From memory it takes `protocols: [{name, schemes: ['claudie']}]`, and NSIS writes the registry association at install time. Verify at https://www.electron.build/ before using it.

**7. Global shortcuts** (`global-shortcut`)
- `register` returns `false` on failure. If another app holds the accelerator, it fails silently.
- `isRegistered` only reports shortcuts this app registered, so it cannot detect another app's hold. Always check the boolean returned by `register`.
- Registration is not possible before `ready`, or while `setSuspended(true)` is in effect.
- `registerAll` takes an array of accelerators and one callback.
- Alt+Space is the Windows system-menu shortcut. The docs do not mention Windows conflicts. In practice it is often taken by PowerToys Run, Flow Launcher or Claude Desktop, so registration may return false.
- Ctrl+Shift+Space is already used by Claudie. Offer Alt+Space as a configurable option with a fallback, and show a notice when `register` returns false.

**Unresolved**
- CDP method details: Accessibility, Input and `Target.*`.
- electron-builder `protocols` schema.
- Whether a hidden child WebContentsView can use `capturePage` without `stayHidden` flicker.
- Whether `desktopCapturer` has any renderer-side change in v45.