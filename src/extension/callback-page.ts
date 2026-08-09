const LOGO = `
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
  <path fill="#fff" d="M4 6.5A1.5 1.5 0 0 1 5.5 5h9a3.5 3.5 0 0 1 1.02 6.85l2.36 3.65a1 1 0 0 1-1.68 1.08l-2.7-4.18H8v3.6a1 1 0 1 1-2 0V6.5Zm2 3.5h8.5a1.5 1.5 0 0 0 0-3H6v3Z"/>
  <path fill="#fff" d="M3 18.5a1 1 0 0 1 1-1h12l-1.3-1.3a1 1 0 0 1 1.4-1.4l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 0 1-1.4-1.4l1.3-1.3H4a1 1 0 0 1-1-1Z"/>
</svg>`

export function callbackPage(opts: { title: string; message: string }): string {
  const { title, message } = opts
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title} — RREQUEST</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(1000px 520px at 50% -10%, #15222f 0%, #0b1117 55%, #070b10 100%);
    color: #e6edf3; -webkit-font-smoothing: antialiased;
  }
  .card {
    width: min(400px, 90vw); padding: 40px 32px 36px; text-align: center;
    background: #10161d; border: 1px solid #263341; border-radius: 16px;
    box-shadow: 0 24px 64px rgba(0,0,0,.5);
  }
  .logo {
    width: 64px; height: 64px; margin: 0 auto 18px; display: flex; align-items: center; justify-content: center;
    border-radius: 16px; background: linear-gradient(135deg, #4aa5f0, #2f6fb3);
    box-shadow: 0 10px 28px rgba(74,165,240,.35);
  }
  .logo svg { width: 34px; height: 34px; }
  h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: .14em; font-weight: 700; }
  p { margin: 0 auto; max-width: 300px; color: #9db1c3; font-size: 14px; line-height: 1.55; }
  .pill {
    display: inline-flex; align-items: center; gap: 7px; margin-top: 22px; padding: 6px 14px;
    border-radius: 999px; font-size: 12.5px; font-weight: 600; color: #6fd98a;
    background: rgba(111,217,138,.1); border: 1px solid rgba(111,217,138,.32);
  }
  .pill svg { width: 13px; height: 13px; }
  .foot { margin-top: 22px; font-size: 11.5px; color: #5c6f80; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">${LOGO}</div>
    <h1>RREQUEST</h1>
    <p>${message}</p>
    <div class="pill">
      <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.2 11.7 13 4.5" stroke="#6fd98a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Done
    </div>
    <div class="foot">You can close this tab</div>
  </div>
</body>
</html>`
}
