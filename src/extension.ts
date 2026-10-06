import * as vscode from 'vscode';
import { fetchProblem, problemToMarkdown } from './api/wzoi';
import { ProblemTreeProvider } from './tree/problemTree';
import { ProblemPanel } from './webview/problemPanel';
import { loginWithPassword } from './api/auth';
import { submitSolution, guessLanguage, LANGUAGE_OPTIONS } from './api/submit';
import { ProblemNode } from './tree/problemTree';
export function activate(context: vscode.ExtensionContext) {
    console.log('wzoi-helper is now active!');

    const hello = vscode.commands.registerCommand('wzoi-helper.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from wzoi-helper!');
    });

    // 保留原来的“输入 ID 抓题目”命令
    const fetch = vscode.commands.registerCommand(
        'wzoi-helper.fetchProblem',
        async () => {
            const id = await vscode.window.showInputBox({
                prompt: '输入题目 ID（例如 205）',
                placeHolder: '205',
                validateInput: (v) => (/^\d+$/.test(v) ? null : '请输入数字'),
            });
            if (!id) return;
            try {
                const problem = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `正在抓取题目 ${id}...`,
                        cancellable: false,
                    },
                    () => fetchProblem(id)
                );
                const md = problemToMarkdown(problem);
                const doc = await vscode.workspace.openTextDocument({
                    content: md,
                    language: 'markdown',
                });
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(`题目 ${id} 抓取成功`);
            } catch (err) {
                vscode.window.showErrorMessage(`抓取失败: ${err}`);
            }
        }
    );

    // 侧边栏树：先用匿名请求
    const getCookie = async (): Promise<string | undefined> => {
        return await context.secrets.get('wzoi.cookie');
    };
    const treeProvider = new ProblemTreeProvider(getCookie);
    const treeView = vscode.window.createTreeView('wzoiProblems', {
        treeDataProvider: treeProvider,
    });

    // 刷新按钮
    const refresh = vscode.commands.registerCommand(
        'wzoi-helper.refreshProblems',
        () => treeProvider.refresh()
    );

    // 点击题目时调用（现在先弹信息，下一步换成 Webview）
    const openProblem = vscode.commands.registerCommand(
        'wzoi-helper.openProblem',
        async (problemsetId: string, problemId: string) => {
            try {
                const cookie = await getCookie();
                const problem = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `加载题目 ${problemId}...`,
                        cancellable: false,
                    },
                    () => fetchProblem(problemId, problemsetId, cookie)
                );
                ProblemPanel.createOrShow(context.extensionUri, problem, problemsetId);
            } catch (err) {
                vscode.window.showErrorMessage(`打开题目失败: ${err}`);
            }
        }
    );
    const loginPassword = vscode.commands.registerCommand(
        'wzoi-helper.loginPassword',
        async () => {
            const username = await vscode.window.showInputBox({
                prompt: 'WZOI 用户名或邮箱',
                ignoreFocusOut: true,
                validateInput: (v) => (v.trim() ? null : '不能为空'),
            });
            if (!username) return;

            const password = await vscode.window.showInputBox({
                prompt: 'WZOI 密码',
                password: true,
                ignoreFocusOut: true,
                validateInput: (v) => (v ? null : '不能为空'),
            });
            if (!password) return;

            try {
                const cookie = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '正在登录 WZOI...',
                    },
                    () => loginWithPassword(username.trim(), password)
                );

                // 存 cookie 和账号（账号用于 cookie 过期后自动重登）
                await context.secrets.store('wzoi.cookie', cookie);
                await context.secrets.store('wzoi.username', username.trim());
                await context.secrets.store('wzoi.password', password);

                vscode.window.showInformationMessage('WZOI 登录成功');
                treeProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`登录失败: ${err}`);
            }
        }
    );

    const logout = vscode.commands.registerCommand('wzoi-helper.logout', async () => {
        await context.secrets.delete('wzoi.cookie');
        await context.secrets.delete('wzoi.username');
        await context.secrets.delete('wzoi.password');
        vscode.window.showInformationMessage('已退出 WZOI');
        treeProvider.refresh();
    });

    const submitToProblem = vscode.commands.registerCommand(
        'wzoi-helper.submitToProblem',
        async (node: ProblemNode) => {
            if (!node?.summary) {
                vscode.window.showErrorMessage('请从侧边栏的题目上右键提交');
                return;
            }
            const { problemsetId, problemId } = node.summary;

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开要提交的代码文件');
                return;
            }

            // 取选区，没选区取全文
            const code = editor.selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(editor.selection);
            if (!code.trim()) {
                vscode.window.showErrorMessage('代码为空');
                return;
            }

            // 语言选择：默认选中根据扩展名猜出来的那个
            const guessed = guessLanguage(editor.document.fileName);
            const pick = await vscode.window.showQuickPick(
                LANGUAGE_OPTIONS.map((o) => ({
                    label: o.label,
                    description: o.ext.join(', '),
                    id: o.id,
                })),
                {
                    placeHolder: guessed
                        ? `选择语言（根据扩展名推测：${guessed.label}）`
                        : '选择语言',
                }
            );
            if (!pick) return;

            const cookie = await getCookie();
            if (!cookie) {
                vscode.window.showWarningMessage('请先使用「WZOI: 登录」登录');
                return;
            }

            try {
                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `提交至题库 ${problemsetId} 题目 ${problemId}...`,
                    },
                    () => submitSolution(problemsetId, problemId, code, pick.id, cookie)
                );

                const view = '查看提交记录';
                const action = await vscode.window.showInformationMessage(
                    `提交成功，ID: ${result.solutionId}`,
                    view
                );
                if (action === view) {
                    vscode.env.openExternal(
                        vscode.Uri.parse(`https://wzoi.cn/solutions/${result.solutionId}`)
                    );
                }
            } catch (err) {
                vscode.window.showErrorMessage(`提交失败: ${err}`);
            }
        }
    );
    context.subscriptions.push(
        hello, fetch, refresh, openProblem, loginPassword, logout,
        submitToProblem, treeView
    );
}

export function deactivate() { }