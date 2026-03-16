/**
 * Smoke tests — app loads, canvas renders, no JS errors.
 */
import { test, expect } from './fixtures'

test.describe('Smoke', () => {
  test('page loads with 200', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBe(200)
  })

  test('canvas element is present', async ({ page }) => {
    await page.goto('/')
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 10_000 })
  })

  test('no uncaught JS errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.waitForTimeout(2000)
    const critical = errors.filter(e =>
      !e.includes('WebSocket') && !e.includes('ERR_CONNECTION_REFUSED')
    )
    expect(critical).toHaveLength(0)
  })

  test('status bar renders with at least one agent', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(7000)
    // Agent filter buttons ("הכל", "פעילים", etc.) confirm bar rendered
    const allBtn = page.locator('button', { hasText: 'הכל' })
    await expect(allBtn).toBeVisible({ timeout: 3000 })
  })

  test('header buttons visible (settings, sound, stats, design)', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('button', { hasText: '⚙️' })).toBeVisible()
    await expect(page.locator('button', { hasText: /🔇|🔊/ })).toBeVisible()
    await expect(page.locator('button', { hasText: '📊' })).toBeVisible()
    await expect(page.locator('button', { hasText: /עיצוב/ })).toBeVisible()
  })
})
