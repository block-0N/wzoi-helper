import * as vscode from 'vscode';
import { Problem, problemToMarkdown } from '../api/wzoi';

export class ProblemPanel {
    public static currentPanel: ProblemPanel | undefined;
    public static readonly viewType = 'wzoiProblem';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private currentKey?: string;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (msg) => {
                if (msg?.type === 'copy') {
                    vscode.env.clipboard.writeText(String(msg.text ?? ''));
                    vscode.window.setStatusBarMessage('已复制到剪贴板', 1500);
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        problem: Problem,
        problemsetId: string
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const key = `${problemsetId}/${problem.id}`;

        if (ProblemPanel.currentPanel) {
            ProblemPanel.currentPanel.panel.reveal(column);
            ProblemPanel.currentPanel.update(problem, key);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ProblemPanel.viewType,
            problem.title || `题目 ${problem.id}`,
            column ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        ProblemPanel.currentPanel = new ProblemPanel(panel, extensionUri);
        ProblemPanel.currentPanel.update(problem, key);
    }

    private update(problem: Problem, key: string): void {
        this.currentKey = key;
        this.panel.title = problem.title || `题目 ${problem.id}`;
        this.panel.webview.html = this.render(problem);
    }

    private render(p: Problem): string {
        const esc = (s: string) =>
            s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

        const samplesHtml = p.samples
            .map(
                (s, i) => `
        <h3>样例 ${i + 1}</h3>
        <div class="sample">
          <div class="sample-head">
            <span>输入</span>
            <button data-copy="${encodeURIComponent(s.input)}">复制</button>
          </div>
          <pre>${esc(s.input)}</pre>
          <div class="sample-head">
            <span>输出</span>
            <button data-copy="${encodeURIComponent(s.output)}">复制</button>
          </div>
          <pre>${esc(s.output)}</pre>
        </div>`
            )
            .join('');

        const nonce = makeNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net;">
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<style>
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    padding: 20px 32px; line-height: 1.7;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h1 { font-size: 22px; text-align: center; margin-bottom: 4px; }
  h3 { font-size: 16px; margin-top: 24px; border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 8px; }
  .meta { text-align: center; color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 20px; }
  .desc { white-space: pre-wrap; }
  .sample { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 12px 0; }
  .sample-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 10px; background: var(--vscode-editorWidget-background);
    font-size: 12px; color: var(--vscode-descriptionForeground);
  }
  .sample-head button {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-textLink-foreground); font-size: 12px;
  }
  pre {
    margin: 0; padding: 10px 12px; overflow-x: auto;
    background: var(--vscode-textCodeBlock-background);
    font-family: Consolas, "Courier New", monospace; font-size: 13px;
  }
</style>
</head>
<body>
  <h1>${esc(p.title)}</h1>
  <div class="meta">
    时间限制: ${esc(p.timeLimit || '—')} &nbsp;|&nbsp;
    空间限制: ${esc(p.memoryLimit || '—')} &nbsp;|&nbsp;
    题目 ID: ${esc(p.id)}
  </div>

  <h3>题目描述</h3>
  <div class="desc">${esc(p.description || '（无）')}</div>

  <h3>输入格式</h3>
  <div class="desc">${esc(p.inputFormat || '（无）')}</div>

  <h3>输出格式</h3>
  <div class="desc">${esc(p.outputFormat || '（无）')}</div>

  ${samplesHtml}

  ${p.hint ? `<h3>提示</h3><div class="desc">${esc(p.hint)}</div>` : ''}
  ${p.source ? `<hr><p class="meta">来源: ${esc(p.source)}</p>` : ''}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = decodeURIComponent(btn.getAttribute('data-copy'));
        vscode.postMessage({ type: 'copy', text });
      });
    });
  </script>
</body>
</html>`;
    }

    private dispose(): void {
        ProblemPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    public get key(): string | undefined {
        return this.currentKey;
    }
}

function makeNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}