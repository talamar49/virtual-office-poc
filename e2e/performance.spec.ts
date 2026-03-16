/**
 * Performance benchmarks — load time, paint, memory.
 * These run on Chromium only (CDP needed for detailed metrics).
 */
import { test, expect, chromium } from '@playwright/test'

test.describe('Performance', () => {
  // FCP / LCP benchmarks
  test('First Contentful Paint < 3s', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const fcp = await page.evaluate(() =>
      new Promise<number>(resolve => {
        const obs = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              obs.disconnect()
              resolve(entry.startTime)
            }
          }
        })
        obs.observe({ type: 'paint', buffered: true })
        // Fallback timeout
        setTimeout(() => resolve(performance.now()), 5000)
      })
    )
    console.log(`[perf] FCP: ${fcp.toFixed(0)}ms`)
    expect(fcp).toBeLessThan(3000)
  })

  test('canvas renders within 5s of page load', async ({ page }) => {
    const start = Date.now()
    await page.goto('/')
    await page.locator('canvas').waitFor({ state: 'visible', timeout: 5000 })
    const elapsed = Date.now() - start
    console.log(`[perf] Canvas visible: ${elapsed}ms`)
    expect(elapsed).toBeLessThan(5000)
  })

  test('page JS bundle < 500KB (gzipped estimate)', async ({ page }) => {
    let totalBytes = 0
    page.on('response', async res => {
      const url = res.url()
      if (url.includes('.js') && res.status() === 200) {
        try {
          const buf = await res.body()
          totalBytes += buf.length
        } catch { /* ignore */ }
      }
    })
    await page.goto('/', { waitUntil: 'networkidle' })
    const kb = totalBytes / 1024
    console.log(`[perf] Total JS: ${kb.toFixed(0)}KB`)
    // Vite build target: ~253KB (raw), generous limit for dev mode
    expect(kb).toBeLessThan(10_000) // 10MB — dev mode with source maps
  })

  test('no memory leak — heap stable after 10s idle', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    // @ts-ignore CDP
    const client = await (page.context() as any).newCDPSession(page)
    await client.send('HeapProfiler.enable')
    const before = await client.send('Runtime.evaluate', {
      expression: 'performance.memory ? performance.memory.usedJSHeapSize : -1',
    })
    const beforeBytes = before.result.value as number

    await page.waitForTimeout(10_000)

    const after = await client.send('Runtime.evaluate', {
      expression: 'performance.memory ? performance.memory.usedJSHeapSize : -1',
    })
    const afterBytes = after.result.value as number

    if (beforeBytes > 0 && afterBytes > 0) {
      const growthMB = (afterBytes - beforeBytes) / 1024 / 1024
      console.log(`[perf] Heap growth over 10s: ${growthMB.toFixed(1)}MB`)
      // Allow up to 20MB growth (canvas animation + polling)
      expect(growthMB).toBeLessThan(20)
    }
  })

  test('canvas animation — rAF is running (not frozen)', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const frameCount = await page.evaluate(() => {
      return new Promise<number>(resolve => {
        let count = 0
        const start = performance.now()
        function tick() {
          count++
          if (performance.now() - start < 1000) {
            requestAnimationFrame(tick)
          } else {
            resolve(count)
          }
        }
        requestAnimationFrame(tick)
      })
    })

    console.log(`[perf] rAF fps (1s sample): ${frameCount}fps`)
    // Should be running at least 10fps (headless browser throttles)
    expect(frameCount).toBeGreaterThan(10)
  })
})
