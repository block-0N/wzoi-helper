import * as vscode from 'vscode';
import { fetchProblemsetPage, ProblemSummary } from '../api/wzoi';

export class ProblemsetNode extends vscode.TreeItem {
    totalPages?: number;
    pageCache = new Map<number, ProblemSummary[]>();
    parent?: ProblemsetNode | PageNode;

    constructor(public readonly problemsetId: string) {
        super(`题库 ${problemsetId}`, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'problemset';
        this.iconPath = new vscode.ThemeIcon('book');
        this.id = `ps-${problemsetId}`;
    }
}

export class PageNode extends vscode.TreeItem {
    parent?: ProblemsetNode;

    constructor(
        public readonly problemsetId: string,
        public readonly page: number,
        count?: number
    ) {
        super(
            count != null ? `第 ${page} 页（${count} 题）` : `第 ${page} 页`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        this.contextValue = 'page';
        this.iconPath = new vscode.ThemeIcon('list-ordered');
        this.id = `pg-${problemsetId}-${page}`;
    }
}

export class ProblemNode extends vscode.TreeItem {
    parent?: PageNode;

    constructor(public readonly summary: ProblemSummary) {
        super(summary.title, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'problem';
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.description = `#${summary.problemId}`;
        this.tooltip = `打开 ${summary.title}（题库 ${summary.problemsetId}，题目 ${summary.problemId}）`;
        this.command = {
            command: 'wzoi-helper.openProblem',
            title: '打开题目',
            arguments: [summary.problemsetId, summary.problemId],
        };
    }
}

type Node = ProblemsetNode | PageNode | ProblemNode;

export class ProblemTreeProvider implements vscode.TreeDataProvider<Node> {
    private _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private nodes = new Map<string, ProblemsetNode>();
    private treeView?: vscode.TreeView<Node>;
    private scoreIndex = new Map<string, number>();

    constructor(private getCookie: () => Promise<string | undefined>) { }

    setScoreIndex(index: Map<string, number>) {
        this.scoreIndex = index;
        this._onDidChangeTreeData.fire(undefined);
    }
    attachTreeView(tv: vscode.TreeView<Node>) {
        this.treeView = tv;
    }

    refresh(): void {
        this.nodes.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: Node): vscode.TreeItem {
        return element;
    }

    getParent(element: Node): Node | undefined {
        return element.parent;
    }

    async revealProblemset(id: string): Promise<void> {
        // 保证根节点已构建
        await this.getChildren();
        const node = this.nodes.get(id);
        if (!node) {
            vscode.window.showWarningMessage(`找不到题库 ${id}`);
            return;
        }
        if (this.treeView) {
            await this.treeView.reveal(node, {
                expand: true,
                focus: true,
                select: true,
            });
        }
    }

    async getChildren(element?: Node): Promise<Node[]> {
        // ---- 顶层：题库列表 ----
        if (!element) {
            const ids =
                vscode.workspace
                    .getConfiguration('wzoi')
                    .get<string[]>('problemsets') ?? [];
            return ids.map((id) => {
                let node = this.nodes.get(id);
                if (!node) {
                    node = new ProblemsetNode(id);
                    this.nodes.set(id, node);
                }
                return node;
            });
        }

        // ---- 展开题库：加载第 1 页拿总页数，然后返回分页节点 ----
        if (element instanceof ProblemsetNode) {
            if (element.totalPages == null) {
                try {
                    const cookie = await this.getCookie();
                    const { meta, totalPages } = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `加载题库 ${element.problemsetId}`,
                            cancellable: false,
                        },
                        () => fetchProblemsetPage(element.problemsetId, 1, cookie)
                    );
                    element.label = meta.title || `题库 ${element.problemsetId}`;
                    element.iconPath = new vscode.ThemeIcon(
                        meta.isContest ? 'trophy' : 'book'
                    );
                    element.totalPages = totalPages;
                    element.pageCache.set(1, meta.problems);
                    this._onDidChangeTreeData.fire(element);
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `加载题库 ${element.problemsetId} 失败：${err}`
                    );
                    return [];
                }
            }

            const pages: PageNode[] = [];
            for (let p = 1; p <= (element.totalPages ?? 1); p++) {
                const cached = element.pageCache.get(p);
                const pageNode = new PageNode(element.problemsetId, p, cached?.length);
                pageNode.parent = element;
                pages.push(pageNode);
            }
            return pages;
        }

        // ---- 展开某一页：懒加载该页题目 ----
        if (element instanceof PageNode) {
            const ps = this.nodes.get(element.problemsetId);
            if (!ps) return [];

            let problems = ps.pageCache.get(element.page);
            if (!problems) {
                try {
                    const cookie = await this.getCookie();
                    const { meta } = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `加载题库 ${element.problemsetId} 第 ${element.page} 页`,
                            cancellable: false,
                        },
                        () => fetchProblemsetPage(element.problemsetId, element.page, cookie)
                    );
                    problems = meta.problems;
                    ps.pageCache.set(element.page, problems);
                    element.label = `第 ${element.page} 页（${problems.length} 题）`;
                    this._onDidChangeTreeData.fire(element);
                } catch (err) {
                    vscode.window.showErrorMessage(
                        `加载第 ${element.page} 页失败：${err}`
                    );
                    return [];
                }
            }

            return problems.map((p) => {
                const node = new ProblemNode(p);
                node.parent = element;
                const score = this.scoreIndex.get(p.title);
                if (score != null) {
                    if (score >= 100) {
                        node.iconPath = new vscode.ThemeIcon(
                            'pass-filled',
                            new vscode.ThemeColor('charts.green')
                        );
                    } else if (score > 0) {
                        node.description = `#${p.problemId} · ${score}分`;
                        node.iconPath = new vscode.ThemeIcon(
                            'circle-filled',
                            new vscode.ThemeColor('charts.yellow')
                        );
                    }
                }
                return node;
            });
        }

        return [];
    }
}