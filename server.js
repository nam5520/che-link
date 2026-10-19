const { createClient } = require("@libsql/client");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// Local SQLite khi dev, Turso khi production
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:links.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Cache logo buffer
const LOGO_PATH = path.join(__dirname, "public", "logo.png");
let logoBuffer = null;
if (fs.existsSync(LOGO_PATH)) {
  logoBuffer = fs.readFileSync(LOGO_PATH);
}

// In-memory active session tokens
const SESSIONS = new Map(); // token -> { username, expiresAt }

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(cookie => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.zhost_session || req.headers["x-session-token"];
  if (!token) return null;
  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  return session.username;
}

// ==========================================
// ADMIN PORTAL & CODE PANEL (GET /admin)
// ==========================================
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Z HOST - Quản Trị Hệ Thống (/admin)</title>
  <link rel="icon" type="image/png" href="/logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #ef4444;
      --primary-dark: #dc2626;
      --primary-glow: rgba(239, 68, 68, 0.35);
      --primary-subtle: rgba(239, 68, 68, 0.12);
      --bg-body: #090d16;
      --bg-surface: #111726;
      --bg-surface-elevated: #162035;
      --bg-input: #0b1120;
      --border-color: rgba(255, 255, 255, 0.08);
      --border-focus: #ef4444;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --success: #10b981;
      --danger: #f43f5e;
      --radius-sm: 8px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background-color: var(--bg-body);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 900px;
      height: 600px;
      background: radial-gradient(circle, rgba(239, 68, 68, 0.13) 0%, rgba(17, 23, 38, 0.02) 70%, transparent 100%);
      pointer-events: none;
      z-index: 0;
      filter: blur(60px);
    }
    .bg-grid {
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }
    .app-wrapper {
      position: relative;
      z-index: 1;
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* LOGIN VIEW */
    .login-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .login-card {
      width: 100%;
      max-width: 440px;
      background: rgba(17, 23, 38, 0.78);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 2.5rem 2rem;
      box-shadow: 
        0 25px 60px -15px rgba(0, 0, 0, 0.7),
        0 0 35px -5px rgba(239, 68, 68, 0.12);
      position: relative;
      overflow: hidden;
      animation: cardAppear 0.5s ease-out;
    }
    .login-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 10%;
      right: 10%;
      height: 2px;
      background: linear-gradient(90deg, transparent, #ef4444, transparent);
    }
    @keyframes cardAppear {
      from { opacity: 0; transform: translateY(20px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .logo-container {
      display: flex;
      justify-content: center;
      margin-bottom: 1.5rem;
    }
    .logo-badge {
      background: #ffffff;
      padding: 10px 22px;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition);
    }
    .logo-badge:hover { transform: translateY(-2px); }
    .logo-img {
      height: 48px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .login-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .login-header h1 {
      font-size: 1.45rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.35rem;
    }
    .login-header p {
      font-size: 0.88rem;
      color: var(--text-muted);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    .form-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 0.45rem;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-icon {
      position: absolute;
      left: 14px;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      pointer-events: none;
      transition: var(--transition);
    }
    .input-wrapper input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 0.8rem 1rem 0.8rem 2.75rem;
      border-radius: var(--radius-sm);
      font-size: 0.95rem;
      font-family: inherit;
      transition: var(--transition);
      outline: none;
    }
    .input-wrapper input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--primary-subtle);
    }
    .input-wrapper input:focus ~ .input-icon {
      color: var(--primary);
    }
    .toggle-pass-btn {
      position: absolute;
      right: 12px;
      background: none;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      padding: 6px;
      display: flex;
      align-items: center;
      border-radius: 6px;
      transition: var(--transition);
    }
    .toggle-pass-btn:hover { color: var(--text-main); }
    .login-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      font-size: 0.84rem;
    }
    .remember-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }
    .remember-label input[type="checkbox"] {
      accent-color: var(--primary);
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: #fff;
      border: none;
      padding: 0.85rem 1.25rem;
      border-radius: var(--radius-sm);
      font-size: 0.98rem;
      font-weight: 600;
      cursor: pointer;
      transition: var(--transition);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      box-shadow: 0 4px 18px var(--primary-glow);
    }
    .btn-submit:hover:not(:disabled) {
      background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 22px rgba(239, 68, 68, 0.5);
    }
    .btn-submit:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .login-alert {
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      margin-bottom: 1.25rem;
      display: none;
      align-items: center;
      gap: 0.6rem;
      animation: alertShake 0.4s ease-in-out;
    }
    @keyframes alertShake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .login-alert.err {
      display: flex !important;
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid rgba(244, 63, 94, 0.35);
      color: #fda4af;
    }
    .login-footer {
      text-align: center;
      margin-top: 1.5rem;
      font-size: 0.78rem;
      color: var(--text-dim);
    }

    /* ================= DASHBOARD: ONLY 1 PANEL WITH CODE BOX ================= */
    .dashboard-view {
      display: none;
      flex-direction: column;
      flex: 1;
    }
    .navbar {
      background: rgba(17, 23, 38, 0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .nav-inner {
      max-width: 1180px;
      margin: 0 auto;
      padding: 0.85rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .nav-logo-badge {
      background: #ffffff;
      padding: 6px 14px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
    }
    .nav-logo-img {
      height: 30px;
      width: auto;
      object-fit: contain;
    }
    .nav-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .nav-tag {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--primary-subtle);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.25);
    }
    .nav-user-area {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .user-chip {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      padding: 0.45rem 0.85rem;
      border-radius: 999px;
      font-size: 0.84rem;
      color: #e2e8f0;
    }
    .user-avatar-circle {
      width: 22px;
      height: 22px;
      background: var(--primary);
      color: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .btn-nav {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 0.5rem 0.9rem;
      border-radius: var(--radius-sm);
      font-size: 0.84rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: var(--transition);
      font-family: inherit;
    }
    .btn-nav:hover { background: rgba(255, 255, 255, 0.12); }
    .btn-nav.btn-logout:hover {
      background: rgba(244, 63, 94, 0.18);
      color: #fda4af;
      border-color: rgba(244, 63, 94, 0.35);
    }

    .main-content {
      max-width: 1180px;
      width: 100%;
      margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    /* THE SINGLE CODE PANEL */
    .single-code-panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 580px;
      overflow: hidden;
      border-top: 3px solid #ef4444;
    }

    .panel-header {
      padding: 1.25rem 1.75rem;
      background: var(--bg-surface-elevated);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .panel-header-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .panel-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .panel-title-text h2 {
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
    }

    .panel-title-text p {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .panel-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .btn-action-panel {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 0.6rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      transition: var(--transition);
      font-family: inherit;
      text-decoration: none;
    }

    .btn-action-panel:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    .btn-save-code {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: #fff;
      border: none;
      padding: 0.65rem 1.4rem;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      box-shadow: 0 4px 16px var(--primary-glow);
      transition: var(--transition);
      font-family: inherit;
    }

    .btn-save-code:hover:not(:disabled) {
      background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.5);
    }

    .btn-save-code:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    /* CODE EDITOR TEXTAREA */
    .code-editor-wrapper {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0b0f19;
    }

    .code-editor {
      width: 100%;
      flex: 1;
      min-height: 480px;
      background: #090d16;
      border: none;
      color: #f1f5f9;
      font-family: 'Fira Code', 'Consolas', 'Courier New', monospace;
      font-size: 0.95rem;
      line-height: 1.6;
      padding: 1.5rem;
      resize: vertical;
      outline: none;
      tab-size: 2;
    }

    .code-editor:focus {
      background: #070a12;
    }

    .editor-footer {
      padding: 0.75rem 1.75rem;
      background: var(--bg-surface-elevated);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-dim);
    }

    .editor-stats {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    /* Toast */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .toast {
      background: #1e293b;
      border: 1px solid var(--border-color);
      color: #fff;
      padding: 0.85rem 1.25rem;
      border-radius: var(--radius-sm);
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.9rem;
      pointer-events: auto;
      animation: toastIn 0.3s ease-out;
      min-width: 260px;
    }
    .toast.success { border-left: 4px solid var(--success); }
    .toast.error { border-left: 4px solid var(--danger); }
    @keyframes toastIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .spinner {
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      animation: spin 0.7s linear infinite;
      display: inline-block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="bg-grid"></div>

  <div class="app-wrapper">
    <!-- ================= LOGIN SCREEN ================= -->
    <div id="loginView" class="login-container">
      <div class="login-card">
        <div class="logo-container">
          <div class="logo-badge">
            <img src="/logo.png" alt="Z HOST Logo" class="logo-img">
          </div>
        </div>

        <div class="login-header">
          <h1>Đăng Nhập Quản Trị</h1>
          <p>Hệ thống quản trị Z HOST (/admin)</p>
        </div>

        <div id="loginAlert" class="login-alert"></div>

        <form id="loginForm" autocomplete="on">
          <div class="form-group">
            <label class="form-label" for="usernameInput">Tài khoản</label>
            <div class="input-wrapper">
              <span class="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input type="text" id="usernameInput" name="username" placeholder="Nhập tài khoản" required autofocus autocomplete="username">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="passwordInput">Mật khẩu</label>
            <div class="input-wrapper">
              <span class="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input type="password" id="passwordInput" name="password" placeholder="Nhập mật khẩu" required autocomplete="current-password">
              <button type="button" class="toggle-pass-btn" id="togglePassBtn" title="Hiện/ẩn mật khẩu">
                <svg id="eyeIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>

          <div class="login-actions">
            <label class="remember-label">
              <input type="checkbox" id="rememberMe" checked>
              <span>Ghi nhớ đăng nhập</span>
            </label>
          </div>

          <button type="submit" class="btn-submit" id="loginBtn">
            <span id="loginBtnText">Đăng Nhập</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </form>

        <div class="login-footer">
          &copy; Z HOST &bull; TECH LEADS FUTURE &bull; All Rights Reserved
        </div>
      </div>
    </div>

    <!-- ================= DASHBOARD: 1 SINGLE PANEL WITH CODE INPUT ================= -->
    <div id="dashboardView" class="dashboard-view">
      <nav class="navbar">
        <div class="nav-inner">
          <div class="nav-brand">
            <div class="nav-logo-badge">
              <img src="/logo.png" alt="Z HOST Logo" class="nav-logo-img">
            </div>
            <div class="nav-title">
              Z HOST <span class="nav-tag">Quản Trị</span>
            </div>
          </div>

          <div class="nav-user-area">
            <div class="user-chip">
              <div class="user-avatar-circle" id="userAvatar">X</div>
              <span id="userNameDisplay">xnknoch1</span>
            </div>

            <button type="button" class="btn-nav btn-logout" id="btnLogout" title="Đăng xuất">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      </nav>

      <div class="main-content">
        <!-- THE SINGLE PANEL -->
        <div class="single-code-panel">
          <div class="panel-header">
            <div class="panel-header-title">
              <div class="panel-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              </div>
              <div class="panel-title-text">
                <h2>Bảng Nhập Mã Nguồn (Code Panel)</h2>
                <p>Nhập hoặc dán mã code của bạn vào đây. Mã này sẽ được hiển thị khi truy cập trang chính.</p>
              </div>
            </div>

            <div class="panel-actions">
              <a href="/" target="_blank" class="btn-action-panel" title="Mở trang chủ kiểm tra trực tiếp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                <span>Xem Trang Live</span>
              </a>

              <button type="button" class="btn-action-panel" id="btnCopyCode" title="Sao chép toàn bộ code">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Sao chép</span>
              </button>

              <button type="button" class="btn-action-panel" id="btnClearCode" title="Xóa trắng khung code">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Xóa</span>
              </button>

              <button type="button" class="btn-save-code" id="btnSaveCode">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                <span id="btnSaveText">Lưu Code (Ctrl+S)</span>
              </button>
            </div>
          </div>

          <div class="code-editor-wrapper">
            <textarea id="codeEditor" class="code-editor" spellcheck="false" placeholder="<!-- Dán hoặc nhập mã code (HTML / CSS / JavaScript / Iframe...) vào đây -->"></textarea>

            <div class="editor-footer">
              <div class="editor-stats">
                <span id="charCount">0 ký tự</span>
                <span id="lineCount">1 dòng</span>
              </div>
              <div id="saveStatus">Đã đồng bộ dữ liệu</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toastContainer" class="toast-container"></div>

  <script>
    let currentUser = null;

    const loginView = document.getElementById('loginView');
    const dashboardView = document.getElementById('dashboardView');
    const loginForm = document.getElementById('loginForm');
    const loginAlert = document.getElementById('loginAlert');
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const togglePassBtn = document.getElementById('togglePassBtn');
    const btnLogout = document.getElementById('btnLogout');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userAvatar = document.getElementById('userAvatar');

    // Code panel elements
    const codeEditor = document.getElementById('codeEditor');
    const btnSaveCode = document.getElementById('btnSaveCode');
    const btnSaveText = document.getElementById('btnSaveText');
    const btnCopyCode = document.getElementById('btnCopyCode');
    const btnClearCode = document.getElementById('btnClearCode');
    const charCount = document.getElementById('charCount');
    const lineCount = document.getElementById('lineCount');
    const saveStatus = document.getElementById('saveStatus');

    function showToast(message, type = 'success') {
      const c = document.getElementById('toastContainer');
      const t = document.createElement('div');
      t.className = 'toast ' + type;
      t.innerHTML = (type === 'success' 
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>') +
        '<span>' + message + '</span>';
      c.appendChild(t);
      setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
        t.style.transition = 'all 0.3s ease';
        setTimeout(() => t.remove(), 300);
      }, 3500);
    }

    togglePassBtn.addEventListener('click', () => {
      const isPass = passwordInput.type === 'password';
      passwordInput.type = isPass ? 'text' : 'password';
      togglePassBtn.innerHTML = isPass
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    });

    async function checkAuth() {
      try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.ok && data.user) {
          currentUser = data.user;
          showDashboard();
        } else {
          showLogin();
        }
      } catch (err) {
        showLogin();
      }
    }

    function showLogin() {
      loginView.style.display = 'flex';
      dashboardView.style.display = 'none';
      usernameInput.focus();
    }

    function showDashboard() {
      loginView.style.display = 'none';
      dashboardView.style.display = 'flex';
      userNameDisplay.textContent = currentUser.username || 'xnknoch1';
      userAvatar.textContent = (currentUser.username || 'X').charAt(0).toUpperCase();
      loadCode();
    }

    // Login Form Submit
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginAlert.className = 'login-alert';
      loginAlert.style.display = 'none';

      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      const remember = document.getElementById('rememberMe').checked;

      loginBtn.disabled = true;
      loginBtnText.innerHTML = '<span class="spinner"></span> Đang xác thực...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, remember })
        });
        const data = await res.json();

        if (data.ok) {
          currentUser = data.user;
          showToast('Đăng nhập thành công! Chào mừng ' + currentUser.username, 'success');
          showDashboard();
        } else {
          loginAlert.className = 'login-alert err';
          loginAlert.style.display = 'flex';
          loginAlert.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>' + (data.message || 'Tài khoản hoặc mật khẩu không chính xác') + '</span>';
          showToast(data.message || 'Tài khoản hoặc mật khẩu không chính xác', 'error');
        }
      } catch (err) {
        loginAlert.className = 'login-alert err';
        loginAlert.style.display = 'flex';
        loginAlert.textContent = 'Lỗi kết nối tới máy chủ. Vui lòng thử lại!';
        showToast('Lỗi kết nối tới máy chủ. Vui lòng thử lại!', 'error');
      } finally {
        loginBtn.disabled = false;
        loginBtnText.textContent = 'Đăng Nhập';
      }
    });

    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST' });
      } catch (e) {}
      currentUser = null;
      showToast('Đã đăng xuất tài khoản', 'success');
      showLogin();
    });

    // Load Saved Code
    async function loadCode() {
      try {
        const res = await fetch('/api/code');
        if (res.status === 401) {
          showLogin();
          return;
        }
        const data = await res.json();
        if (data.ok) {
          codeEditor.value = data.code || '';
          updateEditorStats();
          saveStatus.textContent = 'Đã tải mã nguồn mới nhất';
        }
      } catch (err) {
        console.error('Error loading code:', err);
      }
    }

    // Save Code
    async function saveCode() {
      const codeVal = codeEditor.value;
      btnSaveCode.disabled = true;
      btnSaveText.innerHTML = '<span class="spinner"></span> Đang lưu...';

      try {
        const res = await fetch('/api/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codeVal })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Đã lưu mã code thành công!', 'success');
          saveStatus.textContent = 'Đã lưu lúc ' + new Date().toLocaleTimeString();
        } else {
          showToast(data.message || 'Lỗi khi lưu code', 'error');
        }
      } catch (err) {
        showToast('Lỗi kết nối máy chủ khi lưu code', 'error');
      } finally {
        btnSaveCode.disabled = false;
        btnSaveText.textContent = 'Lưu Code (Ctrl+S)';
      }
    }

    btnSaveCode.addEventListener('click', saveCode);

    // Keyboard shortcut Ctrl+S
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dashboardView.style.display === 'flex') {
          saveCode();
        }
      }
    });

    // Support Tab indentation in textarea
    codeEditor.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 2;
        updateEditorStats();
      }
    });

    function updateEditorStats() {
      const val = codeEditor.value;
      charCount.textContent = val.length.toLocaleString() + ' ký tự';
      const lines = val ? val.split('\\n').length : 1;
      lineCount.textContent = lines.toLocaleString() + ' dòng';
    }

    codeEditor.addEventListener('input', () => {
      updateEditorStats();
      saveStatus.textContent = 'Có thay đổi chưa lưu...';
    });

    // Copy Code Button
    btnCopyCode.addEventListener('click', () => {
      if (!codeEditor.value) {
        showToast('Khung code đang trống', 'error');
        return;
      }
      navigator.clipboard.writeText(codeEditor.value).then(() => {
        showToast('Đã sao chép toàn bộ code vào clipboard!');
      }).catch(() => {
        showToast('Không thể sao chép tự động', 'error');
      });
    });

    // Clear Code Button
    btnClearCode.addEventListener('click', () => {
      if (!codeEditor.value) return;
      if (confirm('Bạn có chắc muốn xóa trắng khung code không?')) {
        codeEditor.value = '';
        updateEditorStats();
        saveStatus.textContent = 'Đã xóa trắng (chưa lưu)';
      }
    });

    // Run auth check on load
    checkAuth();
  </script>
</body>
</html>`;

async function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function handle(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const { pathname } = urlObj;

  // 1. Phục vụ logo: GET /logo.png
  if (req.method === "GET" && pathname === "/logo.png") {
    if (logoBuffer) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      });
      return res.end(logoBuffer);
    } else {
      res.writeHead(404);
      return res.end("Logo not found");
    }
  }

  // 2. GET /admin hoặc GET /admin/ hoặc GET /login → Cổng Quản Trị (/admin)
  if (req.method === "GET" && (pathname === "/admin" || pathname === "/admin/" || pathname === "/login")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(ADMIN_HTML);
  }

  // 3. API Đăng Nhập: POST /api/login
  if (req.method === "POST" && pathname === "/api/login") {
    const raw = await readBody(req);
    try {
      const { username, password, remember } = JSON.parse(raw);
      if (!username || !password) {
        return sendJson(res, 400, { ok: false, message: "Vui lòng nhập tài khoản và mật khẩu." });
      }

      const { rows } = await db.execute({
        sql: "SELECT username, password_hash, salt FROM users WHERE username = ?",
        args: [username],
      });

      if (!rows || rows.length === 0) {
        return sendJson(res, 401, { ok: false, message: "Tài khoản hoặc mật khẩu không chính xác." });
      }

      const user = rows[0];
      const testHash = hashPassword(password, user.salt);
      if (testHash !== user.password_hash) {
        return sendJson(res, 401, { ok: false, message: "Tài khoản hoặc mật khẩu không chính xác." });
      }

      const token = generateToken();
      const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      SESSIONS.set(token, {
        username: user.username,
        expiresAt: Date.now() + maxAgeMs,
      });

      const cookieVal = `zhost_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
      return sendJson(res, 200, { ok: true, user: { username: user.username } }, { "Set-Cookie": cookieVal });
    } catch (e) {
      return sendJson(res, 400, { ok: false, message: "Dữ liệu không hợp lệ." });
    }
  }

  // 4. API Đăng Xuất: POST /api/logout
  if (req.method === "POST" && pathname === "/api/logout") {
    const cookies = parseCookies(req);
    const token = cookies.zhost_session;
    if (token) SESSIONS.delete(token);
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "zhost_session=; Path=/; HttpOnly; Max-Age=0",
    });
  }

  // 5. API Kiểm tra phiên: GET /api/me
  if (req.method === "GET" && pathname === "/api/me") {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      return sendJson(res, 200, { ok: false });
    }
    return sendJson(res, 200, { ok: true, user: { username: authUser } });
  }

  // 6. API Lấy mã code đã lưu: GET /api/code (Yêu cầu đăng nhập)
  if (req.method === "GET" && pathname === "/api/code") {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      return sendJson(res, 401, { ok: false, message: "Vui lòng đăng nhập" });
    }
    const { rows } = await db.execute("SELECT code FROM site_code WHERE id = 1");
    const code = rows && rows[0] ? rows[0].code : "";
    return sendJson(res, 200, { ok: true, code });
  }

  // 7. API Lưu mã code: POST /api/code (Yêu cầu đăng nhập)
  if (req.method === "POST" && pathname === "/api/code") {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      return sendJson(res, 401, { ok: false, message: "Vui lòng đăng nhập" });
    }
    const raw = await readBody(req);
    try {
      const { code } = JSON.parse(raw);
      await db.execute({
        sql: `INSERT INTO site_code (id, code, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(id) DO UPDATE SET code = excluded.code, updated_at = CURRENT_TIMESTAMP`,
        args: [code || ""],
      });
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { ok: false, message: "Dữ liệu JSON không hợp lệ" });
    }
  }

  // 8. GET / → Phục vụ mã code đã lưu (Hiển thị trang live của mã code)
  if (req.method === "GET" && pathname === "/") {
    const { rows } = await db.execute("SELECT code FROM site_code WHERE id = 1");
    if (rows && rows[0] && rows[0].code && rows[0].code.trim()) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(rows[0].code);
    }

    // Nếu chưa có code nào: hiển thị thông báo chờ
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Z HOST</title>
  <style>
    body {
      background: #090d16;
      color: #94a3b8;
      font-family: system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
      padding: 1.5rem;
    }
    .box {
      max-width: 460px;
      background: rgba(17, 23, 38, 0.8);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 2.5rem 2rem;
      border-radius: 16px;
    }
    .logo {
      background: #fff;
      padding: 8px 18px;
      border-radius: 10px;
      height: 40px;
      margin-bottom: 1.5rem;
      display: inline-block;
    }
    h2 { color: #fff; font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { font-size: 0.9rem; line-height: 1.5; color: #64748b; }
    a { color: #ef4444; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <div><img src="/logo.png" alt="Z HOST" class="logo"></div>
    <h2>Hệ Thống Z HOST Đang Hoạt Động</h2>
    <p>Chưa có mã nguồn nào được thiết lập. Vui lòng truy cập <a href="/admin">Cổng Quản Trị (/admin)</a> để đưa mã code lên hệ thống.</p>
  </div>
</body>
</html>`);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

async function initDatabase() {
  // Bảng quản trị viên
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Bảng lưu mã code trang chủ
  await db.execute(`CREATE TABLE IF NOT EXISTS site_code (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Xóa tài khoản admin cũ nếu có
  await db.execute("DELETE FROM users WHERE username = 'admin'");

  // Thiết lập tài khoản duy nhất được chỉ định: xnknoch1
  const targetUser = "xnknoch1";
  const targetPass = "zvw2[S3z.P5Y0Q";

  const targetSalt = crypto.randomBytes(16).toString("hex");
  const targetHash = hashPassword(targetPass, targetSalt);

  await db.execute({
    sql: `INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt`,
    args: [targetUser, targetHash, targetSalt],
  });

  console.log(`✓ Đã cấu hình tài khoản quản trị duy nhất: ${targetUser}`);
}

async function main() {
  try {
    await initDatabase();
    http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        console.error("Server error:", e);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Server Internal Error");
      });
    }).listen(PORT, () => {
      console.log(`✓ Z HOST Server đang chạy tại: http://localhost:${PORT}`);
      console.log(`✓ Cổng Đăng Nhập Quản Trị: http://localhost:${PORT}/admin`);
      console.log(`✓ Tài khoản: xnknoch1`);
    });
  } catch (err) {
    console.error("Lỗi khởi động server:", err);
  }
}

main();
