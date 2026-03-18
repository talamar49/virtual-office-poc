/**
 * Global setup — writes localStorage auth so tests skip the settings screen.
 */
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '689f7e21b95f21b17992b22e7e0f3a62e6e061b665b8187b'
const GATEWAY_URL   = process.env.GATEWAY_URL   || 'http://127.0.0.1:18789'
const BASE_URL      = process.env.BASE_URL       || 'http://localhost:18000'
const AUTH_PATH     = path.join(__dirname, 'auth.json')

async function globalSetup() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(BASE_URL)
  await page.evaluate(([token, url]) => {
    localStorage.setItem('gateway-token', token)
    localStorage.setItem('gateway-url', url)
  }, [GATEWAY_TOKEN, GATEWAY_URL])
  await page.context().storageState({ path: AUTH_PATH })
  await browser.close()
  console.log('[setup] Auth saved to', AUTH_PATH)
}

export default globalSetup
