import { test, expect } from '@playwright/test';

test('subworkflow execution surfaces support breadcrumb, drill-down, and run tree interactions', async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html lang="zh-CN">
      <body>
        <main aria-label="workflow workbench">
          <section aria-label="human question">
            <nav aria-label="workflow breadcrumb">
              <span>parent.yaml</span>
              <span>/</span>
              <span>child.yaml</span>
              <span>/</span>
              <span>确认发布</span>
            </nav>
            <button type="button">继续子流程</button>
          </section>

          <section aria-label="subworkflow summary">
            <article data-testid="child-run-card">
              <h2>子工作流执行摘要</h2>
              <p>run-child-001</p>
              <p>child.yaml</p>
              <button type="button" id="open-child">查看子流程</button>
            </article>
          </section>

          <dialog id="child-dialog" aria-label="子工作流执行视图">
            <h2>子工作流执行视图</h2>
            <dl>
              <dt>Child Run</dt><dd>run-child-001</dd>
              <dt>Config</dt><dd>child.yaml</dd>
              <dt>父状态</dt><dd>实现</dd>
            </dl>
            <button type="button" id="open-full">打开完整工作台</button>
            <button type="button" id="close-child">关闭</button>
          </dialog>

          <section aria-label="run history">
            <button type="button" id="toggle-tree" aria-expanded="false">展开</button>
            <ul id="child-tree" hidden>
              <li>parent run</li>
              <li>child run <strong>detached</strong></li>
            </ul>
          </section>
        </main>
        <script>
          const dialog = document.querySelector('#child-dialog');
          document.querySelector('#open-child').addEventListener('click', () => dialog.showModal());
          document.querySelector('#close-child').addEventListener('click', () => dialog.close());
          document.querySelector('#toggle-tree').addEventListener('click', (event) => {
            const button = event.currentTarget;
            const tree = document.querySelector('#child-tree');
            const expanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!expanded));
            tree.hidden = expanded;
          });
        </script>
      </body>
    </html>
  `);

  await expect(page.getByLabel('workflow breadcrumb')).toContainText('parent.yaml');
  await expect(page.getByLabel('workflow breadcrumb')).toContainText('child.yaml');
  await page.getByRole('button', { name: '查看子流程' }).click();
  await expect(page.getByRole('dialog', { name: '子工作流执行视图' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '子工作流执行视图' })).toContainText('run-child-001');
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '子工作流执行视图' })).toBeHidden();

  const toggle = page.getByRole('button', { name: '展开' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('run history')).toContainText('detached');
});
