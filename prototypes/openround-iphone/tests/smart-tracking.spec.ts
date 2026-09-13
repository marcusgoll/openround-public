import { expect, test } from '@playwright/test';
test.setTimeout(60000);

test('browser explains native requirement without offering fake capture', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name:'DEMO ROUND', exact:true}).click();
  await page.getByRole('button', {name:'Menu',exact:true}).click();
  await page.getByTestId('menu-smart-tracking').click();
  await expect(page.getByText('Native iPhone app required',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'START / RESUME RECORDING',exact:true})).toHaveCount(0);
});

test('native bridge review persists corrections, preserves score, and stops at round end', async ({page}) => {
  await page.addInitScript(() => {
    const state = {recording:false, requested:false, precise:true, permission:4, activeSessionID:'test-session', sessions:[] as unknown[], session:undefined as any};
    const calls: string[] = [];
    Object.assign(window, {webkit:{messageHandlers:{bridge:{}}}, __trackingCalls:calls});
    Object.assign(window, {Capacitor:{PluginHeaders:[{name:'SmartTracking',methods:['start','stop','snapshot','correct'].map(name=>({name,rtype:'promise'}))}],
      nativePromise: async (_plugin: string, method: string, options: any) => {
        calls.push(method);
        if (method === 'start') {
          const base = Date.now()-80000;
          state.recording = state.requested = true;
          state.session ??= {sessionID:'test-session', context:options, running:true, corrections:[], fixes:[0,8000,16000,60000,68000,76000].map((time,i)=>({id:String(i),time:base+time,lat:32+(i>2?200/121600:0),lon:-97,accuracy:4,hole:options.hole,segment:'one'}))};
          state.session.context = options;
          state.sessions = [{sessionID:'test-session',roundID:options.roundID,courseID:options.courseID,fixCount:6}];
        }
        if (method === 'correct') state.session.corrections = [options];
        if (method === 'stop' && (window as any).__failStop) throw new Error('Simulated storage failure');
        if (method === 'stop') state.recording = state.requested = false;
        return structuredClone(state);
      }
    }});
  });
  await page.goto('/');
  await page.getByRole('button', {name:'START ROUND',exact:true}).click();
  await page.getByRole('button', {name:'BEGIN ROUND',exact:true}).click();
  await page.getByRole('button', {name:'Menu',exact:true}).click();
  const before = await page.getByTestId('menu-sheet').locator('.menu-readout strong').textContent();
  await page.getByTestId('menu-smart-tracking').click();
  await page.getByRole('button', {name:'START / RESUME RECORDING',exact:true}).click();
  await expect(page.getByText('1 likely shot',{exact:true})).toBeVisible();
  await page.getByRole('button', {name:'EDIT / REVIEW',exact:true}).click();
  await page.getByRole('combobox',{name:'Starting lie',exact:true}).selectOption('rough');
  await page.getByRole('combobox',{name:'Club',exact:true}).selectOption('');
  await page.getByText('Correct shot locations',{exact:true}).click();
  await page.getByRole('textbox',{name:'Finish latitude',exact:true}).fill('95');
  await expect(page.getByRole('button',{name:'SAVE REVIEW',exact:true})).toBeDisabled();
  await page.getByRole('textbox',{name:'Finish latitude',exact:true}).fill('32.001');
  await page.getByRole('button', {name:'SAVE REVIEW',exact:true}).click();
  await expect(page.getByText('Hole 1 · 122 yd',{exact:true})).toBeVisible();
  await expect(page.getByText('reviewed · Club unknown · rough lie',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Menu',exact:true}).click();
  await expect(page.getByTestId('menu-sheet').locator('.menu-readout strong')).toHaveText(before!);
  await page.getByTestId('menu-smart-tracking').click();
  await expect(page.getByText('reviewed · Club unknown · rough lie',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Menu',exact:true})).toHaveCount(0);
  await page.waitForTimeout(1000); // Let the sheet spring settle before visual capture.
  await page.locator('.mobile-device-screen').screenshot();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Home',exact:true}).click();
  await page.getByRole('button', {name:'END ROUND',exact:true}).click();
  await page.evaluate(() => { (window as any).__failStop = true; });
  await page.locator('.end-round-confirm').click();
  await expect(page.getByRole('dialog',{name:'End current round'}).getByRole('alert')).toContainText('Could not update Smart Tracking');
  await page.evaluate(() => { (window as any).__failStop = false; });
  await page.locator('.end-round-confirm').click();
  await expect(page.getByRole('button', {name:'RESUME ROUND',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__trackingCalls)).toContain('stop');
  await page.getByRole('button',{name:/ROUNDS LOCAL ROUND HISTORY/}).click();
  await page.getByRole('button',{name:'REVIEW SMART TRACKING',exact:true}).click();
  await expect(page.getByText('reviewed · Club unknown · rough lie',{exact:true})).toBeVisible();
});
