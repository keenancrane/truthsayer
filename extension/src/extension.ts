import * as vscode from "vscode";
import { TruthsayerEditorProvider } from "./editorProvider.js";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(TruthsayerEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand("truthsayer.inspectActiveFile", async (uri?: vscode.Uri) => {
      let target = uri;
      if (!target) {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active) target = active;
      }
      if (!target) {
        const picks = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "glTF / GLB": ["glb", "gltf"] },
          openLabel: "Inspect with Truthsayer",
        });
        target = picks?.[0];
      }
      if (!target) return;
      await vscode.commands.executeCommand(
        "vscode.openWith",
        target,
        TruthsayerEditorProvider.viewType
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("truthsayer.openWithDefault", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return;
      await vscode.commands.executeCommand("vscode.openWith", target, "default");
    })
  );
}

export function deactivate() {}
