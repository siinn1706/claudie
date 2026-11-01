# Brief: Windows input injection and foreground-window read from Electron 45 main, plus the computer-use schema

Sources I fetched are linked. Items marked (knowledge) come from my own Win32/koffi knowledge and I did not verify them online.

## Recommendation
Use **koffi** (`koffi@^2.16`, the latest 2.x I could confirm; jsdelivr shows 2.16.0). Call user32 and kernel32 in-process from `main.js`, with no native compile step.

- koffi's docs say a prebuilt binary ships inside the npm package, so no C++ compiler is needed. Windows x64 and ARM64 are both supported and tested. It needs Node 16 or later. [koffi.dev](https://koffi.dev/)
- Its packaging doc says electron-builder packaging "should work as-is". In Electron it also looks for the module under `process.resourcesPath`, in per-platform folders such as `koffi/win32_x64/koffi.node`. [packaging](https://koffi.dev/packaging), [doc mirror](https://cdn.jsdelivr.net/npm/koffi@2.16.0/doc/packaging.md)
- koffi is N-API-style FFI, so there is no electron-rebuild step. It is the only option here that needs none.
- Safe default: add `asarUnpack: ["node_modules/koffi/**"]` to the electron-builder config. My inference is that it is not strictly required. Electron's own docs say native `*.node` files cannot be loaded from inside an asar archive without unpacking. [Electron asar docs](https://github.com/electron/electron/blob/v11.0.0-beta.7/docs/tutorial/application-packaging.md)
- Claudie runs from source today, so there is nothing to configure until packaging is added.

## Alternatives
| Option | Verdict |
|---|---|
| **koffi** | Recommended. Prebuilt, in-process, about 1 ms per call. Windows-only here, which matches the app. |
| `@nut-tree-fork/nut-js` (libnut-win32 2.7.5) | Not recommended. The libnut-win32 page documents a build-from-source flow. The only Electron prebuild references I found date from Electron 12, and I found no current confirmation for Electron 45. It also adds more than we need (image matching and similar). [npm](https://npmjs.com/package/@nut-tree-fork/libnut-win32), [issue 317](https://github.com/nut-tree/nut.js/issues/317) |
| `robotjs` | Not recommended. It needs electron-rebuild and a Visual Studio toolchain. It is poorly maintained and has no Unicode typing (knowledge). |
| PowerShell with `Add-Type` C# | Works as a fallback with a persistent stdin JSON loop. Cold start is 300-800 ms, and Add-Type compiles C# on every start. Antivirus and Constrained Language Mode can break it. There is also a process to track and kill, which `process-management.md` makes extra work. Choose it only if koffi fails to load. |

## koffi sketch (knowledge: not tested, validate with node --check and a live run)
```js
import koffi from 'koffi';
const u32 = koffi.load('user32.dll'), k32 = koffi.load('kernel32.dll');

const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx:'int32', dy:'int32', mouseData:'uint32',
  dwFlags:'uint32', time:'uint32', dwExtraInfo:'uintptr_t' });
const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk:'uint16', wScan:'uint16',
  dwFlags:'uint32', time:'uint32', dwExtraInfo:'uintptr_t' });
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg:'uint32', wParamL:'uint16', wParamH:'uint16' });
const INPUT_U = koffi.union('INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
const INPUT = koffi.struct('INPUT', { type:'uint32', u: INPUT_U }); // sizeof = 40 on x64
const RECT = koffi.struct('RECT', { left:'int32', top:'int32', right:'int32', bottom:'int32' });

const SendInput = u32.func('uint32 __stdcall SendInput(uint32 n, INPUT *p, int cb)');
const SetCursorPos = u32.func('bool __stdcall SetCursorPos(int x, int y)');
const GetCursorPos = u32.func('bool __stdcall GetCursorPos(_Out_ int32 *pt)'); // pt is a 2-int array
const GetForegroundWindow = u32.func('void * __stdcall GetForegroundWindow()');
const GetWindowTextW = u32.func('int __stdcall GetWindowTextW(void *h, _Out_ uint16 *buf, int n)');
const GetWindowRect = u32.func('bool __stdcall GetWindowRect(void *h, _Out_ RECT *r)');
const GetWindowThreadProcessId = u32.func('uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *pid)');
const OpenProcess = k32.func('void * __stdcall OpenProcess(uint32 a, bool i, uint32 pid)');
const QueryFullProcessImageNameW = k32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 f, _Out_ uint16 *buf, _Inout_ uint32 *n)');
const CloseHandle = k32.func('bool __stdcall CloseHandle(void *h)');
// OpenProcess access: PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
// koffi.decode(buf, 'char16_t', len) or Buffer.toString('utf16le') turns the UTF-16 buffer into a string.

const send = (...ins) => SendInput(ins.length, ins, koffi.sizeof(INPUT));
const mouse = (flags, data = 0) => ({ type: 0, u: { mi: { dx:0, dy:0, mouseData:data, dwFlags:flags, time:0, dwExtraInfo:0 } } });
const uni = (cp, up) => ({ type: 1, u: { ki: { wVk:0, wScan:cp, dwFlags: 0x0004 | (up ? 0x0002 : 0), time:0, dwExtraInfo:0 } } });
// Unicode text: iterate code units of the string (surrogate pairs are sent as two units), push down+up for each, then one SendInput call.
```

Flags:
- Mouse: LEFTDOWN 0x2, LEFTUP 0x4, RIGHTDOWN 0x8, RIGHTUP 0x10, MIDDLEDOWN 0x20, MIDDLEUP 0x40, WHEEL 0x800 (mouseData = 120 per notch), HWHEEL 0x1000, ABSOLUTE 0x8000, VIRTUALDESK 0x4000.
- Keyboard: KEYUP 0x2, UNICODE 0x4, SCANCODE 0x8.
- INPUT types: mouse 0, keyboard 1.

- **Typing:** `KEYEVENTF_UNICODE` with `wVk=0` and `wScan` set to the UTF-16 unit types any character. Games and some legacy apps ignore it.
- **Key combos:** Use virtual-key codes for `key("ctrl+s")` and for Enter, Tab and arrows. Arrows, Home, End, Insert, Delete, PageUp and PageDown also need `KEYEVENTF_EXTENDEDKEY` (0x1).
- **Mouse position:** Prefer `SetCursorPos(physX, physY)` followed by button-only SendInput events. It takes physical pixels directly and avoids the 0-65535 normalization.
- **If you must use ABSOLUTE:** The formula is `nx = round((x - vx) * 65535 / (vw - 1))`. Get `vx`, `vy`, `vw`, `vh` from `GetSystemMetrics` indices 76, 77, 78, 79 with `MOUSEEVENTF_VIRTUALDESK`. This breaks on mixed-DPI setups if the process is not per-monitor aware.

## DPI and coordinate mapping (knowledge)
- Electron's Windows manifest is per-monitor-DPI aware, so Win32 calls in main see physical pixels.
- Electron's `screen` API reports DIPs. Convert with `screen.dipToScreenPoint` or `screen.dipToScreenRect`.
- Capture with `desktopCapturer.getSources({types:['screen'], thumbnailSize:{width: d.size.width*d.scaleFactor, height: d.size.height*d.scaleFactor}})`. Match the source to its display through `display_id`.
- **Pipeline:**
  1. Capture the display's physical bitmap.
  2. Downscale it to the model size.
  3. Keep `scale = physW / modelW`.
  4. On a click: `phys = display.physicalOrigin + modelCoord * scale`.
- Physical origin is `display.bounds` converted to physical pixels. Take it from `dipToScreenPoint(display.bounds)` rather than `bounds.x * scaleFactor`, because the second is wrong on mixed-DPI setups.
- Scope the agent to one display, normally the primary or the one under the Claudie window. This avoids multi-monitor ambiguity.
- Clamp coordinates to that display's rectangle.
- Hide or minimize Claudie's own windows before capture, or the agent will screenshot itself.

## UIPI
- A medium-integrity process cannot inject input into elevated (admin) windows. `SendInput` returns 0 or silently has no effect, and `GetLastError` is often not informative.
- Detect it by comparing the number of events sent to `SendInput`'s return value.
- To detect an elevated target, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` may fail with access denied. Report that to the model as "target is elevated".
- UWP and secure desktops (UAC, lock screen) are also unreachable.
- `SetForegroundWindow` is restricted by the foreground lock. Rely on clicking the window instead.

## Foreground window read
`GetForegroundWindow` then `GetWindowTextW`, `GetWindowRect` (physical pixels) and `GetWindowThreadProcessId`. Then `OpenProcess(0x1000)`, `QueryFullProcessImageNameW`, and take the basename. `GetWindowRect` includes the invisible resize border on Windows 10/11. Use `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS = 9)` from `dwmapi.dll` for the visible bounds.

## Anthropic computer-use schema (current docs, fetched)
Source: [computer-use-tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

The docs list three tool versions.
1. **Newest: `computer_toolset_20260801`**
   - No beta header.
   - Required on Claude 5.5+ on the Claude API.
   - Declared as `{type:"computer_toolset_20260801", configs:{zoom:{enabled:false}}}`.
   - Each action is its own tool. The `tool_use` block has `name:"left_click"`, `toolset_name:"computer"`, and `input:{coordinate:[x,y]}`.
   - Results must echo `"toolset_name":"computer"`.
   - Results may contain only text and image content.
   - There are 17 members:

     | Group | Members |
     |---|---|
     | Screen | `screenshot`, `zoom{region:[x0,y0,x1,y1]}`, `cursor_position`, `wait{duration<=300}` |
     | Clicks | `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click` (each takes optional `coordinate` and optional modifier `text` such as `shift`, `ctrl`, `alt`, `super`, or `+`-joined) |
     | Mouse | `left_click_drag{start_coordinate,coordinate,text?}`, `mouse_move{coordinate}`, `left_mouse_down`, `left_mouse_up`, `scroll{scroll_direction, scroll_amount, coordinate?, text?}` |
     | Keyboard | `type{text}`, `key{text, repeat 1-100}`, `hold_key{text, duration}` |

   - A response can contain several `tool_use` blocks. Run them in order and stop at the first failure. Answer the rest with `is_error:true` and the content `"Not executed: an earlier computer action in this turn failed."`
2. **`computer_20251124`**
   - Beta header `computer-use-2025-11-24`.
   - Definition: `{type, name:"computer", display_width_px, display_height_px, display_number, enable_zoom?}`.
   - The action is carried in `input.action`.
   - Per the migration notes, the same action set applies (clicks, `left_click_drag`, `left_mouse_down/up`, `scroll`, `hold_key`, `wait`, `zoom`, `key`, `type`, `mouse_move`, `cursor_position`).
   - Claude 5.5+ on the Claude API accepts only the toolset. Bedrock still accepts this version.
3. **`computer_20250124`**
   - Beta header `computer-use-2025-01-24`.
   - Used by Haiku 4.5 and Sonnet 4.5.
   - Its action list is not shown on the pages I read.

**For Claudie:** it exposes the tools through an SDK MCP server, so the model sees MCP tool schemas rather than the native computer toolset. Mirror the toolset member names and parameters: `screenshot`, `left_click{coordinate,text}`, `type{text}`, `key{text,repeat}`, `scroll{coordinate,scroll_direction,scroll_amount}`, `left_click_drag`, `mouse_move`, `cursor_position`, `wait`, `zoom{region}`. Use the same coordinate semantics and modifier syntax so trained behaviour transfers. I have not confirmed whether the Agent SDK can attach the native computer tool, so check [code.claude.com/docs/en/agent-sdk](https://code.claude.com/docs/en/agent-sdk).

## Resolution and scaling guidance (docs)
- Coordinates are in the pixel space of the screenshot you return. If you downscale, multiply the model's coordinates back by `1/scale`.
- Recommended sizes: 1024x768 or 1280x720 for desktops, 1280x800 or 1366x768 for web apps. Avoid anything above 1920x1080. 1280x720 is the baseline if accuracy is poor.
- Image limits:
  - Opus 4.7+ and all toolset models: long edge up to 2576 px and up to 4784 visual tokens (`ceil(w/28) x ceil(h/28)`).
  - Earlier models: long edge up to 1568 px and about 1.15 MP.
  - Oversized images are rejected, not downscaled.
- Scale formula: `min(1, 1568/longEdge, sqrt(1.15e6/(w*h)))` for the older limits.
- Keep screenshots to 20 per request or fewer. Beyond that a stricter per-side limit applies.
- The toolset adds about 4,500 input tokens. Disabling zoom saves about 410.

## Unresolved
- koffi union and array-of-struct call syntax comes from my knowledge. The koffi.dev union and pointer pages returned 404 or did not cover it, so verify against the Composite types and Pointers pages.
- I found no official statement of Electron 45 compatibility for koffi. It is N-API-style, so I expect it to work.
- I did not confirm whether the Agent SDK can use the native computer toolset instead of MCP tools.