import { expect, test } from '@playwright/test'

// Signs in through the real button and popup. The popup loads a script from
// apis.google.com even against the emulator, so this test needs that host.
test('the Google button signs in through the popup', async ({ page }) => {
  await page.goto('/')
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  const popup = await popupPromise

  // The Auth emulator's stand-in for the Google account chooser.
  await popup.getByText('Add new account').click()
  await popup.locator('#email-input').fill('rick@example.com')
  await popup.locator('#display-name-input').fill('Rick Tester')
  await popup.locator('#sign-in').click()

  await expect(page.getByTestId('user-name')).toHaveText('Rick Tester')
})
