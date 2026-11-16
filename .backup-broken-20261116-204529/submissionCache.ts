import * as vscode from 'vscode';
import {
  SubmissionSummary,
  SolutionDetail,
  fetchSolution,
  fetchAllMySubmissions,
} from '../api/wzoi';

const CACHE_DIR = 'wzoi-cache';
const RESUME_URL_KEY = 'wzoi.submissionResumeUrl';

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

export class SubmissionCache {
  private list: SubmissionSummary[] = [];
  private details = new Map<number, SolutionDetail>();
  private loaded = false;
  private dirUri: vscode.Uri | undefined;

  constructor(
    private ctx: vscode.ExtensionContext,
    private getUsername: () => Promise<string | undefined>
  ) { }

  private async getDir(): Promise<vscode.Uri | undefined> {
    if (this.dirUri) return this.dirUri;
    const username = await this.getUsername();
    if (!username) return undefined;
    const dir = vscode.Uri.joinPath(
      this.ctx.globalStorageUri,
      CACHE_DIR,
      sanitize(username)
    );
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch {
      /* 已存在 */
    }
    this.dirUri = dir;
    return dir;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const dir = await this.getDir();
    if (!dir) {
      this.loaded = true;
      return;
    }
    try {
      const listUri = vscode.Uri.joinPath(dir, 'list.json');
      const buf = await vscode.workspace.fs.readFile(listUri);
      this.list = JSON.parse(
        Buffer.from(buf).toString('utf8')
      ) as SubmissionSummary[];
      console.log(`[cache] 加载本地提交列表 ${this.list.length} 条`);
    } catch {
      console.log('[cache] 无本地列表，需首次全量同步');
    }
    this.loaded = true;
  }

  async saveList(): Promise<void> {
    const dir = await this.getDir();
    if (!dir) return;
    const listUri = vscode.Uri.joinPath(dir, 'list.json');
    try {
      await vscode.workspace.fs.writeFile(
        listUri,
        Buffer.from(JSON.stringify(this.list), 'utf8')
      );
    } catch (e) {
      console.error('[cache] 保存列表失败:', e);
    }
  }

  getList(): SubmissionSummary[] {
    return this.list;
  }

  hasList(): boolean {
    return this.list.length > 0;
  }

  getResumeUrl(): string | undefined {
    return this.ctx.globalState.get<string>(RESUME_URL_KEY);
  }

  async setResumeUrl(url: string | undefined): Promise<void> {
    await this.ctx.globalState.update(RESUME_URL_KEY, url || undefined);
  }

  private mergeById(
    existing: SubmissionSummary[],
    incoming: SubmissionSummary[]
  ): SubmissionSummary[] {
    const map = new Map<number, SubmissionSummary>();
    for (const s of existing) map.set(s.id, s);
    for (const s of incoming) map.set(s.id, s);
    const merged = Array.from(map.values());
    merged.sort((a, b) => b.id - a.id);
    return merged;
  }
  getMaxId(): number {
    return this.list.length > 0 ? this.list[0].id : 0;
  }

  addLatest(summary: SubmissionSummary): void {
    this.list = [summary, ...this.list.filter((s) => s.id !== summary.id)];
    this.list.sort((a, b) => b.id - a.id);
    void this.saveList();
  }

  async clear(): Promise<void> {
    this.list = [];
    this.details.clear();
    this.loaded = false;
    const dir = await this.getDir();
    if (dir) {
      const listUri = vscode.Uri.joinPath(dir, 'list.json');
      try {
        await vscode.workspace.fs.delete(listUri);
      } catch {
        /* 不存在 */
      }
    }
  }

  private async getDetailFromDisk(
    id: number
  ): Promise<SolutionDetail | undefined> {
    if (this.details.has(id)) return this.details.get(id);
    const dir = await this.getDir();
    if (!dir) return undefined;
    try {
      const detailUri = vscode.Uri.joinPath(dir, 'details', `${id}.json`);
      const buf = await vscode.workspace.fs.readFile(detailUri);
      const detail = JSON.parse(
        Buffer.from(buf).toString('utf8')
      ) as SolutionDetail;
      this.details.set(id, detail);
      return detail;
    } catch {
      return undefined;
    }
  }

  private async saveDetailToDisk(detail: SolutionDetail): Promise<void> {
    // 用户约束：只存有代码的提交
    if (!detail.code || !detail.code.trim()) return;
    const dir = await this.getDir();
    if (!dir) return;
    const detailsDir = vscode.Uri.joinPath(dir, 'details');
    try {
      await vscode.workspace.fs.createDirectory(detailsDir);
    } catch {
      /* 已存在 */
    }
    const detailUri = vscode.Uri.joinPath(detailsDir, `${detail.id}.json`);
    try {
      await vscode.workspace.fs.writeFile(
        detailUri,
        Buffer.from(JSON.stringify(detail), 'utf8')
      );
      this.details.set(detail.id, detail);
    } catch (e) {
      console.error('[cache] 保存详情失败:', e);
    }
  }

  async fetchDetail(
    id: number,
    cookie: string | undefined
  ): Promise<SolutionDetail> {
    const cached = await this.getDetailFromDisk(id);
    if (cached) {
      console.log(`[cache] 提交 #${id} 命中本地缓存`);
      return cached;
    }
    const detail = await fetchSolution(id, cookie);
    await this.saveDetailToDisk(detail);
    return detail;
  }

  /**
   * 增量同步
   * - 本地为空：全量拉取
   * - 本地有数据：只拉 id > 本地最大 id 的记录
   */
  async sync(
    cookie: string | undefined,
    onProgress?: (msg: string) => void
  ): Promise<{
    await this.load();
    const username = await this.getUsername();
    if (!username) throw new Error('未登录');

    const fromCache = this.list.length > 0;

    // 1. 有遗留断点 → 优先补抓历史缺口
    const savedResume = this.getResumeUrl();
    if (savedResume) {
      console.log(`[cache] 发现遗留断点，优先补抓: ${savedResume}`);
      onProgress?.('补抓历史缺口...');
      const history = await fetchAllMySubmissions(
        username,
        cookie,
        (page, count) => onProgress?.(`补历史 第 ${page} 页 · 已加载 ${count} 条`),
        undefined,
        savedResume
      );
      const beforeCount = this.list.length;
      this.list = this.mergeById(this.list, history.items);
      await this.saveList();
      if (history.completed) {
        await this.setResumeUrl(undefined);
        console.log(`[cache] 历史缺口补完，新增 ${this.list.length - beforeCount} 条`);
      } else {
        await this.setResumeUrl(history.resumeUrl);
        console.log(`[cache] 历史缺口仍未补完，更新断点: ${history.resumeUrl}`);
        return {
          added: this.list.length - beforeCount,
          total: this.list.length,
          fromCache,
        };
      }
    }

    // 2. 正常增量同步
    const stopAtId = this.list.length > 0 ? this.getMaxId() : 0;
    console.log(
      `[cache] 开始同步：${this.list.length > 0 ? `增量（stopAtId=${stopAtId}）` : '全量'}`
    );

    const fresh = await fetchAllMySubmissions(
      username,
      cookie,
      (page, count) => onProgress?.(`第 ${page} 页 · 已加载 ${count} 条`),
      stopAtId
    );

    const beforeCount = this.list.length;
    this.list = this.mergeById(this.list, fresh.items);
    await this.saveList();

    if (!fresh.completed && fresh.resumeUrl) {
      await this.setResumeUrl(fresh.resumeUrl);
      console.log(`[cache] 增量同步中途失败，记录断点: ${fresh.resumeUrl}`);
    }

    const added = this.list.length - beforeCount;
    console.log(`[cache] 同步完成：新增 ${added} 条，总计 ${this.list.length} 条`);
    return { added, total: this.list.length, fromCache };
  }> {
    await this.load();
    const username = await this.getUsername();
    if (!username) throw new Error('未登录');

    const fromCache = this.list.length > 0;
    const stopAtId = fromCache ? this.getMaxId() : 0;

    console.log(
      `[cache] 开始同步：${fromCache ? `增量（stopAtId=${stopAtId}）` : '全量'}`
    );

    const fetched = await fetchAllMySubmissions(
      username,
      cookie,
      (page, count) =>
        onProgress?.(`第 ${page} 页 · 已加载 ${count} 条`),
      stopAtId
    );

    const existingIds = new Set(this.list.map((s) => s.id));
    const newOnes = fetched.filter((s) => !existingIds.has(s.id));

    if (newOnes.length > 0) {
      this.list = [...newOnes, ...this.list];
      this.list.sort((a, b) => b.id - a.id);
      await this.saveList();
    }

    console.log(
      `[cache] 同步完成：新增 ${newOnes.length} 条，总计 ${this.list.length} 条`
    );
    return { added: newOnes.length, total: this.list.length, fromCache };
  }
}