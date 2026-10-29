# sldz

A Markdown slide generator/server with collaborative vector drawing, private browser terminals, an embeddable web pane, and live Markdown editing.

## Run

```bash
npm install
npm run build
node dist/cli.js s1.md --open
```

During development:

```bash
npm run dev -- s1.md --open
```

Slides are separated by a line containing `---`. The command writes generated HTML to `.sldz/<name>.html`, starts a server, and prints a random share URL. Everyone sees the same drawing canvas, while each browser gets its own shell. The tools dock into a mosaic around the slide. Use the arrow button to cycle their default position through right, left, top, and bottom. When both tools are open they split the dock; drag its boundary or divider to resize it, or use ↗ to detach a movable pane and resize it from its corner.

Options:

```text
-p, --port <port>    HTTP port; 0 chooses a free port (default: 4173)
--host <host>        Bind address (default: 0.0.0.0)
-o, --output <file>  Generated HTML path
--title <title>      Browser title
--open               Open the local URL
```

Navigation: arrow keys, space, Page Up/Down, Home, and End. Press `D` for the canvas, `T` for the terminal, and `F` for fullscreen.

- Open the `◎` pane, enter a URL, and press Enter to embed a website (sites may opt out of iframe embedding).
- Open `</>` to edit the source Markdown. Click it again or press `Cmd/Ctrl+S` to save and reload.
- Drop image files directly onto the current slide to copy them into `assets/` and append Markdown image syntax to the source file.

> **Security:** the share URL is a secret capability. Anyone with it can run shell commands in the Markdown file's directory. Do not expose the server to an untrusted network. Use `--host 127.0.0.1` for local-only use.

The drawing state lives in memory and disappears when the server stops. Every browser terminal is backed by its own `node-pty` pseudo-terminal and child shell; it does not reuse the TTY running sldz.
