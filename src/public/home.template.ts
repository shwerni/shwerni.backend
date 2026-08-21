// raw html for the plain status homepage, embedded directly so no
// static asset copy step is needed at build or deploy time
export const homeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Shwerni</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    background: rgb(245, 248, 255);
    font-family: "Baloo Bhaijaan 2", sans-serif;
    color: #0f172a;
    min-height: 100vh;
  }

  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px 0;
  }

  .logo-mark {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #475569;
  }

  .logo-mark svg { width: 18px; height: 18px; }

  .logo-text {
    font-size: 18px;
    font-weight: 700;
    color: #1e293b;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 60px 0;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    color: #475569;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 16px;
    border-radius: 999px;
    margin-bottom: 28px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #64748b;
  }

  h1 {
    font-size: clamp(28px, 4.5vw, 40px);
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 14px;
  }

  .subtitle {
    font-size: 16px;
    font-weight: 500;
    color: #64748b;
    max-width: 420px;
    line-height: 1.8;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    width: 100%;
    margin-top: 56px;
  }

  .card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 20px 16px;
    text-align: center;
  }

  .icon-badge {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: #f1f5f9;
    color: #475569;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 12px;
  }

  .icon-badge svg { width: 18px; height: 18px; }

  .card p {
    font-size: 13px;
    font-weight: 600;
    color: #475569;
  }

  footer {
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: #94a3b8;
    padding-top: 32px;
  }

  @media (max-width: 560px) {
    .cards { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="page">
    <nav>
      <div class="logo-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/>
        </svg>
      </div>
      <span class="logo-text">Shwerni</span>
    </nav>

    <main>
      <div class="status-pill">
        <span class="dot"></span>
        Service running
      </div>

      <h1>Hello, this is the Shwerni backend</h1>
      <p class="subtitle">
        Everything's connected and ready to go.
      </p>

      <div class="cards">
        <div class="card">
          <div class="icon-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3 3"/>
            </svg>
          </div>
          <p>Realtime</p>
        </div>

        <div class="card">
          <div class="icon-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <p>Secure</p>
        </div>

        <div class="card">
          <div class="icon-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z"/>
            </svg>
          </div>
          <p>Fast</p>
        </div>
      </div>
    </main>

    <footer>Shwerni</footer>
  </div>
</body>
</html>`;
