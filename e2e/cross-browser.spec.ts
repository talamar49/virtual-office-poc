/**
 * Cross-browser parity tests — same behaviour in Chrome, Firefox, WebKit.
 */
import { test, expect } from './fixtures'

test.describe('Cross-browser', () => {
  test('canvas is rendered (not blank)', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(100)
    expect(box!.height).toBeGreaterThan(100)
  })

  test('canvas has drawn pixels', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const hasPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return false
      const ctx = canvas.getContext('2d')
      if (!ctx) return false
      const w = canvas.width, h = canvas.height
      const points = [
        [w * 0.25, h * 0.25],
        [w * 0.5,  h * 0.5 ],
        [w * 0.75, h * 0.75],
      ]
      return points.some(([x, y]) => {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
        return a > 0 && (r > 5 || g > 5 || b > 5)
      })
    })
    expect(hasPixels).toBe(true)
  })

  test('responsive — canvas resizes with viewport', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(500)
    const desktopBox = await page.locator('canvas').boundingBox()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    const mobileBox = await page.locator('canvas').boundingBox()

    expect(desktopBox).not.toBeNull()
    expect(mobileBox).not.toBeNull()
    expect(mobileBox!.width).toBeLessThan(desktopBox!.width)
  })

  test('sound button is clickable', async ({ page }) => {
    await page.goto('/')
    const soundBtn = page.locator('button', { hasText: /🔇|🔊/ })
    await expect(soundBtn).toBeVisible()
    await soundBtn.click()
    await page.waitForTimeout(300)
    // No crash = pass
  })

  test('stats button (📊) is clickable', async ({ page }) => {
    await page.goto('/')
    const statsBtn = page.locator('button', { hasText: '📊' })
    await expect(statsBtn).toBeVisible()
    await statsBtn.click()
    await page.waitForTimeout(300)
    // No crash = pass
  })

  test('language toggle button present', async ({ page }) => {
    await page.goto('/')
    const langBtn = page.locator('button', { hasText: /EN|HE|עב/ })
    await expect(langBtn).toBeVisible()
  })
})
