import * as vscode from 'vscode';
import { UserProfile } from '../api/wzoi';

export class UserPanel {
  public static currentPanel: UserPanel | undefined;
  public static readonly viewType = 'wzoiUser';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'openExternal' && msg.url) {
          vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
        } else if (msg?.type === 'openSubmissions' && msg.userName) {
          vscode.commands.executeCommand(
            'wzoi-helper.openUserSubmissions',
            msg.userName,
            msg.filter === 'ac' ? 'ac' : 'all'
          );
        }
      },
      null,
      this.disposables
    );
  }

  private dispose() {
    UserPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  public static createOrShow(profile: UserProfile): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (UserPanel.currentPanel) {
      UserPanel.currentPanel.panel.reveal(column);
      UserPanel.currentPanel.panel.title =
        profile.displayName || `用户 ${profile.uid}`;
      UserPanel.currentPanel.panel.webview.html = render(profile);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      UserPanel.viewType,
      profile.displayName || `用户 ${profile.uid}`,
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = render(profile);
    UserPanel.currentPanel = new UserPanel(panel);
  }
}

function render(p: UserProfile): string {
  const nonce = makeNonce();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
    style-src 'unsafe-inline';
    img-src https: data:;
    script-src 'nonce-${nonce}';">
<style>
  :root {
    --fg: var(--vscode-foreground);
    --bg: var(--vscode-editor-background);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-panel-border);
    --card: var(--vscode-editorWidget-background);
    --accent: var(--vscode-textLink-foreground);
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.7;
    padding: 24px 32px;
    max-width: 1080px;
    margin: 0 auto;
    color: var(--fg);
    background: var(--bg);
  }
  a { color: var(--accent); text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3, h4, h5, h6 { margin: 12px 0 8px; }

  /* ---- Bootstrap 兼容：网格 ---- */
  .row { display: flex; flex-wrap: wrap; margin: 0 -8px; }
  .row > [class*="col-"] { padding: 8px; width: 100%; min-width: 0; }
  @media (min-width: 768px) {
    .row > .col-md-2 { width: 16.666% !important; }
    .row > .col-md-4 { width: 33.333% !important; }
    .row > .col-md-6 { width: 50% !important; }
    .row > .col-md-8 { width: 66.666% !important; }
    .row > .col-md-10 { width: 83.333% !important; }
  }
  @media (min-width: 992px) {
    .row > .col-lg-3 { width: 25% !important; }
    .row > .col-lg-4 { width: 33.333% !important; }
    .row > .col-lg-6 { width: 50% !important; }
    .row > .col-lg-8 { width: 66.666% !important; }
    .row > .col-lg-9 { width: 75% !important; }
  }

  /* ---- Bootstrap 兼容：卡片 ---- */
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .card-body { padding: 16px 20px; }
  .card-header {
    padding: 10px 18px;
    border-bottom: 1px solid var(--border);
    background: rgba(127,127,127,0.08);
    font-weight: 600;
  }
  .card-title { font-size: 18px; margin: 0 0 4px; }
  .card-subtitle { font-size: 14px; margin: 0 0 12px; color: var(--muted); }
  .card-img { width: 100%; height: auto; }

  /* ---- Bootstrap 兼容：工具类 ---- */
  .text-muted { color: var(--muted); }
  .text-center { text-align: center; }
  .text-left { text-align: left; }
  .text-right { text-align: right; }
  .mr-3 { margin-right: 16px; }
  .ml-3 { margin-left: 16px; }
  .my-2 { margin-top: 8px; margin-bottom: 8px; }
  .mt-2 { margin-top: 8px; }
  .mb-2 { margin-bottom: 8px; }
  .mt-3 { margin-top: 12px; }
  .mb-3 { margin-bottom: 12px; }
  .p-2 { padding: 8px; }
  .p-3 { padding: 12px; }
  .buffer-sm { height: 8px; }
  .small { font-size: 13px; }
  .w-100 { width: 100%; }
  .d-flex { display: flex; }
  .d-block { display: block; }
  .pull-right { float: right; }
  .pull-left { float: left; }
  .float-left { float: left; }
  .float-right { float: right; }
  .rounded-circle { border-radius: 50%; }
  .rounded { border-radius: 6px; }

  /* ---- Bootstrap 兼容：badge / progress ---- */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(127,127,127,0.2);
    font-size: 12px;
  }
  .progress {
    height: 18px;
    background: rgba(127,127,127,0.15);
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-bar {
    background: var(--accent);
    color: var(--bg);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    height: 100%;
  }

  /* ---- 表格 ---- */
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { padding: 6px 12px; border: 1px solid var(--border); text-align: left; }
  th { background: rgba(127,127,127,0.08); }
  hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
</style>
</head>
<body>
  <div class="content">${p.mainHtml}</div>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // 提交数 / 通过题目 链接 → 内部打开
      document.querySelectorAll('[data-wzoi-action="openSubmissions"]').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          vscode.postMessage({
            type: 'openSubmissions',
            userName: el.getAttribute('data-wzoi-user') || '',
            filter: el.getAttribute('data-wzoi-filter') || 'all',
          });
        });
      });

      // 其余外部链接 → 浏览器打开
      document.querySelectorAll('a[href^="https://"]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          vscode.postMessage({ type: 'openExternal', url: a.getAttribute('href') });
        });
      });
    })();
  </script>
</body>
</html>`;
}

function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}