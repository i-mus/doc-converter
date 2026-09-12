import * as path from "path";
import * as vscode from "vscode";
import { markdownToDocx } from "./convert/markdown";
import { imagesToPdf, type ImageInput } from "./convert/images";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("docConverter.mdToDocx", mdToDocxCommand),
    vscode.commands.registerCommand("docConverter.imagesToPdf", imagesToPdfCommand),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}

/* ------------------------------------------------------------------ commands */

async function mdToDocxCommand(resource?: vscode.Uri): Promise<void> {
  const src = await resolveMarkdownSource(resource);
  if (!src) return;

  try {
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === src.toString(),
    );
    const markdown = open
      ? open.getText()
      : Buffer.from(await vscode.workspace.fs.readFile(src)).toString("utf8");

    const dest =
      src.scheme === "file"
        ? await resolveDestination(
            src.with({ path: src.path.replace(/\.(md|markdown)$/i, "") + ".docx" }),
          )
        : await pickSaveLocation(src, "docx", "Word Document");
    if (!dest) return;

    const buffer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Converting to Word…" },
      () => markdownToDocx(markdown),
    );

    await vscode.workspace.fs.writeFile(dest, buffer);
    await announce(dest);
  } catch (err) {
    fail(err);
  }
}

async function imagesToPdfCommand(
  resource?: vscode.Uri,
  selection?: vscode.Uri[],
): Promise<void> {
  let uris = selection?.length ? selection : resource ? [resource] : [];

  if (uris.length === 0) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Combine into PDF",
      filters: { Images: ["png", "jpg", "jpeg"] },
    });
    if (!picked?.length) return;
    uris = picked;
  }

  uris = [...uris].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }),
  );

  try {
    const images: ImageInput[] = await Promise.all(
      uris.map(async (u) => ({
        name: path.basename(u.path),
        data: await vscode.workspace.fs.readFile(u),
      })),
    );

    const first = uris[0];
    const stem =
      uris.length === 1
        ? first.path.replace(/\.[^./]+$/, "")
        : first.path.replace(/\/[^/]+$/, "/images");
    const dest = await resolveDestination(first.with({ path: stem + ".pdf" }));
    if (!dest) return;

    const bytes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Combining ${images.length} image${images.length > 1 ? "s" : ""} into PDF…`,
      },
      () => imagesToPdf(images),
    );

    await vscode.workspace.fs.writeFile(dest, bytes);
    await announce(dest);
  } catch (err) {
    fail(err);
  }
}

/* ------------------------------------------------------------------- helpers */

async function resolveMarkdownSource(
  resource?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (resource) return resource;

  const editor = vscode.window.activeTextEditor;
  if (
    editor &&
    (editor.document.languageId === "markdown" ||
      /\.(md|markdown)$/i.test(editor.document.fileName))
  ) {
    return editor.document.uri;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Convert to Word",
    filters: { Markdown: ["md", "markdown"] },
  });
  return picked?.[0];
}

async function resolveDestination(
  target: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  if (!(await exists(target))) return target;

  const choice = await vscode.window.showWarningMessage(
    `${path.basename(target.path)} already exists.`,
    { modal: true },
    "Overwrite",
    "Keep Both",
  );
  if (choice === "Overwrite") return target;
  if (choice !== "Keep Both") return undefined;

  const ext = path.extname(target.path);
  const base = target.path.slice(0, -ext.length);
  for (let i = 2; i < 1000; i++) {
    const candidate = target.with({ path: `${base} ${i}${ext}` });
    if (!(await exists(candidate))) return candidate;
  }
  return undefined;
}

/**
 * For a source that has no real place on disk (an unsaved "untitled:"
 * buffer, or another virtual scheme) there is no "next to it" to save
 * beside, so ask the user where to put the result instead of guessing.
 */
async function pickSaveLocation(
  src: vscode.Uri,
  ext: string,
  filterLabel: string,
): Promise<vscode.Uri | undefined> {
  const base = path.basename(src.path).replace(/\.[^./]+$/, "") || "document";
  return vscode.window.showSaveDialog({
    title: `Save ${filterLabel}`,
    defaultUri: vscode.Uri.file(`${base}.${ext}`),
    filters: { [filterLabel]: [ext] },
  });
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function announce(uri: vscode.Uri): Promise<void> {
  const name = path.basename(uri.path);
  const config = vscode.workspace.getConfiguration("docConverter");

  if (!config.get<boolean>("openAfterConvert", true)) {
    vscode.window.showInformationMessage(`Saved ${name}`);
    return;
  }

  const pick = await vscode.window.showInformationMessage(
    `Saved ${name}`,
    "Show in Explorer",
    "Open File",
  );
  if (pick === "Show in Explorer") {
    await vscode.commands.executeCommand("revealInExplorer", uri);
  } else if (pick === "Open File") {
    await vscode.env.openExternal(uri);
  }
}

function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  vscode.window.showErrorMessage(`Doc Converter: ${message}`);
}
