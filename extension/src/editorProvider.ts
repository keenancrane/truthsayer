import * as vscode from "vscode";
import { inspect, InspectionReport } from "./inspector.js";

interface TruthsayerDocument extends vscode.CustomDocument {
  refresh(): Promise<InspectionReport>;
}

export class TruthsayerEditorProvider
  implements vscode.CustomReadonlyEditorProvider<TruthsayerDocument>
{
  public static readonly viewType = "truthsayer.gltfInspector";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      TruthsayerEditorProvider.viewType,
      new TruthsayerEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri
  ): Promise<TruthsayerDocument> {
    const doc: TruthsayerDocument = {
      uri,
      dispose() {
        // Nothing persistent to clean up.
      },
      async refresh() {
        return inspect(uri.fsPath);
      },
    };
    return doc;
  }

  async resolveCustomEditor(
    document: TruthsayerDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const docDir = vscode.Uri.joinPath(document.uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
        // Allow loading the .glb / .gltf itself, plus any sibling .bin / textures.
        docDir,
      ],
    };

    const fileUri = webview.asWebviewUri(document.uri).toString();
    const libBaseUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "out", "lib"))
      .toString();
    const docBaseUri = webview.asWebviewUri(docDir).toString();

    let fileSize = 0;
    try {
      const stat = await vscode.workspace.fs.stat(document.uri);
      fileSize = stat.size;
    } catch { /* noop */ }

    // Auto-skip the 3D viewer for files above this size.  User can opt in via
    // a button rendered by the webview.
    const cfg = vscode.workspace.getConfiguration("truthsayer");
    const autoLoad3DBytes = (cfg.get<number>("autoLoad3DMaxMB") ?? 50) * 1024 * 1024;
    const autoLoad3D = fileSize > 0 && fileSize <= autoLoad3DBytes;

    webview.html = this.getHtml(webview);

    let report: InspectionReport | null = null;

    const sendInit = () => {
      webview.postMessage({
        type: "init",
        fileUri,
        libBaseUri,
        docBaseUri,
        fileName: document.uri.path.split("/").pop() ?? "",
        fileSize,
        autoLoad3D,
      });
    };

    // CRITICAL: wire the message receiver and send `init` BEFORE we run the
    // inspector.  This lets the 3D viewer start loading the GLB in parallel
    // with our JSON walk (and lets the webview render its loading UI even
    // before inspect() returns for very large files).
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ready") {
        sendInit();
        if (report) webview.postMessage({ type: "report", report });
      } else if (msg.type === "refresh") {
        try {
          webview.postMessage({ type: "status", phase: "inspecting" });
          report = await document.refresh();
          sendInit();
          webview.postMessage({ type: "report", report });
        } catch (err: any) {
          webview.postMessage({
            type: "error",
            message: err?.message ?? String(err),
          });
        }
      } else if (msg.type === "openWithDefault") {
        await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
      } else if (msg.type === "revealInExplorer") {
        await vscode.commands.executeCommand("revealFileInOS", document.uri);
      }
    });

    sendInit();
    webview.postMessage({ type: "status", phase: "inspecting" });

    // Run inspect concurrently with the webview / 3D load.
    inspect(document.uri.fsPath).then(
      (r) => {
        report = r;
        webview.postMessage({ type: "report", report });
      },
      (err: any) => {
        webview.postMessage({
          type: "error",
          message: err?.message ?? String(err),
        });
      }
    );

    // Re-inspect when the file changes on disk.
    const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
    const onChange = async () => {
      try {
        report = await document.refresh();
        webview.postMessage({ type: "report", report });
      } catch {
        // ignore mid-write errors
      }
    };
    watcher.onDidChange(onChange);
    webviewPanel.onDidDispose(() => watcher.dispose());
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.css")
    );
    const nonce = makeNonce();
    // The 3D viewer needs to fetch the glb (connect-src), and three.js's
    // DRACO/Basis decoders use Worker + WebAssembly (worker-src + 'unsafe-eval').
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval' blob:`,
      `worker-src blob: ${webview.cspSource}`,
      `connect-src ${webview.cspSource} blob: data:`,
      `font-src ${webview.cspSource}`,
    ].join("; ");
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Truthsayer</title>
</head>
<body>
  <div id="app">
    <div class="loading">Loading…</div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
