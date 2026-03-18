/**
 * Custom fixtures — inject sessionStorage gateway token before every test.
 * Required because v3 branch uses sessionStorage (not localStorage).
 */
import { test as base, expect } from '@playwright/test'

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '689f7e21b95f21b17992b22e7e0f3a62e6e061b665b8187b'
const GATEWAY_URL   = process.env.GATEWAY_URL   || 'http://127.0.0.1:18789'

export const test = base.extend({
  page: async ({ page }, use) => {
    // Inject sessionStorage before any navigation
    await page.addInitScript(([token, url]) => {
      sessionStorage.setItem('gateway-token', token)
      sessionStorage.setItem('gateway-url', url)
    }, [GATEWAY_TOKEN, GATEWAY_URL] as [string, string])
    await use(page)
  },
})

export { expect }
