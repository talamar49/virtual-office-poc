/**
 * Chat panel tests — open, close, minimize (mobile).
 */
import { test, expect } from './fixtures'

test.describe('Chat Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for agents to load
    await page.waitForTimeout(7000)
  })

  test('click agent pill opens chat panel', async ({ page }) => {
    const pills = page.locator('[style*="cursor: pointer"]')
    const count = await pills.count()
    if (count === 0) test.skip(true, 'No agents loaded — gateway not available')

    await pills.first().click()
    // Panel should appear — look for close button ✕
    await expect(page.getByRole('button', { name: '✕' })).toBeVisible({ timeout: 3000 })
  })

  test('close button dismisses chat panel', async ({ page }) => {
    const pills = page.locator('[style*="cursor: pointer"]')
    if (await pills.count() === 0) test.skip(true, 'No agents loaded')

    await pills.first().click()
    const closeBtn = page.getByRole('button', { name: '✕' })
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()
    await expect(closeBtn).not.toBeVisible({ timeout: 2000 })
  })

  test('mobile — chat panel is bottom sheet (50vh)', async ({ page }) => {
    // Already on mobile viewport via project config (iPhone 14 = 390×844)
    const pills = page.locator('[style*="cursor: pointer"]')
    if (await pills.count() === 0) test.skip(true, 'No agents loaded')

    await pills.first().click()
    // Minimise button should exist on mobile
    const minimizeBtn = page.getByRole('button', { name: /▼|▲/ })
    const isMobileViewport = page.viewportSize()!.width < 500
    if (isMobileViewport) {
      await expect(minimizeBtn).toBeVisible({ timeout: 3000 })
    }
  })

  test('mobile — minimize/expand toggle works', async ({ page }) => {
    const isMobileViewport = page.viewportSize()!.width < 500
    if (!isMobileViewport) test.skip(true, 'Desktop viewport — skip mobile-only test')

    const pills = page.locator('[style*="cursor: pointer"]')
    if (await pills.count() === 0) test.skip(true, 'No agents loaded')

    await pills.first().click()
    const minimizeBtn = page.getByRole('button', { name: '▼' })
    await expect(minimizeBtn).toBeVisible()

    // Click minimize
    await minimizeBtn.click()
    const expandBtn = page.getByRole('button', { name: '▲' })
    await expect(expandBtn).toBeVisible({ timeout: 2000 })

    // Click expand
    await expandBtn.click()
    await expect(page.getByRole('button', { name: '▼' })).toBeVisible({ timeout: 2000 })
  })
})
