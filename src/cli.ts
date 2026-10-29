#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { renderSlides } from "./markdown.js";
import { startServer } from "./server.js";
import { renderDocument } from "./template.js";

interface CliOptions {
  host: string;
  port: number;
  output?: string;
  title?: string;
  open: boolean;
}

function localAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

const program = new Command()
  .name("sldz")
  .description("Turn Markdown into collaborative slides")
  .argument("<markdown>", "Markdown presentation file")
  .option("-p, --port <port>", "HTTP port (use 0 for a random port)", (value) => Number.parseInt(value, 10), 4173)
  .option("--host <host>", "interface to bind", "0.0.0.0")
  .option("-o, --output <file>", "generated HTML path")
  .option("--title <title>", "presentation title")
  .option("--open", "open the presentation in a browser", false)
  .action(async (markdownPath: string, options: CliOptions) => {
    const sourcePath = path.resolve(markdownPath);
    const markdown = await readFile(sourcePath, "utf8");
    const slides = renderSlides(markdown);
    if (slides.length === 0) throw new Error("The Markdown file does not contain any slides.");
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("Port must be between 0 and 65535.");

    const stem = path.basename(sourcePath, path.extname(sourcePath));
    const title = options.title ?? stem;
    const presentationId = randomBytes(12).toString("base64url");
    const html = renderDocument(title, slides, presentationId);
    const outputPath = path.resolve(options.output ?? path.join(".sldz", `${stem}.html`));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html);

    const server = await startServer({
      host: options.host,
      port: options.port,
      presentationId,
      title,
      slideCount: slides.length,
      html,
      cwd: path.dirname(sourcePath),
      markdownPath: sourcePath,
    });

    const browserHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
    const localUrl = `http://${browserHost}:${server.port}/p/${presentationId}`;
    const lanIp = localAddress();
    const shareUrl = lanIp && (options.host === "0.0.0.0" || options.host === "::")
      ? `http://${lanIp}:${server.port}/p/${presentationId}`
      : localUrl;

    console.log(`\n  sldz · ${slides.length} slides`);
    console.log(`  HTML:  ${outputPath}`);
    console.log(`  Index: http://${browserHost}:${server.port}/`);
    console.log(`  Local: ${localUrl}`);
    if (shareUrl !== localUrl) console.log(`  Share: ${shareUrl}`);
    console.log("\n  ⚠ Anyone with this URL can use a shell in the Markdown file's directory.");
    console.log("  Press Ctrl+C to stop.\n");

    if (options.open) openBrowser(localUrl);

    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`sldz: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
