import { expect, test } from '@playwright/test'
import { addItems, liveItems, signInFresh } from './helpers'

// A Pixel 9 is 412 × 923 CSS pixels; the installed app loses about 60 of
// them to the status bar and the gesture bar.
test.use({ viewport: { width: 412, height: 860 } })

test('fifteen items fit on a Pixel 9 screen without scrolling', async ({ page }) => {
  await signInFresh(page)
  const names = Array.from({ length: 15 }, (_, i) => `Item ${i + 1}`)
  await addItems(page, ...names)
  await expect(liveItems(page)).toHaveCount(15)

  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const last = await page.getByTestId('live-items').getByRole('listitem').last().boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(860)
  // Rows stay big enough to tap while pushing a trolley.
  expect(last!.height).toBeGreaterThanOrEqual(40)
})
