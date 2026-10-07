import * as vscode from 'vscode';
import {
    fetchProblem,
    fetchSolution,
    fetchCurrentUsername,
    fetchAllMySubmissions,
    buildScoreIndex,
    fetchDashboard,
    fetchTags,
    searchByTag
} from './api/wzoi';
import { loginWithPassword } from './api/auth';
import { submitSolution, guessLanguage, LANGUAGE_OPTIONS } from './api/submit';
import { ProblemTreeProvider, ProblemNode } from './tree/problemTree';
import { SubmissionTreeProvider } from './tree/submissionTree';
import { ContestTreeProvider } from './tree/contestTree';
import { ProblemPanel } from './webview/problemPanel';
import { SolutionPanel } from './webview/solutionPanel';
import { DashboardPanel } from './webview/dashboardPanel';
export function activate(context: vscode.ExtensionContext) {
    console.log('wzoi-helper is now active!');

    // ---------- 公共 helper ----------
    const getCookie = async (): Promise<string | undefined> => {
        return await context.secrets.get('wzoi.cookie');
    };
    const getUsername = async (): Promise<string | undefined> => {
        return await context.secrets.get('wzoi.username');
    };
    const wzoiOutput = vscode.window.createOutputChannel('WZOI');
    context.subscriptions.push(wzoiOutput);
    wzoiOutput.appendLine('WZOI 扩展已激活');
    // ---------- Providers ----------
    const treeProvider = new ProblemTreeProvider(getCookie);
    const treeView = vscode.window.createTreeView('wzoiProblems', {
        treeDataProvider: treeProvider,
    });
    treeProvider.attachTreeView(treeView);
    const submissionProvider = new SubmissionTreeProvider(getCookie, getUsername);
    const submissionView = vscode.window.createTreeView('wzoiSubmissions', {
        treeDataProvider: submissionProvider,
    });

    const contestProvider = new ContestTreeProvider(getCookie);
    const contestView = vscode.window.createTreeView('wzoiContests', {
        treeDataProvider: contestProvider,
    });

    // ---------- 命令：Hello World（保留自脚手架）----------
    const hello = vscode.commands.registerCommand('wzoi-helper.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from wzoi-helper!');
    });

    // ---------- 命令：输入 ID 抓题 ----------
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
                    () => fetchProblem(id, '1', undefined)
                );
                // 用 Webview 打开
                ProblemPanel.createOrShow(context.extensionUri, problem, '1', wzoiOutput);
                vscode.window.showInformationMessage(`题目 ${id} 抓取成功`);
            } catch (err) {
                vscode.window.showErrorMessage(`抓取失败: ${err}`);
            }
        }
    );

    // ---------- 命令：刷新 ----------
    const refresh = vscode.commands.registerCommand(
        'wzoi-helper.refreshProblems',
        () => {
            treeProvider.refresh();
            submissionProvider.refresh();
            contestProvider.refresh();
        }
    );

    // ---------- 命令：从侧边栏打开题目 ----------
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
                ProblemPanel.createOrShow(context.extensionUri, problem, problemsetId, wzoiOutput);
            } catch (err) {
                vscode.window.showErrorMessage(`打开题目失败: ${err}`);
            }
        }
    );

    // ---------- 命令：登录（用户名密码）----------
    const loginPassword = vscode.commands.registerCommand(
        'wzoi-helper.loginPassword',
        async () => {
            const username = await vscode.window.showInputBox({
                prompt: 'WZOI 用户名',
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

                await context.secrets.store('wzoi.cookie', cookie);
                await context.secrets.store('wzoi.username', username.trim());
                await context.secrets.store('wzoi.password', password);

                // 尝试解析真实用户名（用于提交列表）
                try {
                    const realName = await fetchCurrentUsername(cookie);
                    if (realName) {
                        await context.secrets.store('wzoi.username', realName);
                    }
                } catch {
                    /* 忽略 */
                }

                vscode.window.showInformationMessage('WZOI 登录成功');
                treeProvider.refresh();
                submissionProvider.refresh();
                contestProvider.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`登录失败: ${err}`);
            }
        }
    );

    // ---------- 命令：退出登录 ----------
    const logout = vscode.commands.registerCommand(
        'wzoi-helper.logout',
        async () => {
            await context.secrets.delete('wzoi.cookie');
            await context.secrets.delete('wzoi.username');
            await context.secrets.delete('wzoi.password');
            vscode.window.showInformationMessage('已退出 WZOI');
            treeProvider.refresh();
            submissionProvider.refresh();
            contestProvider.refresh();
        }
    );

    // ---------- 命令：提交代码到题目 ----------
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

            const code = editor.selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(editor.selection);
            if (!code.trim()) {
                vscode.window.showErrorMessage('代码为空');
                return;
            }

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
                        vscode.Uri.parse(
                            `https://wzoi.cn/solutions/${result.solutionId}`
                        )
                    );
                }

                // 刷新提交列表，并延迟再刷两次等评测结果
                submissionProvider.refresh();
                setTimeout(() => submissionProvider.refresh(), 3000);
                setTimeout(() => submissionProvider.refresh(), 8000);
            } catch (err) {
                vscode.window.showErrorMessage(`提交失败: ${err}`);
            }
        }
    );

    // ---------- 命令：查看提交详情 ----------
    const openSolution = vscode.commands.registerCommand(
        'wzoi-helper.openSolution',
        async (id: number) => {
            try {
                const cookie = await getCookie();
                const detail = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `加载提交 #${id}...`,
                    },
                    () => fetchSolution(id, cookie)
                );
                SolutionPanel.createOrShow(context.extensionUri, detail);
            } catch (err) {
                vscode.window.showErrorMessage(`加载提交失败: ${err}`);
            }
        }
    );

    // ---------- 命令：从侧边栏打开比赛 ----------
    const openProblemset = vscode.commands.registerCommand(
        'wzoi-helper.openProblemset',
        async (problemsetId: string) => {
            const cfg = vscode.workspace.getConfiguration('wzoi');
            const ids = cfg.get<string[]>('problemsets') ?? [];
            if (!ids.includes(problemsetId)) {
                await cfg.update(
                    'problemsets',
                    [...ids, problemsetId],
                    vscode.ConfigurationTarget.Global
                );
                treeProvider.refresh();
                // 等 VSCode 处理完配置更新再 reveal
                await new Promise((r) => setTimeout(r, 200));
            }
            await treeProvider.revealProblemset(problemsetId);
        }
    );
    const syncACStatus = vscode.commands.registerCommand(
        'wzoi-helper.syncACStatus',
        async () => {
            const username = await getUsername();
            const cookie = await getCookie();
            if (!username || !cookie) {
                vscode.window.showWarningMessage('请先登录');
                return;
            }
            try {
                const subs = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '同步提交记录...',
                        cancellable: false,
                    },
                    () => fetchAllMySubmissions(username, cookie)
                );
                const index = buildScoreIndex(subs);
                treeProvider.setScoreIndex(index);
                vscode.window.showInformationMessage(
                    `已同步 ${subs.length} 条提交，覆盖 ${index.size} 道题`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`同步失败: ${err}`);
            }
        }
    );
    const openDashboard = vscode.commands.registerCommand(
        'wzoi-helper.openDashboard',
        async () => {
            try {
                const cookie = await getCookie();
                const data = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '加载首页...',
                    },
                    () => fetchDashboard(cookie)
                );
                DashboardPanel.createOrShow(data);
            } catch (err) {
                vscode.window.showErrorMessage(`加载失败: ${err}`);
            }
        }
    );
    const searchByTagCmd = vscode.commands.registerCommand(
        'wzoi-helper.searchByTag',
        async () => {
            try {
                const tags = await fetchTags();
                const pick = await vscode.window.showQuickPick(
                    tags.map((t) => ({ label: t.name, id: t.id })),
                    { placeHolder: '选择标签' }
                );
                if (!pick) return;

                const cookie = await getCookie();
                const problems = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `搜索标签「${pick.label}」...`,
                    },
                    () => searchByTag(pick.id, cookie)
                );

                if (!problems.length) {
                    vscode.window.showInformationMessage('没有找到题目');
                    return;
                }

                const probPick = await vscode.window.showQuickPick(
                    problems.map((p) => ({
                        label: p.title,
                        description: `#${p.problemId}`,
                        p,
                    })),
                    { placeHolder: `共 ${problems.length} 道题，选择要打开的` }
                );
                if (probPick) {
                    vscode.commands.executeCommand(
                        'wzoi-helper.openProblem',
                        probPick.p.problemsetId,
                        probPick.p.problemId
                    );
                }
            } catch (err) {
                vscode.window.showErrorMessage(`搜索失败: ${err}`);
            }
        }
    );
    context.subscriptions.push(
        hello,
        fetch,
        refresh,
        openProblem,
        loginPassword,
        logout,
        submitToProblem,
        openSolution,
        openProblemset,
        treeView,
        submissionView,
        contestView,
        syncACStatus,
        openDashboard,
        searchByTagCmd
    );
}

export function deactivate() { }