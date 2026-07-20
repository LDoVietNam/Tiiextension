import { test, expect } from '@playwright/test';

test.describe('1MCP Dashboard E2E Verification', () => {
  const API_KEY = 'tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI';
  const DASHBOARD_URL = 'http://127.0.0.1:18401/ui/';

  test('should load dashboard with Vietnamese UI', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    
    // Check header
    await expect(page.locator('h1')).toContainText('1MCP Gateway');
    await expect(page.locator('p')).toContainText('Web LLM');
    
    // Check connect section elements
    await expect(page.locator('#key')).toBeVisible();
    await expect(page.locator('#connect')).toContainText('Kết nối');
    await expect(page.locator('#scan')).toContainText('Quét session');
    
    // Check workspace section
    await expect(page.locator('.files h2')).toContainText('Workspace');
  });

  test('should authenticate and show health status', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    
    // Enter API key
    await page.fill('#key', API_KEY);
    await page.click('#connect');
    
    // Wait for health check - should show runtime version
    await expect(page.locator('#health')).toContainText('Runtime', { timeout: 5000 });
    await expect(page.locator('#health')).toHaveClass(/ok/);
  });

  test('should load workspace tree after authentication', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    
    // Enter API key
    await page.fill('#key', API_KEY);
    await page.click('#connect');
    
    // Wait for workspace to load
    await expect(page.locator('#tree')).toBeVisible({ timeout: 10000 });
    
    // Check tree has items (README.md, AGENTS.MD, etc.)
    const treeItems = await page.locator('#tree li').count();
    expect(treeItems).toBeGreaterThan(0);
  });

  test('should open and display README.md content', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    
    // Enter API key
    await page.fill('#key', API_KEY);
    await page.click('#connect');
    
    // Wait for tree and click on README.md
    await expect(page.locator('#tree')).toBeVisible({ timeout: 10000 });
    await page.click('.tree .file:has-text("README.md")');
    
    // Check content area shows file content
    const content = await page.inputValue('#content');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('Tiiextension');
    
    // Check file path displayed
    await expect(page.locator('#filePath')).toContainText('README.md');
    await expect(page.locator('#save')).toBeEnabled();
  });

  test('should save file successfully', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    
    // Enter API key
    await page.fill('#key', API_KEY);
    await page.click('#connect');
    
    // Open README.md
    await page.click('.tree .file:has-text("README.md")');
    
    // Modify content slightly
    const originalContent = await page.inputValue('#content');
    const modifiedContent = originalContent.slice(0, 50) + '\n\n<!-- Test modification -->\n' + originalContent.slice(50);
    await page.fill('#content', modifiedContent);
    
    // Save
    await page.click('#save');
    
    // Check success message
    await expect(page.locator('.msg')).toContainText('Đã lưu', { timeout: 5000 });
  });
});

test.describe('Dashboard API Verification', () => {
  test('health endpoint responds', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:18401/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.version).toBeTruthy();
    expect(body.listen).toBeTruthy();
  });
  
  test('tools endpoint works with idempotency key', async ({ request }) => {
    const response = await request.post('http://127.0.0.1:18401/internal/tools/call', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI'
      },
      data: {
        tool: 'get_allowed_roots',
        arguments: {},
        idempotencyKey: 'test_' + Date.now() + Math.random().toString(36).slice(2, 6)
      }
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result.roots).toContain('Z:\\01_PROJECTS\\apps\\Tiiextension');
  });
});
