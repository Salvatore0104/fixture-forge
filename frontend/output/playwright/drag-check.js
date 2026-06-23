async page => {
  const bar = page.locator('.universe-bar').first();
  const cell = page.locator('[data-channel="20"]').first();
  const bb = await bar.boundingBox();
  const cb = await cell.boundingBox();
  if (!bb || !cb) return 'missing';
  await page.mouse.move(bb.x + 8, bb.y + 10);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 8 });
  const mid = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-forge:mvr-draft') || '{}').items?.[0]?.address);
  await page.mouse.up();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-forge:mvr-draft') || '{}').items?.[0]?.address);
  return JSON.stringify({ mid, after });
}
