/**
 * Smoke tests — app loads, canvas renders, no JS errors.
 */
import { test, expect } from '@playwright/test'

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
    // Filter out known benign errors (WebSocket reconnect noise during tests)
    const critical = errors.filter(e =>
      !e.includes('WebSocket') && !e.includes('ERR_CONNECTION_REFUSED')
    )
    expect(critical).toHaveLength(0)
  })

  test('status bar renders with at least one agent', async ({ page }) => {
    await page.goto('/')
    // Wait for gateway poll (5s interval + margin)
    await page.waitForTimeout(7000)
    // Agent pills in bottom status bar are cursor-pointer divs inside the bar
    const agentPills = page.locator('[style*="cursor: pointer"]')
    const count = await agentPills.count()
    expect(count).toBeGreaterThan(0)
  })

  test('header buttons visible (settings, sound, stats, design)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '⚙️' })).toBeVisible()
    await expect(page.getByRole('button', { name: /🔇|🔊/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '📊' })).toBeVisible()
    await expect(page.getByRole('button', { name: /עיצוב/ })).toBeVisible()
  })
})
