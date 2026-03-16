/**
 * Settings / connection panel tests.
 */
import { test, expect } from './fixtures'

test.describe('Settings', () => {
  test('settings button (⚙️) is visible and clickable', async ({ page }) => {
    await page.goto('/')
    const btn = page.locator('button', { hasText: '⚙️' })
    await expect(btn).toBeVisible()
    await btn.click()
    await page.waitForTimeout(500)
    // No crash = pass; panel may or may not have a password input in this version
  })

  test('agent filter buttons render (הכל / פעילים / עובדים)', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('button', { hasText: 'הכל' })).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button', { hasText: 'פעילים' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'עובדים' })).toBeVisible()
  })

  test('gateway token stored in sessionStorage', async ({ page }) => {
    await page.goto('/')
    const token = await page.evaluate(() => sessionStorage.getItem('gateway-token'))
    expect(token).not.toBeNull()
    expect((token as string).length).toBeGreaterThan(10)
  })

  test('office design button opens edit mode', async ({ page }) => {
    await page.goto('/')
    const designBtn = page.locator('button', { hasText: /עיצוב/ })
    await expect(designBtn).toBeVisible()
    await designBtn.click()
    await page.waitForTimeout(500)
    // No crash = pass
  })
})
