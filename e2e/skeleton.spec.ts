import { expect, test } from '@playwright/test'

test('the manifest makes the app installable', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(href!)).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  )
})

test('the app shell opens with no network', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Appeltaart' })).toBeVisible()
})

// These sign in through the emulator directly, because the popup cannot
// open offline; e2e/popup.spec.ts covers the popup itself.
test('a signed-in user sees their name, also after a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await page.evaluate(() => window.emulatorSignIn!('Rick Tester', 'rick@example.com'))

  await expect(page.getByTestId('user-name')).toHaveText('Rick Tester')
  await page.reload()
  await expect(page.getByTestId('user-name')).toHaveText('Rick Tester')
})

test('a signed-in user still sees their name when the app starts offline', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.evaluate(() => window.emulatorSignIn!('Rick Tester', 'rick@example.com'))
  await expect(page.getByTestId('user-name')).toHaveText('Rick Tester')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('user-name')).toHaveText('Rick Tester')
})
