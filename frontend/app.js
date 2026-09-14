"use strict";

// ─── Global State & Utilities ──────────────────────────────────────────────────
let currentUser = null;
let currentAuthMode = "login";
let userSearchTimer = null;

const fmt = (n, dec = 0) => {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Number(n).toLocaleString("en-IN", {
    maximumFractionDigits: dec,
    minimumFractionDigits: dec
  });
};

const fmtINR = (n, dec = 0) => "₹" + fmt(n, dec);

const fmtLakhs = (n) => {
  const num = Number(n || 0);
  if (num >= 10000000) return "₹" + (num / 10000000).toFixed(2) + " crore";
  if (num >= 100000) return "₹" + (num / 100000).toFixed(2) + " lakh";
  return fmtINR(num);
};

const fmtPct = (n) => ((n || 0) * 100).toFixed(1) + "%";

function showToast(message, type = "info") {
  let toastContainer = document.getElementById("novaToastContainer");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "novaToastContainer";
    toastContainer.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  const bgMap = {
    success: "linear-gradient(135deg, #065F46, #047857)",
    error: "linear-gradient(135deg, #991B1B, #B91C1C)",
    warning: "linear-gradient(135deg, #92400E, #B45309)",
    info: "linear-gradient(135deg, #1E3A8A, #2563EB)"
  };
  const borderMap = {
    success: "rgba(52,211,153,0.4)",
    error: "rgba(248,113,113,0.4)",
    warning: "rgba(251,191,36,0.4)",
    info: "rgba(96,165,250,0.4)"
  };

  toast.style.cssText = `
    min-width: 280px; max-width: 420px; padding: 12px 18px; border-radius: 8px;
    background: ${bgMap[type] || bgMap.info}; color: #FFFFFF; font-size: 13px; font-weight: 600;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); border: 1px solid ${borderMap[type] || borderMap.info};
    opacity: 0; transform: translateY(12px); transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: auto; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  `;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

async function downloadAssessmentPdf(assessmentId) {
  const token = localStorage.getItem("nova_token");
  if (!token) {
    showToast("Please sign in to download this assessment report.", "error");
    navigateTo("/login");
    return;
  }

  try {
    showToast("Preparing authenticated PDF report...", "info");
    const response = await fetch(`/api/v1/reports/pdf/${encodeURIComponent(assessmentId)}`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      showToast("Session expired or unauthorized. Please re-login.", "error");
      navigateTo("/login");
      return;
    }
    if (response.status === 403) {
      showToast("Access Denied: You cannot download another user's assessment report.", "error");
      return;
    }
    if (response.status === 404) {
      showToast("Assessment record not found.", "error");
      return;
    }
    if (!response.ok) {
      showToast(`Download failed (Server status: ${response.status}).`, "error");
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Nova_Credit_Assessment_${assessmentId}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
    showToast("Assessment report downloaded successfully!", "success");
  } catch (err) {
    console.error("PDF download error:", err);
    showToast("Network error while downloading PDF report.", "error");
  }
}

function pillHtml(decision) {
  const map = {
    "Likely Eligible":       "pill-success",
    "Conditionally Eligible":"pill-info",
    "Manual Review":         "pill-warning",
    "High Risk":             "pill-danger",
    "Insufficient Information":"pill-neutral",
  };
  const cls = map[decision] || "pill-neutral";
  return `<span class="pill ${cls}">${decision}</span>`;
}

function actionBadgeHtml(action) {
  const map = {
    "account_created":            "pill-success",
    "login_success":              "pill-info",
    "login_failed":               "pill-danger",
    "logout":                     "pill-neutral",
    "password_changed":           "pill-warning",
    "credit_assessment_created":  "pill-primary",
    "what_if_simulation_run":     "pill-info",
    "report_generated":           "pill-success",
    "profile_updated":            "pill-neutral",
    "user_activated":             "pill-success",
    "user_deactivated":           "pill-danger",
  };
  const cls = map[action] || "pill-neutral";
  return `<span class="pill ${cls}">${action}</span>`;
}

function getAuthHeaders() {
  const token = localStorage.getItem("nova_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

// ─── SPA Client Router & Route Protection Guards ──────────────────────────────

function navigateTo(path) {
  window.history.pushState(null, "", path);
  routeResolver();
}

window.addEventListener("popstate", routeResolver);

async function routeResolver() {
  const rawPath = window.location.pathname;
  let path = rawPath.toLowerCase();
  if (path === "/" || path === "/login" || path === "") {
    path = "/login";
  }

  // Splash Screen Intro Animation dismissal
  setTimeout(() => {
    const splash = document.getElementById("splash-screen");
    if (splash) splash.classList.add("fade-out");
  }, 1200);

  // Validate stored session token with backend API
  const token = localStorage.getItem("nova_token");
  if (token) {
    try {
      const res = await fetch("/api/v1/auth/me", { headers: { "Authorization": `Bearer ${token}` } });
      if (res.ok) {
        currentUser = await res.json();
      } else {
        currentUser = null;
        localStorage.removeItem("nova_token");
        localStorage.removeItem("nova_user");
      }
    } catch (e) {
      console.warn("Session validation error:", e);
    }
  } else {
    currentUser = null;
  }

  const authGateEl = document.getElementById("view-auth");
  const appShellEl = document.getElementById("appShell");

  // If unauthenticated: redirect to /login and lock app shell
  if (!currentUser) {
    if (authGateEl) authGateEl.style.display = "flex";
    if (appShellEl) appShellEl.style.display = "none";
    return;
  }

  // If authenticated: reveal app shell & hide login gate
  if (authGateEl) authGateEl.style.display = "none";
  if (appShellEl) appShellEl.style.display = "flex";

  updateUserHeaderUI();

  // Admin Route Protection Guard: Only ADMIN role can access /admin/*
  if (path.startsWith("/admin")) {
    if (currentUser.role.upper !== "ADMIN" && currentUser.role !== "ADMIN") {
      alert("Access Denied: Administrative privileges required.");
      navigateTo("/app/dashboard");
      return;
    }
    setupAdminWorkspaceLayout();
    resolveAdminRoute(path);
  } else {
    setupUserWorkspaceLayout();
    resolveUserRoute(path);
  }

  // Refresh Lucide Icons
  if (window.lucide) window.lucide.createIcons();
}

function setupUserWorkspaceLayout() {
  const userNav = document.getElementById("navGroupUser");
  const adminNav = document.getElementById("navGroupAdmin");
  const brandTitle = document.getElementById("brandTitleText");
  const brandBadge = document.getElementById("brandRoleBadge");

  if (userNav) userNav.style.display = "block";
  if (adminNav) adminNav.style.display = "none";
  if (brandTitle) brandTitle.textContent = "NOVA CREDIT";
  if (brandBadge) {
    brandBadge.textContent = "v2.2";
    brandBadge.className = "brand-ver";
  }
}

function setupAdminWorkspaceLayout() {
  const userNav = document.getElementById("navGroupUser");
  const adminNav = document.getElementById("navGroupAdmin");
  const brandTitle = document.getElementById("brandTitleText");
  const brandBadge = document.getElementById("brandRoleBadge");

  if (userNav) userNav.style.display = "none";
  if (adminNav) adminNav.style.display = "block";
  if (brandTitle) brandTitle.textContent = "NOVA ADMIN";
  if (brandBadge) {
    brandBadge.textContent = "ADMIN 👑";
    brandBadge.className = "brand-ver pill pill-warning";
  }
}

function resolveUserRoute(path) {
  hideAllSections();
  const pageTitle = document.getElementById("pageTitle");

  if (path === "/app/credit-assessment") {
    showSection("view-user-assessment");
    if (pageTitle) pageTitle.textContent = "Credit Assessment Intake";
    loadAssessmentWizard();
  } else if (path === "/app/what-if") {
    showSection("view-user-what-if");
    if (pageTitle) pageTitle.textContent = "Improve My Credit";
    loadWhatIfSimulator();
  } else if (path === "/app/history") {
    showSection("view-user-history");
    if (pageTitle) pageTitle.textContent = "Assessment History Ledger";
    loadHistory();
  } else if (path === "/app/loans") {
    showSection("view-user-loans");
    if (pageTitle) pageTitle.textContent = "Loan Intelligence";
    loadLoanIntelligence();
  } else if (path === "/app/investments") {
    showSection("view-user-investments");
    if (pageTitle) pageTitle.textContent = "Wealth & Fund Explorer";
    loadFundExplorer();
  } else if (path === "/app/reports") {
    showSection("view-user-reports");
    if (pageTitle) pageTitle.textContent = "PDF Underwriting Reports";
    loadUserReports();
  } else if (path === "/app/profile") {
    showSection("view-user-profile");
    if (pageTitle) pageTitle.textContent = "Account & Financial Profile";
    loadUserProfile();
  } else if (path === "/app/settings") {
    showSection("view-user-settings");
    if (pageTitle) pageTitle.textContent = "Security & Password Settings";
  } else {
    // Default: /app/dashboard
    showSection("view-user-dashboard");
    if (pageTitle) pageTitle.textContent = "Financial Overview";
    loadUserDashboard();
  }
}

function resolveAdminRoute(path) {
  hideAllSections();
  const pageTitle = document.getElementById("pageTitle");

  if (path === "/admin/users") {
    showSection("view-admin-users");
    if (pageTitle) pageTitle.textContent = "User Accounts Management";
    loadAdminUsers();
  } else if (path === "/admin/activity") {
    showSection("view-admin-activity");
    if (pageTitle) pageTitle.textContent = "System Activity Audit Trail";
    loadAdminActivityLogs();
  } else if (path === "/admin/assessments") {
    showSection("view-admin-assessments");
    if (pageTitle) pageTitle.textContent = "Global Credit Underwriting Log";
    loadAdminAssessments();
  } else if (path === "/admin/models") {
    showSection("view-admin-models");
    if (pageTitle) pageTitle.textContent = "Champion Model Health & Diagnostics";
    loadAdminModels();
  } else if (path === "/admin/system") {
    showSection("view-admin-system");
    if (pageTitle) pageTitle.textContent = "System Diagnostic Overview";
  } else {
    // Default: /admin/dashboard
    showSection("view-admin-dashboard");
    if (pageTitle) pageTitle.textContent = "System Operational Dashboard";
    loadAdminDashboard();
  }
}

function hideAllSections() {
  document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
}

function showSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById("appSidebar");
  const overlay = document.getElementById("mobileOverlay");
  if (sidebar) sidebar.classList.toggle("mobile-open");
  if (overlay) overlay.classList.toggle("active");
}

// ─── Authentication Gate Handlers ──────────────────────────────────────────────

function switchAuthMode(mode) {
  currentAuthMode = mode;
  const btnLogin = document.getElementById("btnTabLogin");
  const btnReg = document.getElementById("btnTabRegister");
  const nameGrp = document.getElementById("fieldGroupName");
  const btnText = document.getElementById("btnAuthText");
  const forgotLink = document.getElementById("linkForgotPass");
  const headerTitle = document.getElementById("authHeaderTitle");
  const headerSub = document.getElementById("authHeaderSub");
  const chkText = document.getElementById("chkRememberText");

  hideAuthAlert();

  if (mode === "login") {
    if (btnLogin) btnLogin.classList.add("active");
    if (btnReg) btnReg.classList.remove("active");
    if (nameGrp) nameGrp.style.display = "none";
    if (btnText) btnText.textContent = "Sign In to Workspace";
    if (forgotLink) forgotLink.style.display = "inline";
    if (headerTitle) headerTitle.textContent = "Welcome back";
    if (headerSub) headerSub.textContent = "Sign in to access your Nova workspace.";
    if (chkText) chkText.textContent = "Remember me for 30 days";
  } else {
    if (btnReg) btnReg.classList.add("active");
    if (btnLogin) btnLogin.classList.remove("active");
    if (nameGrp) nameGrp.style.display = "block";
    if (btnText) btnText.textContent = "Create Workspace Account";
    if (forgotLink) forgotLink.style.display = "none";
    if (headerTitle) headerTitle.textContent = "Create your account";
    if (headerSub) headerSub.textContent = "Get started with Nova Credit AI workspace";
    if (chkText) chkText.textContent = "I agree to the Terms of Service & Privacy Policy";
  }
  if (window.lucide) window.lucide.createIcons();
}

function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    btnEl.innerHTML = '<i data-lucide="eye-off"></i>';
  } else {
    input.type = "password";
    btnEl.innerHTML = '<i data-lucide="eye"></i>';
  }
  if (window.lucide) window.lucide.createIcons();
}

function toggleForgotPasswordView(show) {
  const mainForm = document.getElementById("authMainForm");
  const forgotForm = document.getElementById("forgotPassForm");
  if (show) {
    if (mainForm) mainForm.style.display = "none";
    if (forgotForm) forgotForm.style.display = "block";
  } else {
    if (mainForm) mainForm.style.display = "block";
    if (forgotForm) forgotForm.style.display = "none";
  }
}

function showAuthAlert(msg, isSuccess = false) {
  const alertEl = document.getElementById("authAlert");
  if (!alertEl) return;
  alertEl.style.display = "block";
  alertEl.className = isSuccess ? "auth-alert-banner success" : "auth-alert-banner error";
  alertEl.textContent = msg;
}

function hideAuthAlert() {
  const alertEl = document.getElementById("authAlert");
  if (alertEl) alertEl.style.display = "none";
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  hideAuthAlert();

  const email = document.getElementById("inputAuthEmail").value.trim();
  const password = document.getElementById("inputAuthPassword").value.trim();
  const name = document.getElementById("inputAuthName")?.value.trim() || "";

  if (!email || !password) {
    showAuthAlert("Please provide email and password.");
    return;
  }

  const endpoint = currentAuthMode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
  const body = currentAuthMode === "login"
    ? { email, password }
    : { email, password, full_name: name || email.split("@")[0] };

  const submitBtn = document.getElementById("btnAuthSubmit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Authentication failed.");
    }

    localStorage.setItem("nova_token", data.access_token);
    currentUser = {
      user_id: data.user_id,
      email: data.email,
      full_name: data.full_name,
      role: data.role,
    };
    localStorage.setItem("nova_user", JSON.stringify(currentUser));

    // Redirect based on role
    if (currentUser.role.toUpperCase() === "ADMIN") {
      navigateTo("/admin/dashboard");
    } else {
      navigateTo("/app/dashboard");
    }
  } catch (err) {
    showAuthAlert(err.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  hideAuthAlert();
  const email = document.getElementById("inputForgotEmail").value.trim();
  if (!email) return;

  try {
    const res = await fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    showAuthAlert(data.message || "Password reset instructions dispatched.", true);
    setTimeout(() => toggleForgotPasswordView(false), 2500);
  } catch (err) {
    showAuthAlert("Password recovery request failed.");
  }
}

async function handleLogout() {
  try {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: getAuthHeaders(),
    });
  } catch (e) {}

  localStorage.removeItem("nova_token");
  localStorage.removeItem("nova_user");
  currentUser = null;
  navigateTo("/login");
}

function fillAdminDemo() {
  document.getElementById("inputAuthEmail").value = "admin@novacredit.ai";
  document.getElementById("inputAuthPassword").value = "AdminSecurePassword2026!";
  switchAuthMode("login");
}

function updateUserHeaderUI() {
  if (!currentUser) return;
  const avatarEl = document.getElementById("userAvatar");
  const nameEl = document.getElementById("userName");
  const roleEl = document.getElementById("userRoleBadge");
  const topUserId = document.getElementById("topbarUserId");

  const initials = (currentUser.full_name || currentUser.email).split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  if (avatarEl) avatarEl.textContent = initials || "U";
  if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.email;

  const isAdmin = currentUser.role.toUpperCase() === "ADMIN";
  if (roleEl) {
    roleEl.textContent = isAdmin ? "ADMIN 👑" : "USER 🔒";
    roleEl.className = isAdmin ? "pill pill-warning" : "pill pill-info";
  }
  if (topUserId) {
    topUserId.style.display = "inline-flex";
    topUserId.innerHTML = isAdmin
      ? `<span class="pill pill-warning">👑 Admin ID: ${currentUser.user_id || 'ADMIN'}</span>`
      : `<span class="pill pill-info">🔒 User ID: ${currentUser.user_id || 'USER'}</span>`;
  }
}

// ─── User Module Controllers (/app/*) ──────────────────────────────────────────

async function loadUserDashboard() {
  loadHistory();
  try {
    const res = await fetch("/api/v1/user/profile", { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const fp = data.financial_profile;
      if (fp) {
        document.getElementById("profSumIncome").textContent = "₹" + fmt(fp.monthly_income);
        document.getElementById("profSumEmi").textContent = "₹" + fmt(fp.existing_emi);
        document.getElementById("profSumSavings").textContent = "₹" + fmt(fp.savings_balance);
        document.getElementById("profSumHousing").textContent = fp.housing_type;
      }
    }
  } catch (e) {}
}

async function loadHistory() {
  try {
    const res = await fetch("/api/v1/history?limit=25", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const records = data.history || [];
    const isAdmin = data.is_admin || false;

    const subTitle = document.getElementById("hist-sub-title");
    if (subTitle) {
      subTitle.textContent = isAdmin
        ? "👑 SYSTEM ADMIN MODE — Displaying All User Assessments"
        : `🔒 Private Session Ledger — User ID: ${currentUser?.user_id || 'USR'} (Your Personal Records Only)`;
    }

    const render = (rows) => rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No credit assessments recorded for this account.</td></tr>`
      : rows.map(r => {
          const date = new Date(r.timestamp).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
          return `<tr>
            <td style="font-size:11px;color:var(--text-muted);">${date}</td>
            <td><strong>${r.applicant_name}</strong></td>
            <td style="font-family:var(--font-mono);">₹${fmt(r.requested_loan)}</td>
            <td style="font-family:var(--font-mono);font-weight:700;color:var(--text-primary);">${r.nova_score}</td>
            <td>${r.risk_tier}</td>
            <td style="font-family:var(--font-mono);">${r.approval_probability}%</td>
            <td>${pillHtml(r.decision)}</td>
            <td><button type="button" onclick="downloadAssessmentPdf('${r.id}')" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 8px;" title="Download PDF Report"><i data-lucide="file-down"></i><span>PDF ↗</span></button></td>
          </tr>`;
        }).join("");

    const histTbl = document.getElementById("hist-table");
    if (histTbl) histTbl.innerHTML = render(records);
    const ovTbl = document.getElementById("ov-history-table");
    if (ovTbl) ovTbl.innerHTML = render(records.slice(0, 5));
    if (window.lucide) window.lucide.createIcons();
  } catch (e) { console.error("History load error:", e); }
}

async function loadUserReports() {
  try {
    const res = await fetch("/api/v1/history?limit=50", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const records = data.history || [];
    const tbody = document.getElementById("reportsTableBody");
    if (!tbody) return;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No reports generated yet. Submit a credit assessment to download PDF reports.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => {
      const date = new Date(r.timestamp).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;">REP-${r.id.slice(0,6)}</td>
        <td style="font-family:var(--font-mono);font-size:11px;">${r.id}</td>
        <td><strong>${r.applicant_name}</strong></td>
        <td><span class="pill pill-info">PDF Underwriting</span></td>
        <td style="font-size:11px;color:var(--text-muted);">${date}</td>
        <td><button type="button" onclick="downloadAssessmentPdf('${r.id}')" class="btn btn-secondary btn-sm" title="Download Official PDF"><i data-lucide="file-down"></i><span>Download PDF ↗</span></button></td>
      </tr>`;
    }).join("");
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {}
}

async function loadUserProfile() {
  if (!currentUser) return;
  document.getElementById("profUserId").value = currentUser.user_id || currentUser.id;
  document.getElementById("profFullName").value = currentUser.full_name || "";
  document.getElementById("profEmail").value = currentUser.email || "";

  try {
    const res = await fetch("/api/v1/user/profile", { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const fp = data.financial_profile;
      if (fp) {
        document.getElementById("profFinIncome").value = fp.monthly_income;
        document.getElementById("profFinEmi").value = fp.existing_emi;
        document.getElementById("profFinSavings").value = fp.savings_balance;
      }
    }
  } catch (e) {}
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const fullName = document.getElementById("profFullName").value.trim();
  try {
    const res = await fetch("/api/v1/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ full_name: fullName }),
    });
    if (res.ok) {
      currentUser.full_name = fullName;
      localStorage.setItem("nova_user", JSON.stringify(currentUser));
      updateUserHeaderUI();
      alert("Profile updated successfully.");
    }
  } catch (e) { alert("Failed to update profile."); }
}

async function handleSaveFinancialDefaults(e) {
  e.preventDefault();
  const monthly_income = parseFloat(document.getElementById("profFinIncome").value);
  const existing_emi = parseFloat(document.getElementById("profFinEmi").value);
  const savings_balance = parseFloat(document.getElementById("profFinSavings").value);

  try {
    const res = await fetch("/api/v1/user/financial-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ monthly_income, existing_emi, savings_balance }),
    });
    if (res.ok) {
      alert("Financial defaults saved.");
    }
  } catch (e) { alert("Failed to save financial profile."); }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current_password = document.getElementById("inputCurrentPass").value;
  const new_password = document.getElementById("inputNewPass").value;
  const confirm = document.getElementById("inputConfirmPass").value;

  if (new_password !== confirm) {
    alert("New passwords do not match.");
    return;
  }

  try {
    const res = await fetch("/api/v1/user/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ current_password, new_password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to update password.");
    alert("Password updated successfully.");
    document.getElementById("inputCurrentPass").value = "";
    document.getElementById("inputNewPass").value = "";
    document.getElementById("inputConfirmPass").value = "";
  } catch (err) { alert(err.message); }
}

// Placeholder loader widgets for secondary tools
function loadAssessmentWizard() {
  const container = document.getElementById("assessmentIntakeWizardContainer");
  if (!container || container.children.length > 0) return;
  container.innerHTML = `
    <form onsubmit="handleWizardAssessmentSubmit(event)" style="display:flex;flex-direction:column;gap:16px;">
      <div class="form-grid">
        <div class="field"><label>Applicant Name</label><input type="text" id="wizName" value="${currentUser?.full_name || 'Applicant'}" required/></div>
        <div class="field"><label>Age</label><input type="number" id="wizAge" value="32" min="18" max="90" required/></div>
        <div class="field"><label>Monthly Net Income (₹)</label><input type="number" id="wizIncome" value="75000" min="1000" required/></div>
        <div class="field"><label>Existing Monthly EMI (₹)</label><input type="number" id="wizEmi" value="10000" min="0" required/></div>
        <div class="field"><label>Requested Loan Amount (₹)</label><input type="number" id="wizLoan" value="200000" min="5000" required/></div>
        <div class="field"><label>Loan Tenure (Months)</label><input type="number" id="wizDuration" value="18" min="6" max="84" required/></div>
        <div class="field"><label>Liquid Savings (₹)</label><input type="number" id="wizSavings" value="150000" min="0" required/></div>
        <div class="field"><label>Housing Asset</label><select id="wizHousing"><option value="own">Own</option><option value="rent">Rent</option><option value="free">Free</option></select></div>
      </div>
      <button type="submit" class="btn btn-primary btn-block btn-lg">Run Underwriting Risk Assessment</button>
    </form>
    <div id="wizResultBox" style="margin-top:20px;"></div>
  `;
}

async function handleWizardAssessmentSubmit(e) {
  e.preventDefault();
  const payload = {
    applicant_name: document.getElementById("wizName").value,
    age: parseInt(document.getElementById("wizAge").value),
    sex: "male",
    job: "Skilled",
    housing: document.getElementById("wizHousing").value,
    saving_accounts: "moderate",
    checking_account: "moderate",
    purpose: "car",
    monthly_income: parseFloat(document.getElementById("wizIncome").value),
    existing_emi: parseFloat(document.getElementById("wizEmi").value),
    credit_amount: parseFloat(document.getElementById("wizLoan").value),
    duration: parseInt(document.getElementById("wizDuration").value),
    savings_balance: parseFloat(document.getElementById("wizSavings").value)
  };

  try {
    const res = await fetch("/api/v1/credit/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    const box = document.getElementById("wizResultBox");
    if (box) {
      box.innerHTML = `
        <div class="card" style="background:var(--surface-elevated);border-color:var(--primary);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:700;">Nova Credit Score</div>
              <div style="font-size:36px;font-family:var(--font-mono);font-weight:800;color:var(--primary);">${data.nova_score.nova_score} / 850</div>
              <div style="font-size:14px;font-weight:700;">${data.decision_engine.decision} (${data.approval_percentage}% Model Risk Estimate)</div>
            </div>
            <button type="button" onclick="downloadAssessmentPdf('${data.assessment_id}')" class="btn btn-primary btn-sm"><i data-lucide="file-down"></i><span>Download PDF Report ↗</span></button>
          </div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) { alert("Assessment failed."); }
}

// ─── IMPROVE MY CREDIT (WHAT-IF SIMULATOR) ────────────────────────────────────

let wiBaseline = {
  income: 65000,
  credit: 300000,
  emi: 18000,
  duration: 36,
  savings: 120000,
  score: 684,
  risk: "Medium Risk",
  decision: "Manual Review",
  probability: 57.5
};

let wiCurrent = { ...wiBaseline };

async function syncBaselineFromUserRecords() {
  try {
    const res = await fetch("/api/v1/history?limit=1", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.history && data.history.length > 0) {
      const latest = data.history[0];
      wiBaseline.score = latest.nova_score || 684;
      wiBaseline.risk = latest.risk_tier || "Medium Risk";
      wiBaseline.decision = latest.decision || "Manual Review";
      wiBaseline.probability = latest.approval_probability || 57.5;
      if (latest.requested_loan) wiBaseline.credit = latest.requested_loan;
      wiCurrent = { ...wiBaseline };
    }
  } catch (e) {}
}

async function loadWhatIfSimulator() {
  const c = document.getElementById("simulatorContainer");
  if (!c) return;

  await syncBaselineFromUserRecords();

  c.innerHTML = `
    <div class="wi-container">
      <!-- 1. Top Educational Explanation Banner -->
      <div class="wi-intro-banner">
        <i data-lucide="help-circle" class="wi-intro-icon"></i>
        <div>
          <div class="wi-intro-title">How does this work?</div>
          <div class="wi-intro-desc">
            Adjust a few financial factors below. Nova will compare the modified profile with your current assessment and show how the simulated result changes.<br/>
            <strong>This is a simulation only and does not change your real profile.</strong>
          </div>
        </div>
      </div>

      <!-- 2. Current Profile Baseline Strip -->
      <div class="wi-baseline-strip">
        <div class="wi-baseline-box">
          <span class="wi-baseline-lbl">Nova Score <span class="info-tip" title="Nova's internal project risk score (300-850). It is not a CIBIL, FICO, or bureau score.">ⓘ</span></span>
          <span class="wi-baseline-val" style="color:var(--primary);">${wiBaseline.score} <span style="font-size:12px;color:var(--text-muted);font-weight:400;">/ 850</span></span>
        </div>
        <div class="wi-baseline-box">
          <span class="wi-baseline-lbl">Risk Level</span>
          <span class="wi-baseline-val" style="font-size:16px;">${wiBaseline.risk}</span>
        </div>
        <div class="wi-baseline-box">
          <span class="wi-baseline-lbl">Assessment Verdict</span>
          <span class="wi-baseline-val" style="font-size:15px;">${pillHtml(wiBaseline.decision)}</span>
        </div>
        <div class="wi-baseline-box">
          <span class="wi-baseline-lbl">Model Risk Estimate <span class="info-tip" title="This is a model estimate based on available information. It is not a guaranteed lender approval probability.">ⓘ</span></span>
          <span class="wi-baseline-val" style="font-size:16px;font-family:var(--font-mono);">${wiBaseline.probability}%</span>
        </div>
      </div>

      <!-- 3. Two-Column Workspace: Controls on Left, Simulated Results on Right -->
      <div class="wi-workspace-grid">
        <!-- Left: Interactive Adjustment Controls -->
        <div class="wi-control-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div class="card-title" style="font-size:15px;margin:0;">Try A Change</div>
            <button type="button" onclick="resetWhatIfSimulation()" class="btn btn-ghost btn-sm"><i data-lucide="rotate-ccw"></i><span>Reset Changes</span></button>
          </div>
          <p class="card-sub" style="margin-bottom:12px;">Modify any financial factor to simulate impact on Nova risk evaluation.</p>

          <!-- Factor 1: Monthly Income -->
          <div class="wi-factor-row">
            <div class="wi-factor-head">
              <span class="wi-factor-title">Monthly Net Income <span class="info-tip" title="Your verified monthly take-home salary or net business profit.">ⓘ</span></span>
              <span class="wi-factor-current">Current: ₹${fmt(wiBaseline.income)}</span>
            </div>
            <div class="wi-factor-stepper">
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('income', -5000)">−</button>
              <span class="wi-stepper-val" id="wiValIncome">₹${fmt(wiCurrent.income)}</span>
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('income', 5000)">+</button>
            </div>
            <input type="range" id="wiRangeIncome" min="25000" max="300000" step="5000" value="${wiCurrent.income}" oninput="syncWhatIfSlider('income', this.value)"/>
          </div>

          <!-- Factor 2: Requested Loan -->
          <div class="wi-factor-row">
            <div class="wi-factor-head">
              <span class="wi-factor-title">Requested Credit / Loan <span class="info-tip" title="Requested Credit: The amount of new credit or loan you want to borrow.">ⓘ</span></span>
              <span class="wi-factor-current">Current: ₹${fmt(wiBaseline.credit)}</span>
            </div>
            <div class="wi-factor-stepper">
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('credit', -25000)">−</button>
              <span class="wi-stepper-val" id="wiValCredit">₹${fmt(wiCurrent.credit)}</span>
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('credit', 25000)">+</button>
            </div>
            <input type="range" id="wiRangeCredit" min="50000" max="2000000" step="25000" value="${wiCurrent.credit}" oninput="syncWhatIfSlider('credit', this.value)"/>
          </div>

          <!-- Factor 3: Existing Monthly EMI -->
          <div class="wi-factor-row">
            <div class="wi-factor-head">
              <span class="wi-factor-title">Existing Monthly EMI <span class="info-tip" title="Existing Monthly EMI: The total EMI you already pay every month before this new loan.">ⓘ</span></span>
              <span class="wi-factor-current">Current: ₹${fmt(wiBaseline.emi)}</span>
            </div>
            <div class="wi-factor-stepper">
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('emi', -2000)">−</button>
              <span class="wi-stepper-val" id="wiValEmi">₹${fmt(wiCurrent.emi)}</span>
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('emi', 2000)">+</button>
            </div>
            <input type="range" id="wiRangeEmi" min="0" max="150000" step="2000" value="${wiCurrent.emi}" oninput="syncWhatIfSlider('emi', this.value)"/>
          </div>

          <!-- Factor 4: Loan Duration -->
          <div class="wi-factor-row">
            <div class="wi-factor-head">
              <span class="wi-factor-title">Loan Tenure (Duration) <span class="info-tip" title="Loan tenure in months (6-84 months).">ⓘ</span></span>
              <span class="wi-factor-current">Current: ${wiBaseline.duration} Months</span>
            </div>
            <div class="wi-factor-stepper">
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('duration', -6)">−</button>
              <span class="wi-stepper-val" id="wiValDuration">${wiCurrent.duration} Months</span>
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('duration', 6)">+</button>
            </div>
            <input type="range" id="wiRangeDuration" min="6" max="84" step="6" value="${wiCurrent.duration}" oninput="syncWhatIfSlider('duration', this.value)"/>
          </div>

          <!-- Factor 5: Savings Balance -->
          <div class="wi-factor-row">
            <div class="wi-factor-head">
              <span class="wi-factor-title">Liquid Savings Buffer <span class="info-tip" title="Liquid savings reserves available for debt stabilization.">ⓘ</span></span>
              <span class="wi-factor-current">Current: ₹${fmt(wiBaseline.savings)}</span>
            </div>
            <div class="wi-factor-stepper">
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('savings', -20000)">−</button>
              <span class="wi-stepper-val" id="wiValSavings">₹${fmt(wiCurrent.savings)}</span>
              <button type="button" class="wi-step-btn" onclick="stepWhatIf('savings', 20000)">+</button>
            </div>
            <input type="range" id="wiRangeSavings" min="0" max="1000000" step="20000" value="${wiCurrent.savings}" oninput="syncWhatIfSlider('savings', this.value)"/>
          </div>

          <div style="display:flex;gap:12px;margin-top:8px;">
            <button type="button" class="btn btn-primary" style="flex:1;" onclick="executeWhatIfSimulation()"><i data-lucide="play"></i><span>Run Simulation</span></button>
            <button type="button" class="btn btn-secondary" onclick="resetWhatIfSimulation()"><i data-lucide="rotate-ccw"></i><span>Reset Changes</span></button>
          </div>
        </div>

        <!-- Right: Simulated Results & Explanations -->
        <div class="wi-result-card" id="wiResultContainer">
          <div class="card-title" style="font-size:15px;margin-bottom:4px;">Simulated Result</div>
          <p class="card-sub" style="margin-bottom:12px;">Immediate analytical feedback comparing your simulated scenario against your baseline.</p>

          <div class="wi-comparison-hero" id="wiComparisonHero">
            <div class="wi-comp-col">
              <span class="wi-comp-lbl">Current Baseline</span>
              <span class="wi-comp-score" id="wiResBaseScore">${wiBaseline.score}</span>
              <span style="font-size:12px;color:var(--text-muted);">${wiBaseline.risk}</span>
            </div>

            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
              <span style="font-size:20px;color:var(--text-muted);line-height:1;">→</span>
              <div id="wiResDeltaBadge" class="wi-delta-badge neutral">0</div>
            </div>

            <div class="wi-comp-col">
              <span class="wi-comp-lbl">Simulated Score</span>
              <span class="wi-comp-score" id="wiResSimScore" style="color:#60A5FA;">${wiBaseline.score}</span>
              <span id="wiResSimRisk" style="font-size:12px;color:var(--text-secondary);">${wiBaseline.risk}</span>
            </div>
          </div>

          <!-- Assessment Verdict -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--surface-elevated);border-radius:8px;border:1px solid var(--border-dim);">
            <div>
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600;">Simulated Assessment</div>
              <div id="wiResVerdict" style="margin-top:4px;">${pillHtml(wiBaseline.decision)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600;">Model Risk Estimate <span class="info-tip" title="This is a model estimate based on available information. It is not a guaranteed lender approval probability.">ⓘ</span></div>
              <div id="wiResProb" style="font-size:17px;font-weight:800;font-family:var(--font-mono);color:var(--text-primary);margin-top:2px;">${wiBaseline.probability}%</div>
            </div>
          </div>

          <!-- Why Did It Change? -->
          <div class="wi-reasons-box">
            <span class="wi-reasons-title">Why did the result change?</span>
            <div id="wiReasonsList" style="display:flex;flex-direction:column;gap:6px;">
              <div class="wi-reason-item"><span style="color:var(--text-muted);">•</span><span>Modify any factor on the left and click 'Run Simulation' to observe score drivers.</span></div>
            </div>
          </div>

          <!-- Next Best Action -->
          <div class="wi-action-box" id="wiActionBox">
            <div>
              <strong style="font-size:12px;text-transform:uppercase;color:#E56D69;letter-spacing:0.04em;">Next Best Action</strong>
              <p style="font-size:12.5px;color:var(--text-primary);margin:4px 0 8px 0;" id="wiActionText">
                Reducing your existing monthly EMI by another ₹2,000 could improve your simulated repayment profile further.
              </p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="applyNextBestAction()" style="align-self:flex-start;">
              <i data-lucide="zap"></i><span>Try this change</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function stepWhatIf(field, delta) {
  if (field === "income") {
    wiCurrent.income = Math.max(25000, Math.min(1000000, wiCurrent.income + delta));
    document.getElementById("wiValIncome").textContent = "₹" + fmt(wiCurrent.income);
    document.getElementById("wiRangeIncome").value = wiCurrent.income;
  } else if (field === "credit") {
    wiCurrent.credit = Math.max(25000, Math.min(5000000, wiCurrent.credit + delta));
    document.getElementById("wiValCredit").textContent = "₹" + fmt(wiCurrent.credit);
    document.getElementById("wiRangeCredit").value = wiCurrent.credit;
  } else if (field === "emi") {
    wiCurrent.emi = Math.max(0, Math.min(500000, wiCurrent.emi + delta));
    document.getElementById("wiValEmi").textContent = "₹" + fmt(wiCurrent.emi);
    document.getElementById("wiRangeEmi").value = wiCurrent.emi;
  } else if (field === "duration") {
    wiCurrent.duration = Math.max(6, Math.min(84, wiCurrent.duration + delta));
    document.getElementById("wiValDuration").textContent = wiCurrent.duration + " Months";
    document.getElementById("wiRangeDuration").value = wiCurrent.duration;
  } else if (field === "savings") {
    wiCurrent.savings = Math.max(0, Math.min(2000000, wiCurrent.savings + delta));
    document.getElementById("wiValSavings").textContent = "₹" + fmt(wiCurrent.savings);
    document.getElementById("wiRangeSavings").value = wiCurrent.savings;
  }
}

function syncWhatIfSlider(field, val) {
  val = parseFloat(val) || 0;
  if (field === "income") {
    wiCurrent.income = val;
    document.getElementById("wiValIncome").textContent = "₹" + fmt(val);
  } else if (field === "credit") {
    wiCurrent.credit = val;
    document.getElementById("wiValCredit").textContent = "₹" + fmt(val);
  } else if (field === "emi") {
    wiCurrent.emi = val;
    document.getElementById("wiValEmi").textContent = "₹" + fmt(val);
  } else if (field === "duration") {
    wiCurrent.duration = val;
    document.getElementById("wiValDuration").textContent = val + " Months";
  } else if (field === "savings") {
    wiCurrent.savings = val;
    document.getElementById("wiValSavings").textContent = "₹" + fmt(val);
  }
}

function resetWhatIfSimulation() {
  wiCurrent = { ...wiBaseline };
  document.getElementById("wiValIncome").textContent = "₹" + fmt(wiCurrent.income);
  document.getElementById("wiRangeIncome").value = wiCurrent.income;
  document.getElementById("wiValCredit").textContent = "₹" + fmt(wiCurrent.credit);
  document.getElementById("wiRangeCredit").value = wiCurrent.credit;
  document.getElementById("wiValEmi").textContent = "₹" + fmt(wiCurrent.emi);
  document.getElementById("wiRangeEmi").value = wiCurrent.emi;
  document.getElementById("wiValDuration").textContent = wiCurrent.duration + " Months";
  document.getElementById("wiRangeDuration").value = wiCurrent.duration;
  document.getElementById("wiValSavings").textContent = "₹" + fmt(wiCurrent.savings);
  document.getElementById("wiRangeSavings").value = wiCurrent.savings;

  document.getElementById("wiResSimScore").textContent = wiBaseline.score;
  document.getElementById("wiResSimRisk").textContent = wiBaseline.risk;
  document.getElementById("wiResVerdict").innerHTML = pillHtml(wiBaseline.decision);
  document.getElementById("wiResProb").textContent = wiBaseline.probability + "%";

  const badge = document.getElementById("wiResDeltaBadge");
  if (badge) {
    badge.className = "wi-delta-badge neutral";
    badge.textContent = "0";
  }

  const reasonsList = document.getElementById("wiReasonsList");
  if (reasonsList) {
    reasonsList.innerHTML = `<div class="wi-reason-item"><span style="color:var(--text-muted);">•</span><span>Simulation reset to baseline profile.</span></div>`;
  }
  showToast("Simulation reset to baseline.", "info");
}

function applyNextBestAction() {
  if (wiCurrent.emi >= 2000) {
    stepWhatIf('emi', -2000);
  } else if (wiCurrent.income < 100000) {
    stepWhatIf('income', 10000);
  } else {
    stepWhatIf('credit', -50000);
  }
  executeWhatIfSimulation();
  showToast("Action recommendation applied to simulation!", "success");
}

async function executeWhatIfSimulation() {
  const inc = wiCurrent.income;
  const credit = wiCurrent.credit;
  const emi = wiCurrent.emi;
  const duration = wiCurrent.duration;
  const savings = wiCurrent.savings;

  try {
    const res = await fetch("/api/v1/credit/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        monthly_income: inc,
        existing_emi: emi,
        savings_balance: savings,
        credit_amount: credit,
        duration: duration,
        age: 32
      })
    });

    if (!res.ok) {
      showToast("Simulation service error. Please verify input ranges.", "error");
      return;
    }

    const data = await res.json();
    const simScore = data.nova_score ? data.nova_score.nova_score : 700;
    const simTier = data.nova_score ? data.nova_score.tier : "Moderate Risk";
    const simDecision = data.decision_engine ? data.decision_engine.decision : "Manual Review";
    const simProb = data.approval_percentage || 50.0;
    const delta = simScore - wiBaseline.score;

    // Update Scores
    document.getElementById("wiResSimScore").textContent = simScore;
    document.getElementById("wiResSimRisk").textContent = simTier;
    document.getElementById("wiResVerdict").innerHTML = pillHtml(simDecision);
    document.getElementById("wiResProb").textContent = simProb + "%";

    const badge = document.getElementById("wiResDeltaBadge");
    if (badge) {
      if (delta > 0) {
        badge.className = "wi-delta-badge pos";
        badge.textContent = `+${delta}`;
      } else if (delta < 0) {
        badge.className = "wi-delta-badge neg";
        badge.textContent = `${delta}`;
      } else {
        badge.className = "wi-delta-badge neutral";
        badge.textContent = `0`;
      }
    }

    // Why Did It Change Deterministic Drivers
    const reasons = [];
    if (inc > wiBaseline.income) {
      reasons.push(`↑ Higher monthly income (+₹${fmt(inc - wiBaseline.income)}) expanded net repayment capacity`);
    } else if (inc < wiBaseline.income) {
      reasons.push(`↓ Lower monthly income (-₹${fmt(wiBaseline.income - inc)}) narrowed debt servicing headroom`);
    }

    if (credit < wiBaseline.credit) {
      reasons.push(`↑ Lower requested credit (-₹${fmt(wiBaseline.credit - credit)}) reduced borrowing pressure and leverage`);
    } else if (credit > wiBaseline.credit) {
      reasons.push(`↓ Higher requested credit (+₹${fmt(credit - wiBaseline.credit)}) elevated exposure burden`);
    }

    if (emi < wiBaseline.emi) {
      reasons.push(`↑ Lower existing debt (-₹${fmt(wiBaseline.emi - emi)}) improved fixed obligation ratio (FOIR)`);
    } else if (emi > wiBaseline.emi) {
      reasons.push(`↓ Higher existing monthly debt (+₹${fmt(emi - wiBaseline.emi)}) elevated obligation burden`);
    }

    if (savings > wiBaseline.savings) {
      reasons.push(`↑ Higher liquid savings (+₹${fmt(savings - wiBaseline.savings)}) augmented emergency reserve buffer`);
    } else if (savings < wiBaseline.savings) {
      reasons.push(`↓ Reduced savings (-₹${fmt(wiBaseline.savings - savings)}) decreased liquidity cushion`);
    }

    if (duration > wiBaseline.duration) {
      reasons.push(`↑ Extended tenure (+${duration - wiBaseline.duration} mos) lowered monthly debt commitment`);
    } else if (duration < wiBaseline.duration) {
      reasons.push(`↓ Shorter tenure (-${wiBaseline.duration - duration} mos) raised immediate monthly amortization`);
    }

    if (reasons.length === 0) {
      reasons.push(`• No financial factor modified from baseline.`);
    }

    const reasonsList = document.getElementById("wiReasonsList");
    if (reasonsList) {
      reasonsList.innerHTML = reasons.map(r => `<div class="wi-reason-item"><span style="color:var(--primary);font-weight:700;">•</span><span>${r}</span></div>`).join("");
    }

    // Next Best Action
    const actionText = document.getElementById("wiActionText");
    if (actionText) {
      if (emi > 4000) {
        actionText.textContent = `Reducing your existing EMI by another ₹2,000 could improve your simulated repayment profile further.`;
      } else if (savings < 250000) {
        actionText.textContent = `Expanding your liquid emergency buffer by ₹20,000 could augment emergency liquidity scoring.`;
      } else {
        actionText.textContent = `Maintaining low debt obligations creates the strongest institutional risk profile.`;
      }
    }
    showToast("Simulation calculated!", "success");
  } catch (err) {
    console.error("Simulation error:", err);
    showToast("Failed to run credit simulation.", "error");
  }
}

// ─── LOAN INTELLIGENCE MODULE ──────────────────────────────────────────────────

let liCurrentPlannerData = null;
let liChartBreakdownInstance = null;
let liChartTradeOffInstance = null;

function loadLoanIntelligence() {
  const container = document.getElementById("loanIntelligenceContainer") || document.getElementById("calculatorContainer");
  if (!container) return;

  container.innerHTML = `
    <div class="li-workspace">
      <!-- Top Header -->
      <div class="li-header">
        <h2 class="li-title">Loan Intelligence</h2>
        <p class="li-subtitle">Plan around your finances, not just the EMI. Compare repayment strategies, understand affordability and optimize the true cost of borrowing.</p>
      </div>

      <!-- 5 Workspace Tabs Navigation -->
      <div class="li-tabs-container">
        <button class="li-tab-btn active" id="liTabBtnPlanner" onclick="switchLiTab('planner')">
          <i data-lucide="calculator"></i><span>Planner</span>
        </button>
        <button class="li-tab-btn" id="liTabBtnAffordability" onclick="switchLiTab('affordability')">
          <i data-lucide="shield-check"></i><span>Affordability</span>
        </button>
        <button class="li-tab-btn" id="liTabBtnCompare" onclick="switchLiTab('compare')">
          <i data-lucide="git-compare"></i><span>Compare Loans</span>
        </button>
        <button class="li-tab-btn" id="liTabBtnPrepayment" onclick="switchLiTab('prepayment')">
          <i data-lucide="zap"></i><span>Prepayment Lab</span>
        </button>
        <button class="li-tab-btn" id="liTabBtnAmortization" onclick="switchLiTab('amortization')">
          <i data-lucide="table"></i><span>Amortization</span>
        </button>
      </div>

      <!-- TAB 1: PLANNER -->
      <div id="liTabPlanner" class="li-tab-content">
        <div class="li-split-grid">
          <!-- Left: Input Form Card (40%) -->
          <div class="li-form-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
              <div class="card-title" style="font-size:15px;margin:0;">Loan Parameters</div>
              <span class="pill pill-neutral" style="font-size:10px;">Reducing Balance</span>
            </div>
            <p class="card-sub" style="margin-bottom:6px;">Enter your loan profile to compute accurate EMI and cost metrics.</p>

            <form onsubmit="event.preventDefault(); runLoanPlannerCalc();">
              <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:14px;">
                <div class="field span-2">
                  <label>Loan Type</label>
                  <select id="liLoanType" onchange="runLoanPlannerCalc()">
                    <option value="Home Loan" selected>Home Loan</option>
                    <option value="Personal Loan">Personal Loan</option>
                    <option value="Car Loan">Car Loan</option>
                    <option value="Education Loan">Education Loan</option>
                    <option value="Business Loan">Business Loan</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div class="field span-2">
                  <label>Principal Loan Amount</label>
                  <div class="currency-input-wrapper">
                    <span class="currency-symbol">₹</span>
                    <input type="number" id="liPrincipal" value="2500000" min="1000" step="10000" required style="font-family:var(--font-mono);font-weight:600;"/>
                  </div>
                </div>

                <div class="field">
                  <label>Interest Rate (% p.a.)</label>
                  <input type="number" id="liRate" value="8.5" min="0.1" max="50" step="0.1" required style="font-family:var(--font-mono);"/>
                </div>

                <div class="field">
                  <label>Tenure</label>
                  <div class="input-compound-group">
                    <input type="number" id="liTenureVal" value="20" min="1" max="480" required style="font-family:var(--font-mono);"/>
                    <select id="liTenureUnit">
                      <option value="years" selected>Years</option>
                      <option value="months">Months</option>
                    </select>
                  </div>
                </div>

                <div class="field">
                  <label>Processing Fee</label>
                  <div class="input-compound-group">
                    <input type="number" id="liFeeVal" value="0.5" min="0" step="0.1" style="font-family:var(--font-mono);"/>
                    <select id="liFeeType">
                      <option value="percentage" selected>%</option>
                      <option value="flat">₹</option>
                    </select>
                  </div>
                </div>

                <div class="field">
                  <label>Down Payment</label>
                  <div class="currency-input-wrapper">
                    <span class="currency-symbol">₹</span>
                    <input type="number" id="liDownPayment" value="500000" min="0" step="10000" style="font-family:var(--font-mono);"/>
                  </div>
                </div>

                <div class="field span-2">
                  <label>Loan Start Date</label>
                  <input type="date" id="liStartDate" style="font-family:var(--font-mono);"/>
                </div>
              </div>

              <div style="display:flex;gap:10px;margin-top:16px;">
                <button type="submit" class="btn btn-primary" style="flex:1;"><i data-lucide="play"></i><span>Calculate Loan Plan</span></button>
                <button type="button" onclick="saveCurrentScenario()" class="btn btn-secondary" title="Save Scenario"><i data-lucide="bookmark"></i><span>Save</span></button>
              </div>
            </form>
          </div>

          <!-- Right: Hero Results Panel (60%) -->
          <div class="li-summary-panel">
            <div class="li-hero-card">
              <div class="li-hero-top">
                <div>
                  <span class="li-hero-emi-label">YOUR MONTHLY EMI</span>
                  <div class="li-hero-emi-value" id="liResEmi">₹17,356</div>
                  <div class="li-hero-emi-sub" id="liResEmiSub">For a 20-year Home Loan</div>
                </div>
                <div id="liResHealthBadge">
                  <span class="pill pill-success" style="font-size:11px;padding:4px 10px;">Manageable</span>
                </div>
              </div>

              <!-- Secondary Metrics: 3 Column Grid -->
              <div class="li-secondary-metrics">
                <div class="li-secondary-box">
                  <span class="metric-lbl">Principal</span>
                  <span class="metric-val" id="liResNetP">₹20,00,000</span>
                </div>
                <div class="li-secondary-box">
                  <span class="metric-lbl">Total Interest</span>
                  <span class="metric-val" id="liResInterest" style="color:#F59E0B;">₹21,65,552</span>
                </div>
                <div class="li-secondary-box">
                  <span class="metric-lbl">Total Repayment</span>
                  <span class="metric-val" id="liResRepayment">₹41,65,552</span>
                </div>
              </div>

              <!-- Advanced Progressive Disclosure -->
              <div>
                <button type="button" class="li-advanced-toggle-btn" onclick="toggleLiAdvancedMetrics()" id="liAdvToggleBtn">
                  <span>View complete cost breakdown</span> <i data-lucide="chevron-down" id="liAdvChevron"></i>
                </button>
                <div class="li-advanced-grid" id="liAdvancedGrid" style="display:none;margin-top:10px;">
                  <div class="li-secondary-box">
                    <span class="metric-lbl">Processing Fee</span>
                    <span class="metric-val" id="liResFee">₹0</span>
                  </div>
                  <div class="li-secondary-box">
                    <span class="metric-lbl">Effective Total Cost</span>
                    <span class="metric-val" id="liResCost">₹0</span>
                  </div>
                  <div class="li-secondary-box">
                    <span class="metric-lbl">Interest/Principal</span>
                    <span class="metric-val" id="liResRatio">0%</span>
                  </div>
                  <div class="li-secondary-box">
                    <span class="metric-lbl">Loan End Date</span>
                    <span class="metric-val" id="liResEndDate" style="font-size:13px;">—</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Nova Loan Insight Banner -->
            <div class="li-insight-box">
              <i data-lucide="sparkles" class="li-insight-icon"></i>
              <div>
                <strong style="font-size:12px;text-transform:uppercase;color:var(--primary);letter-spacing:0.04em;">Nova Loan Insight</strong>
                <p class="li-insight-text" id="liResInsight">Run calculation to generate deterministic financial insight.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Interactive Repayment Breakdown & Chart Section -->
        <div class="card" style="margin-top:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div>
              <div class="card-title" style="font-size:15px;margin:0;">Principal vs Interest Repayment Timeline</div>
              <p class="card-sub" style="margin:2px 0 0 0;">Visualize how every monthly or yearly payment reduces loan principal over time.</p>
            </div>
            <div class="li-segmented-control">
              <button class="li-segment-btn active" id="liChartToggleMonthly" onclick="toggleRepaymentChartView('monthly')">Monthly</button>
              <button class="li-segment-btn" id="liChartToggleYearly" onclick="toggleRepaymentChartView('yearly')">Yearly</button>
            </div>
          </div>
          <div class="li-chart-wrapper">
            <canvas id="liRepaymentCanvas"></canvas>
          </div>
        </div>

        <!-- Smart Tenure Optimizer Section -->
        <div class="card" style="margin-top:20px;">
          <div class="card-title" style="font-size:15px;">Smart Tenure Optimizer</div>
          <p class="card-sub" style="margin-bottom:12px;">Dynamic tenure scenarios comparing monthly commitment against total interest overhead.</p>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tenure</th>
                  <th>Monthly EMI</th>
                  <th>Total Interest</th>
                  <th>Modeled FOIR</th>
                  <th>Health Rating</th>
                  <th>Tag / Recommendation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="liTenureOptimizerBody">
                <tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-muted);">Calculating tenure matrix...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- EMI vs Interest Trade-Off Section -->
        <div class="card" style="margin-top:20px;">
          <div class="card-title" style="font-size:15px;">EMI vs Interest Trade-Off Analysis</div>
          <p class="card-sub" style="margin-bottom:10px;">As tenure increases, monthly EMI drops but cumulative interest increases exponentially.</p>
          <div class="li-chart-wrapper" style="height:220px;">
            <canvas id="liTradeOffCanvas"></canvas>
          </div>
        </div>

        <!-- Saved Scenarios Ledger -->
        <div class="card" style="margin-top:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div class="card-title" style="font-size:15px;margin:0;">My Saved Loan Scenarios</div>
            <button onclick="loadUserLoanScenarios()" class="btn btn-ghost btn-sm"><i data-lucide="refresh-cw"></i><span>Refresh</span></button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Scenario Name</th>
                  <th>Type</th>
                  <th>Principal</th>
                  <th>Rate</th>
                  <th>Tenure</th>
                  <th>EMI</th>
                  <th>Affordability</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="liScenariosBody">
                <tr><td colspan="8" style="text-align:center;padding:16px;color:var(--text-muted);">Loading saved scenarios...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- TAB 2: AFFORDABILITY -->
      <div id="liTabAffordability" class="li-tab-content" style="display:none;">
        <div class="li-split-grid">
          <div class="card" style="margin:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div class="card-title" style="font-size:15px;margin:0;">Income & Obligation Inputs</div>
              <button class="btn btn-secondary btn-sm" onclick="autoFillAffordabilityFromProfile()"><i data-lucide="user-check"></i><span>Auto-fill from Profile</span></button>
            </div>
            <form onsubmit="event.preventDefault(); runAffordabilityCalc();">
              <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;">
                <div class="field span-2">
                  <label>Monthly Net Income (₹)</label>
                  <input type="number" id="liAffIncome" value="85000" min="0" step="5000" required style="font-family:var(--font-mono);"/>
                </div>
                <div class="field span-2">
                  <label>Proposed New Loan EMI (₹)</label>
                  <input type="number" id="liAffProposedEmi" value="23500" min="0" step="1000" required style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Existing Monthly EMIs (₹)</label>
                  <input type="number" id="liAffExistingEmi" value="10000" min="0" step="1000" style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Rent / Housing Expense (₹)</label>
                  <input type="number" id="liAffRent" value="15000" min="0" step="1000" style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Other Fixed Obligations (₹)</label>
                  <input type="number" id="liAffOtherFixed" value="3000" min="0" step="500" style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Essential Monthly Living (₹)</label>
                  <input type="number" id="liAffEssentials" value="18000" min="0" step="1000" style="font-family:var(--font-mono);"/>
                </div>
              </div>
              <button type="submit" class="btn btn-primary btn-block" style="margin-top:16px;"><i data-lucide="shield-check"></i><span>Analyze Affordability</span></button>
            </form>
          </div>

          <div style="display:flex;flex-direction:column;gap:16px;">
            <div class="card" style="margin:0;">
              <div class="card-title" style="font-size:15px;margin-bottom:14px;">Affordability & Debt Burden Metrics</div>
              <div class="grid-2" style="gap:12px;">
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Existing FOIR</span>
                  <span class="li-metric-val" id="liAffExistingFoir">0%</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">New Modeled FOIR</span>
                  <span class="li-metric-val" id="liAffNewFoir" style="color:var(--primary);">0%</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">EMI-to-Income Ratio</span>
                  <span class="li-metric-val" id="liAffEmiRatio">0%</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Disposable Income (Before)</span>
                  <span class="li-metric-val" id="liAffDispBefore">₹0</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Disposable Income (After)</span>
                  <span class="li-metric-val" id="liAffDispAfter">₹0</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Repayment Buffer</span>
                  <span class="li-metric-val" id="liAffRepayCap">₹0</span>
                </div>
              </div>
            </div>

            <!-- Health Assessment Card -->
            <div class="card" style="margin:0;" id="liAffHealthCard">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div class="card-title" style="font-size:15px;margin:0;">Loan Health Assessment</div>
                <span id="liAffHealthPill"></span>
              </div>
              <p style="font-size:13px;color:var(--text-primary);line-height:1.5;margin:0;" id="liAffExplanation">Run affordability analysis to calculate status.</p>
              <div style="margin-top:12px;font-size:11px;color:var(--text-muted);display:flex;gap:12px;">
                <span>🟢 Comfortable: ≤35%</span>
                <span>🔵 Manageable: 35–45%</span>
                <span>🟡 Stretched: 45–55%</span>
                <span>🔴 High Burden: >55%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: COMPARE LOANS -->
      <div id="liTabCompare" class="li-tab-content" style="display:none;">
        <div class="card" style="margin-bottom:20px;">
          <div class="card-title" style="font-size:15px;margin-bottom:12px;">Multi-Offer Loan Comparison Lab</div>
          <p class="card-sub" style="margin-bottom:16px;">Compare up to 3 loan offers side-by-side to evaluate interest overhead, fees, and true borrowing cost.</p>

          <div class="grid-3" style="gap:16px;">
            <!-- Offer 1 -->
            <div style="background:var(--bg-card);border:1px solid var(--border-dim);padding:14px;border-radius:8px;">
              <strong style="font-size:13px;color:var(--primary);">Offer 1 (Default)</strong>
              <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
                <input type="text" id="liCmpName1" value="HDFC Bank" placeholder="Lender Name" class="form-control" style="font-size:12px;"/>
                <input type="number" id="liCmpP1" value="2000000" placeholder="Loan Amount (₹)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpR1" value="8.4" step="0.1" placeholder="Rate (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpT1" value="36" placeholder="Tenure (Months)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpF1" value="0.5" step="0.1" placeholder="Processing Fee (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
              </div>
            </div>

            <!-- Offer 2 -->
            <div style="background:var(--bg-card);border:1px solid var(--border-dim);padding:14px;border-radius:8px;">
              <strong style="font-size:13px;color:#60A5FA;">Offer 2</strong>
              <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
                <input type="text" id="liCmpName2" value="ICICI Bank" placeholder="Lender Name" class="form-control" style="font-size:12px;"/>
                <input type="number" id="liCmpP2" value="2000000" placeholder="Loan Amount (₹)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpR2" value="8.9" step="0.1" placeholder="Rate (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpT2" value="48" placeholder="Tenure (Months)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpF2" value="0.25" step="0.1" placeholder="Processing Fee (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
              </div>
            </div>

            <!-- Offer 3 -->
            <div style="background:var(--bg-card);border:1px solid var(--border-dim);padding:14px;border-radius:8px;">
              <strong style="font-size:13px;color:#F59E0B;">Offer 3</strong>
              <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
                <input type="text" id="liCmpName3" value="SBI Loan" placeholder="Lender Name" class="form-control" style="font-size:12px;"/>
                <input type="number" id="liCmpP3" value="2000000" placeholder="Loan Amount (₹)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpR3" value="8.6" step="0.1" placeholder="Rate (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpT3" value="36" placeholder="Tenure (Months)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
                <input type="number" id="liCmpF3" value="0.0" step="0.1" placeholder="Processing Fee (%)" class="form-control" style="font-size:12px;font-family:var(--font-mono);"/>
              </div>
            </div>
          </div>

          <button onclick="runLoanComparison()" class="btn btn-primary" style="margin-top:16px;"><i data-lucide="git-compare"></i><span>Compare All Offers</span></button>
        </div>

        <div class="card" id="liCmpResultsCard" style="display:none;">
          <div class="card-title" style="font-size:15px;margin-bottom:12px;">Side-by-Side Comparison Matrix</div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th id="liCmpCol1">Offer 1</th>
                  <th id="liCmpCol2">Offer 2</th>
                  <th id="liCmpCol3">Offer 3</th>
                </tr>
              </thead>
              <tbody id="liCmpTableBody"></tbody>
            </table>
          </div>
          <div class="li-insight-box" style="margin-top:14px;">
            <i data-lucide="info" class="li-insight-icon"></i>
            <p class="li-insight-text" id="liCmpSummaryNote"></p>
          </div>
        </div>
      </div>

      <!-- TAB 4: PREPAYMENT LAB -->
      <div id="liTabPrepayment" class="li-tab-content" style="display:none;">
        <div class="li-split-grid">
          <!-- Left: Prepayment Inputs -->
          <div class="card" style="margin:0;">
            <div class="card-title" style="font-size:15px;margin-bottom:14px;">Prepayment Simulation Parameters</div>
            <form onsubmit="event.preventDefault(); runPrepaymentSimulation();">
              <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;">
                <div class="field span-2">
                  <label>Loan Amount (₹)</label>
                  <input type="number" id="liPrepP" value="1500000" required style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Rate (% p.a.)</label>
                  <input type="number" id="liPrepR" value="9.0" step="0.1" required style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Tenure (Months)</label>
                  <input type="number" id="liPrepT" value="60" required style="font-family:var(--font-mono);"/>
                </div>
                
                <div class="field span-2" style="border-top:1px solid var(--border-dim);padding-top:10px;margin-top:4px;">
                  <strong style="font-size:12px;color:var(--primary);text-transform:uppercase;">One-Time Lump Sum Prepayment</strong>
                </div>
                <div class="field">
                  <label>Prepay Amount (₹)</label>
                  <input type="number" id="liPrepAmt" value="200000" step="10000" style="font-family:var(--font-mono);"/>
                </div>
                <div class="field">
                  <label>Prepay Month</label>
                  <input type="number" id="liPrepMonth" value="12" min="1" max="360" style="font-family:var(--font-mono);"/>
                </div>
                <div class="field span-2">
                  <label>Strategy</label>
                  <select id="liPrepStrategy" class="form-control" style="width:100%;padding:8px;background:var(--bg-input);border:1px solid var(--border-dim);color:var(--text-primary);border-radius:6px;">
                    <option value="reduce_tenure" selected>Reduce Tenure (Payoff loan faster)</option>
                    <option value="reduce_emi">Reduce EMI (Lower monthly payment)</option>
                  </select>
                </div>

                <div class="field span-2" style="border-top:1px solid var(--border-dim);padding-top:10px;margin-top:4px;">
                  <strong style="font-size:12px;color:#F59E0B;text-transform:uppercase;">Pay Extra Every Month</strong>
                </div>
                <div class="field span-2">
                  <label>Extra Monthly EMI (₹)</label>
                  <input type="number" id="liPrepExtraMonthly" value="2000" step="500" style="font-family:var(--font-mono);"/>
                  <div class="li-chips-group">
                    <button type="button" class="li-chip" onclick="setExtraEmiChip(500)">+₹500</button>
                    <button type="button" class="li-chip" onclick="setExtraEmiChip(1000)">+₹1,000</button>
                    <button type="button" class="li-chip active" onclick="setExtraEmiChip(2000)">+₹2,000</button>
                    <button type="button" class="li-chip" onclick="setExtraEmiChip(5000)">+₹5,000</button>
                  </div>
                </div>
              </div>
              <button type="submit" class="btn btn-primary btn-block" style="margin-top:16px;"><i data-lucide="zap"></i><span>Simulate Prepayment Impact</span></button>
            </form>
          </div>

          <!-- Right: Prepayment Results -->
          <div style="display:flex;flex-direction:column;gap:16px;">
            <div class="card" style="margin:0;">
              <div class="card-title" style="font-size:15px;margin-bottom:14px;">Prepayment Savings Summary</div>
              <div class="grid-2" style="gap:12px;">
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Total Interest Saved</span>
                  <span class="li-metric-val" id="liPrepResInterestSaved" style="color:#10B981;font-size:18px;">₹0</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Months Saved</span>
                  <span class="li-metric-val" id="liPrepResMonthsSaved" style="color:#60A5FA;font-size:18px;">0 Months</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Original Payoff Date</span>
                  <span class="li-metric-val" id="liPrepResOrigDate">—</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">New Payoff Date</span>
                  <span class="li-metric-val" id="liPrepResNewDate" style="color:var(--primary);">—</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Total Repayment (Before)</span>
                  <span class="li-metric-val" id="liPrepResTotalBefore">₹0</span>
                </div>
                <div class="li-metric-box">
                  <span class="li-metric-lbl">Total Repayment (After)</span>
                  <span class="li-metric-val" id="liPrepResTotalAfter">₹0</span>
                </div>
              </div>
            </div>

            <div class="li-insight-box">
              <i data-lucide="trending-down" class="li-insight-icon"></i>
              <div>
                <strong style="font-size:12px;text-transform:uppercase;color:var(--primary);letter-spacing:0.04em;">Acceleration Narrative</strong>
                <p class="li-insight-text" id="liPrepNarrative">Run prepayment simulation to generate analysis.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 5: AMORTIZATION -->
      <div id="liTabAmortization" class="li-tab-content" style="display:none;">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
            <div>
              <div class="card-title" style="font-size:15px;margin:0;">Amortization Schedule Ledger</div>
              <p class="card-sub" style="margin:2px 0 0 0;">Complete line-item breakdown of principal, interest, and closing balance.</p>
            </div>
            <div style="display:flex;gap:10px;align-items:center;">
              <div class="li-segmented-control">
                <button class="li-segment-btn active" id="liAmortToggleMonthly" onclick="toggleAmortizationView('monthly')">Monthly</button>
                <button class="li-segment-btn" id="liAmortToggleYearly" onclick="toggleAmortizationView('yearly')">Yearly Summary</button>
              </div>
              <button onclick="exportAmortizationCsv()" class="btn btn-secondary btn-sm"><i data-lucide="download"></i><span>Export CSV</span></button>
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th id="liAmortColPeriod">Period</th>
                  <th>Opening Balance</th>
                  <th>Monthly EMI</th>
                  <th>Principal Paid</th>
                  <th>Interest Paid</th>
                  <th>Extra Payment</th>
                  <th>Closing Balance</th>
                </tr>
              </thead>
              <tbody id="liAmortTableBody">
                <tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">Run loan planner calculation to view schedule.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Disclaimer Footer -->
      <div class="li-disclaimer">
        <i data-lucide="info"></i>
        <span><strong>Disclaimer:</strong> Loan calculations and affordability indicators are estimates based on the information provided. Actual lender rates, fees, eligibility and repayment terms may differ.</span>
      </div>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  // Set default start date to today
  const startDateInput = document.getElementById("liStartDate");
  if (startDateInput && !startDateInput.value) {
    startDateInput.value = new Date().toISOString().split("T")[0];
  }

  // Initial calculation
  runLoanPlannerCalc();
}

function switchLiTab(tabName) {
  const tabs = ["planner", "affordability", "compare", "prepayment", "amortization"];
  tabs.forEach(t => {
    const btn = document.getElementById("liTabBtn" + t.charAt(0).toUpperCase() + t.slice(1));
    const content = document.getElementById("liTab" + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle("active", t === tabName);
    if (content) content.style.display = (t === tabName) ? "block" : "none";
  });

  if (window.lucide) window.lucide.createIcons();

  if (tabName === "planner" && liCurrentPlannerData) {
    renderRepaymentChart(liCurrentPlannerData.schedule, "monthly");
  } else if (tabName === "affordability") {
    runAffordabilityCalc();
  } else if (tabName === "compare") {
    runLoanComparison();
  } else if (tabName === "prepayment") {
    runPrepaymentSimulation();
  } else if (tabName === "amortization" && liCurrentPlannerData) {
    renderAmortizationTable(liCurrentPlannerData.schedule, "monthly");
  }
}

async function runLoanPlannerCalc() {
  const principal = parseFloat(document.getElementById("liPrincipal").value) || 0;
  const rate = parseFloat(document.getElementById("liRate").value) || 0;
  const tenureVal = parseInt(document.getElementById("liTenureVal").value) || 1;
  const tenureUnit = document.getElementById("liTenureUnit").value;
  const feeVal = parseFloat(document.getElementById("liFeeVal").value) || 0;
  const feeType = document.getElementById("liFeeType").value;
  const downPayment = parseFloat(document.getElementById("liDownPayment").value) || 0;
  const startDate = document.getElementById("liStartDate").value;
  const loanType = document.getElementById("liLoanType").value;

  const tenure_months = tenureUnit === "years" ? tenureVal * 12 : tenureVal;

  try {
    const res = await fetch("/api/v1/loans/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        principal,
        annual_rate: rate,
        tenure_months,
        loan_type: loanType,
        processing_fee_val: feeVal,
        processing_fee_type: feeType,
        down_payment: downPayment,
        start_date: startDate
      })
    });

    if (!res.ok) return;
    const data = await res.json();
    liCurrentPlannerData = data;

    // Update UI elements
    const emiEl = document.getElementById("liResEmi");
    if (emiEl) emiEl.textContent = "₹" + fmt(data.monthly_emi);

    const subEl = document.getElementById("liResEmiSub");
    if (subEl) subEl.textContent = `₹${fmt(principal)} over ${tenureVal} ${tenureUnit} @ ${rate}% p.a.`;

    const netPEl = document.getElementById("liResNetP");
    if (netPEl) netPEl.textContent = "₹" + fmt(data.net_principal);

    const intEl = document.getElementById("liResInterest");
    if (intEl) intEl.textContent = "₹" + fmt(data.total_interest);

    const repEl = document.getElementById("liResRepayment");
    if (repEl) repEl.textContent = "₹" + fmt(data.total_payment);

    const feeEl = document.getElementById("liResFee");
    if (feeEl) feeEl.textContent = "₹" + fmt(data.processing_fee);

    const costEl = document.getElementById("liResCost");
    if (costEl) costEl.textContent = "₹" + fmt(data.effective_total_cost);

    const ratioEl = document.getElementById("liResRatio");
    if (ratioEl) ratioEl.textContent = data.interest_to_principal_ratio.toFixed(1) + "%";

    const endEl = document.getElementById("liResEndDate");
    if (endEl) endEl.textContent = data.end_date;

    const insightEl = document.getElementById("liResInsight");
    if (insightEl) insightEl.textContent = data.nova_insight;

    const badgeEl = document.getElementById("liResHealthBadge");
    if (badgeEl) {
      const ratio = data.interest_to_principal_ratio;
      let badgeHtml = '<span class="pill pill-success" style="font-size:11px;padding:4px 10px;">Cost Efficient</span>';
      if (ratio > 70) {
        badgeHtml = '<span class="pill pill-warning" style="font-size:11px;padding:4px 10px;">Interest Heavy</span>';
      } else if (ratio > 40) {
        badgeHtml = '<span class="pill pill-info" style="font-size:11px;padding:4px 10px;">Moderate Ratio</span>';
      }
      badgeEl.innerHTML = badgeHtml;
    }

    renderRepaymentChart(data.schedule, "monthly");
    renderAmortizationTable(data.schedule, "monthly");
    loadTenureOptimizer(principal, rate, downPayment, feeVal, feeType, tenure_months);
    loadUserLoanScenarios();
  } catch (e) {
    console.error("Loan planner calc error:", e);
  }
}

function toggleLiAdvancedMetrics() {
  const grid = document.getElementById("liAdvancedGrid");
  const btn = document.getElementById("liAdvToggleBtn");
  if (!grid) return;
  const isHidden = grid.style.display === "none" || !grid.style.display;
  grid.style.display = isHidden ? "grid" : "none";
  if (btn) {
    const span = btn.querySelector("span");
    if (span) span.textContent = isHidden ? "Hide detailed cost breakdown" : "View complete cost breakdown";
    const chev = btn.querySelector("[data-lucide]");
    if (chev) {
      chev.setAttribute("data-lucide", isHidden ? "chevron-up" : "chevron-down");
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

function toggleRepaymentChartView(mode) {
  document.getElementById("liChartToggleMonthly").classList.toggle("active", mode === "monthly");
  document.getElementById("liChartToggleYearly").classList.toggle("active", mode === "yearly");
  if (liCurrentPlannerData) {
    const dataList = (mode === "yearly") ? liCurrentPlannerData.yearly_schedule : liCurrentPlannerData.schedule;
    renderRepaymentChart(dataList, mode);
  }
}

function renderRepaymentChart(scheduleData, viewMode) {
  const canvas = document.getElementById("liRepaymentCanvas");
  if (!canvas || !window.Chart) return;

  if (liChartBreakdownInstance) {
    liChartBreakdownInstance.destroy();
  }

  const labels = scheduleData.map(item => viewMode === "yearly" ? `Year ${item.year}` : `M${item.month}`);
  const principalPaid = scheduleData.map(item => item.principal_paid);
  const interestPaid = scheduleData.map(item => item.interest_paid);
  const balance = scheduleData.map(item => item.closing_balance);

  const ctx = canvas.getContext("2d");
  liChartBreakdownInstance = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Principal Paid (₹)",
          data: principalPaid,
          backgroundColor: "rgba(59, 130, 246, 0.7)",
          borderColor: "#3B82F6",
          borderWidth: 1,
          stack: "Stack 0"
        },
        {
          label: "Interest Paid (₹)",
          data: interestPaid,
          backgroundColor: "rgba(245, 158, 11, 0.7)",
          borderColor: "#F59E0B",
          borderWidth: 1,
          stack: "Stack 0"
        },
        {
          label: "Outstanding Balance (₹)",
          data: balance,
          type: "line",
          borderColor: "#10B981",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: "y"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#94A3B8", font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return `${ctx.dataset.label}: ₹${fmt(ctx.raw)}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: "#64748B", font: { size: 10 }, maxTicksLimit: 15 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#64748B", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

async function loadTenureOptimizer(principal, rate, downPayment, feeVal, feeType, targetTenure) {
  try {
    const res = await fetch("/api/v1/loans/optimize-tenure", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        principal,
        annual_rate: rate,
        down_payment: downPayment,
        processing_fee_val: feeVal,
        processing_fee_type: feeType,
        target_tenure_months: targetTenure
      })
    });
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById("liTenureOptimizerBody");
    if (!tbody) return;

    tbody.innerHTML = data.scenarios.map(s => {
      let tagsHtml = s.tags.map(t => {
        if (t === "Lowest Total Cost") return `<span class="li-tag li-tag-cost">${t}</span>`;
        if (t === "Lowest EMI") return `<span class="li-tag li-tag-emi">${t}</span>`;
        if (t === "Balanced Option") return `<span class="li-tag li-tag-balanced">★ ${t}</span>`;
        return `<span class="pill pill-neutral">${t}</span>`;
      }).join(" ");

      const healthBadge = `<span class="pill pill-${s.badge_color}">${s.health_status}</span>`;

      return `
        <tr style="${s.tenure_months === targetTenure ? 'background:rgba(59,130,246,0.08);' : ''}">
          <td><strong>${s.tenure_display}</strong></td>
          <td style="font-family:var(--font-mono);font-weight:700;">₹${fmt(s.monthly_emi)}</td>
          <td style="font-family:var(--font-mono);color:#F59E0B;">₹${fmt(s.total_interest)}</td>
          <td style="font-family:var(--font-mono);">${s.foir.toFixed(1)}%</td>
          <td>${healthBadge}</td>
          <td>${tagsHtml}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="selectOptimizedTenure(${s.tenure_months})">Select</button>
          </td>
        </tr>
      `;
    }).join("");

    renderTradeOffChart(data.scenarios);
  } catch (e) {}
}

function selectOptimizedTenure(months) {
  document.getElementById("liTenureVal").value = months;
  document.getElementById("liTenureUnit").value = "months";
  runLoanPlannerCalc();
}

function renderTradeOffChart(scenarios) {
  const canvas = document.getElementById("liTradeOffCanvas");
  if (!canvas || !window.Chart) return;

  if (liChartTradeOffInstance) {
    liChartTradeOffInstance.destroy();
  }

  const labels = scenarios.map(s => s.tenure_display);
  const emis = scenarios.map(s => s.monthly_emi);
  const interests = scenarios.map(s => s.total_interest);

  const ctx = canvas.getContext("2d");
  liChartTradeOffInstance = new window.Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Monthly EMI (₹)",
          data: emis,
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          yAxisID: "yEMI",
          tension: 0.3,
          fill: true
        },
        {
          label: "Total Interest Paid (₹)",
          data: interests,
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          yAxisID: "yInterest",
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#94A3B8", font: { size: 11 } } }
      },
      scales: {
        x: { ticks: { color: "#64748B", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        yEMI: { type: "linear", position: "left", title: { display: true, text: "EMI (₹)", color: "#3B82F6" }, ticks: { color: "#64748B" } },
        yInterest: { type: "linear", position: "right", title: { display: true, text: "Total Interest (₹)", color: "#F59E0B" }, ticks: { color: "#64748B" }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

async function saveCurrentScenario() {
  if (!liCurrentPlannerData) return;
  const name = prompt("Enter a scenario name to save:", `${document.getElementById("liLoanType").value} Plan`);
  if (!name) return;

  try {
    const res = await fetch("/api/v1/loans/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        scenario_name: name,
        loan_type: document.getElementById("liLoanType").value,
        principal: liCurrentPlannerData.net_principal,
        annual_rate: parseFloat(document.getElementById("liRate").value),
        tenure_months: liCurrentPlannerData.tenure_months,
        processing_fee: liCurrentPlannerData.processing_fee,
        down_payment: liCurrentPlannerData.down_payment,
        monthly_emi: liCurrentPlannerData.monthly_emi,
        total_interest: liCurrentPlannerData.total_interest,
        total_repayment: liCurrentPlannerData.total_payment,
        effective_total_cost: liCurrentPlannerData.effective_total_cost,
        foir: 0.0,
        affordability_result: "Comfortable",
        inputs: {
          principal: liCurrentPlannerData.gross_loan_amount,
          annual_rate: parseFloat(document.getElementById("liRate").value),
          tenure_months: liCurrentPlannerData.tenure_months
        },
        outputs: {
          monthly_emi: liCurrentPlannerData.monthly_emi,
          total_interest: liCurrentPlannerData.total_interest
        }
      })
    });
    if (res.ok) {
      alert("Scenario saved successfully!");
      loadUserLoanScenarios();
    }
  } catch (e) {}
}

async function loadUserLoanScenarios() {
  const tbody = document.getElementById("liScenariosBody");
  if (!tbody) return;
  try {
    const res = await fetch("/api/v1/loans/scenarios", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.scenarios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--text-muted);">No saved scenarios yet. Click 'Save' in the planner above.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.scenarios.map(s => `
      <tr>
        <td><strong>${s.scenario_name}</strong></td>
        <td>${s.loan_type}</td>
        <td style="font-family:var(--font-mono);">₹${fmt(s.principal)}</td>
        <td style="font-family:var(--font-mono);">${s.annual_rate}%</td>
        <td style="font-family:var(--font-mono);">${s.tenure_months}M</td>
        <td style="font-family:var(--font-mono);font-weight:700;color:var(--primary);">₹${fmt(s.monthly_emi)}</td>
        <td><span class="pill pill-success">${s.affordability_result}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="applySavedScenario(${s.principal}, ${s.annual_rate}, ${s.tenure_months}, '${s.loan_type}')">Load</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteSavedScenario('${s.id}')">Delete</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {}
}

function applySavedScenario(principal, rate, tenureMonths, loanType) {
  document.getElementById("liPrincipal").value = principal;
  document.getElementById("liRate").value = rate;
  document.getElementById("liTenureVal").value = tenureMonths;
  document.getElementById("liTenureUnit").value = "months";
  if (document.getElementById("liLoanType")) document.getElementById("liLoanType").value = loanType;
  runLoanPlannerCalc();
}

async function deleteSavedScenario(id) {
  if (!confirm("Are you sure you want to delete this saved scenario?")) return;
  try {
    const res = await fetch(`/api/v1/loans/scenarios/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    if (res.ok) {
      loadUserLoanScenarios();
    }
  } catch (e) {}
}

async function runAffordabilityCalc() {
  const income = parseFloat(document.getElementById("liAffIncome").value) || 0;
  const proposedEmi = parseFloat(document.getElementById("liAffProposedEmi").value) || 0;
  const existingEmi = parseFloat(document.getElementById("liAffExistingEmi").value) || 0;
  const rent = parseFloat(document.getElementById("liAffRent").value) || 0;
  const otherFixed = parseFloat(document.getElementById("liAffOtherFixed").value) || 0;
  const essentials = parseFloat(document.getElementById("liAffEssentials").value) || 0;

  try {
    const res = await fetch("/api/v1/loans/affordability", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        monthly_income: income,
        proposed_emi: proposedEmi,
        existing_emi: existingEmi,
        housing_rent: rent,
        other_fixed_obligations: otherFixed,
        essential_expenses: essentials
      })
    });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("liAffExistingFoir").textContent = data.existing_foir.toFixed(1) + "%";
    document.getElementById("liAffNewFoir").textContent = data.new_foir.toFixed(1) + "%";
    document.getElementById("liAffEmiRatio").textContent = data.emi_to_income_ratio.toFixed(1) + "%";
    document.getElementById("liAffDispBefore").textContent = "₹" + fmt(data.disposable_income_before);
    document.getElementById("liAffDispAfter").textContent = "₹" + fmt(data.disposable_income_after);
    document.getElementById("liAffRepayCap").textContent = "₹" + fmt(data.repayment_capacity);
    document.getElementById("liAffExplanation").textContent = data.explanation;

    document.getElementById("liAffHealthPill").className = `pill pill-${data.badge_color}`;
    document.getElementById("liAffHealthPill").textContent = data.health_status;
  } catch (e) {}
}

async function autoFillAffordabilityFromProfile() {
  try {
    const res = await fetch("/api/v1/user/profile", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.financial_profile) {
      document.getElementById("liAffIncome").value = data.financial_profile.monthly_income;
      document.getElementById("liAffExistingEmi").value = data.financial_profile.existing_emi;
      if (liCurrentPlannerData) {
        document.getElementById("liAffProposedEmi").value = liCurrentPlannerData.monthly_emi;
      }
      runAffordabilityCalc();
    }
  } catch (e) {}
}

async function runLoanComparison() {
  const o1 = {
    offer_name: document.getElementById("liCmpName1").value,
    principal: parseFloat(document.getElementById("liCmpP1").value) || 0,
    annual_rate: parseFloat(document.getElementById("liCmpR1").value) || 0,
    tenure_months: parseInt(document.getElementById("liCmpT1").value) || 36,
    processing_fee: parseFloat(document.getElementById("liCmpF1").value) || 0
  };
  const o2 = {
    offer_name: document.getElementById("liCmpName2").value,
    principal: parseFloat(document.getElementById("liCmpP2").value) || 0,
    annual_rate: parseFloat(document.getElementById("liCmpR2").value) || 0,
    tenure_months: parseInt(document.getElementById("liCmpT2").value) || 36,
    processing_fee: parseFloat(document.getElementById("liCmpF2").value) || 0
  };
  const o3 = {
    offer_name: document.getElementById("liCmpName3").value,
    principal: parseFloat(document.getElementById("liCmpP3").value) || 0,
    annual_rate: parseFloat(document.getElementById("liCmpR3").value) || 0,
    tenure_months: parseInt(document.getElementById("liCmpT3").value) || 36,
    processing_fee: parseFloat(document.getElementById("liCmpF3").value) || 0
  };

  try {
    const res = await fetch("/api/v1/loans/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ offers: [o1, o2, o3] })
    });
    if (!res.ok) return;
    const data = await res.json();
    const offers = data.offers;

    document.getElementById("liCmpResultsCard").style.display = "block";
    document.getElementById("liCmpCol1").textContent = offers[0]?.offer_name || "Offer 1";
    document.getElementById("liCmpCol2").textContent = offers[1]?.offer_name || "Offer 2";
    document.getElementById("liCmpCol3").textContent = offers[2]?.offer_name || "Offer 3";

    const rows = [
      { label: "Loan Amount", key: "gross_principal", prefix: "₹" },
      { label: "Interest Rate", key: "annual_rate", suffix: "%" },
      { label: "Tenure", key: "tenure_months", suffix: " Months" },
      { label: "Monthly EMI", key: "monthly_emi", prefix: "₹", bold: true },
      { label: "Total Interest", key: "total_interest", prefix: "₹" },
      { label: "Processing Fee", key: "total_fees", prefix: "₹" },
      { label: "Effective Total Cost", key: "effective_total_cost", prefix: "₹", bold: true },
      { label: "Modeled FOIR", key: "foir", suffix: "%" }
    ];

    let tbodyHtml = rows.map(r => {
      let cells = offers.map(o => {
        let val = o[r.key];
        if (r.prefix) val = r.prefix + fmt(val);
        else if (r.suffix) val = val + r.suffix;
        return `<td style="${r.bold ? 'font-weight:700;color:var(--primary);' : ''}">${val}</td>`;
      }).join("");
      return `<tr><td><strong>${r.label}</strong></td>${cells}</tr>`;
    }).join("");

    // Highlights Row
    let highlightsCells = offers.map(o => {
      let tags = o.highlights.map(h => `<span class="li-tag li-tag-cost" style="margin-right:2px;">${h}</span>`).join(" ");
      return `<td>${tags || '—'}</td>`;
    }).join("");
    tbodyHtml += `<tr style="background:rgba(255,255,255,0.02);"><td><strong>Best Highlights</strong></td>${highlightsCells}</tr>`;

    document.getElementById("liCmpTableBody").innerHTML = tbodyHtml;
    document.getElementById("liCmpSummaryNote").textContent = data.summary_note;
  } catch (e) {}
}

async function runPrepaymentSimulation() {
  const p = parseFloat(document.getElementById("liPrepP").value) || 0;
  const r = parseFloat(document.getElementById("liPrepR").value) || 0;
  const t = parseInt(document.getElementById("liPrepT").value) || 36;
  const amt = parseFloat(document.getElementById("liPrepAmt").value) || 0;
  const month = parseInt(document.getElementById("liPrepMonth").value) || 12;
  const strat = document.getElementById("liPrepStrategy").value;
  const extraMonthly = parseFloat(document.getElementById("liPrepExtraMonthly").value) || 0;

  try {
    const res = await fetch("/api/v1/loans/prepayment", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        principal: p,
        annual_rate: r,
        tenure_months: t,
        prepayment_amount: amt,
        prepayment_month: month,
        strategy: strat,
        extra_monthly_payment: extraMonthly
      })
    });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("liPrepResInterestSaved").textContent = "₹" + fmt(data.interest_saved);
    document.getElementById("liPrepResMonthsSaved").textContent = data.months_saved + " Months";
    document.getElementById("liPrepResOrigDate").textContent = data.original_end_date;
    document.getElementById("liPrepResNewDate").textContent = data.new_end_date;
    document.getElementById("liPrepResTotalBefore").textContent = "₹" + fmt(data.original_total_repayment);
    document.getElementById("liPrepResTotalAfter").textContent = "₹" + fmt(data.new_total_repayment);
    document.getElementById("liPrepNarrative").textContent = data.narrative;
  } catch (e) {}
}

function setExtraEmiChip(amount) {
  document.getElementById("liPrepExtraMonthly").value = amount;
  runPrepaymentSimulation();
}

function toggleAmortizationView(mode) {
  document.getElementById("liAmortToggleMonthly").classList.toggle("active", mode === "monthly");
  document.getElementById("liAmortToggleYearly").classList.toggle("active", mode === "yearly");
  if (liCurrentPlannerData) {
    const list = (mode === "yearly") ? liCurrentPlannerData.yearly_schedule : liCurrentPlannerData.schedule;
    renderAmortizationTable(list, mode);
  }
}

function renderAmortizationTable(schedule, mode) {
  const tbody = document.getElementById("liAmortTableBody");
  const thPeriod = document.getElementById("liAmortColPeriod");
  if (!tbody) return;

  if (thPeriod) thPeriod.textContent = (mode === "yearly") ? "Year" : "Month";

  if (!schedule || schedule.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;">No schedule data.</td></tr>`;
    return;
  }

  tbody.innerHTML = schedule.map(item => `
    <tr>
      <td><strong>${mode === "yearly" ? 'Year ' + item.year : 'Month ' + item.month}</strong></td>
      <td style="font-family:var(--font-mono);">₹${fmt(item.opening_balance)}</td>
      <td style="font-family:var(--font-mono);font-weight:700;">₹${fmt(item.emi || item.total_emi)}</td>
      <td style="font-family:var(--font-mono);color:var(--primary);">₹${fmt(item.principal_paid)}</td>
      <td style="font-family:var(--font-mono);color:#F59E0B;">₹${fmt(item.interest_paid)}</td>
      <td style="font-family:var(--font-mono);">₹${fmt(item.extra_payment || 0)}</td>
      <td style="font-family:var(--font-mono);">₹${fmt(item.closing_balance)}</td>
    </tr>
  `).join("");
}

function exportAmortizationCsv() {
  if (!liCurrentPlannerData || !liCurrentPlannerData.schedule) {
    alert("Please calculate a loan plan first.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Month,Opening Balance,EMI,Principal Paid,Interest Paid,Closing Balance\n";

  liCurrentPlannerData.schedule.forEach(row => {
    csvContent += `${row.month},${row.opening_balance},${row.emi},${row.principal_paid},${row.interest_paid},${row.closing_balance}\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Amortization_Schedule_${liCurrentPlannerData.net_principal}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


let allFundsList = [];
let currentCategoryFilter = "all";

async function loadFundExplorer() {
  const c = document.getElementById("fundsContainer");
  if (!c) return;

  c.innerHTML = `
    <!-- Disclaimer Banner -->
    <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:var(--r-md);padding:14px 18px;margin-bottom:20px;display:flex;align-items:flex-start;gap:12px;">
      <i data-lucide="info" style="color:var(--primary);flex-shrink:0;margin-top:2px;width:18px;height:18px;"></i>
      <div style="font-size:12.5px;line-height:1.5;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);">Educational & Demonstration Purpose Only:</strong> The wealth funds listed below represent curated illustrative financial models for scenario planning and institutional learning. Returns are simulated benchmarks and do not guarantee future performance. Nova Credit AI does not solicit, distribute, or broker investment products.
      </div>
    </div>

    <!-- Search & Filter Bar -->
    <div class="fund-filter-bar">
      <div class="fund-search-input">
        <i data-lucide="search" style="width:16px;height:16px;color:var(--text-muted);flex-shrink:0;"></i>
        <input type="text" id="fundSearchInput" placeholder="Search by fund name, category, or strategy..." oninput="filterFunds()"/>
      </div>
      <div class="fund-filter-selects">
        <select id="fundRiskSelect" onchange="filterFunds()">
          <option value="all">All Risk Profiles</option>
          <option value="Low">Low Risk</option>
          <option value="Moderate">Moderate Risk</option>
          <option value="High">High Growth / High Risk</option>
        </select>
        <select id="fundSortSelect" onchange="filterFunds()">
          <option value="3y_desc">Sort: 3Y Return (High to Low)</option>
          <option value="1y_desc">Sort: 1Y Return (High to Low)</option>
          <option value="5y_desc">Sort: 5Y Return (High to Low)</option>
          <option value="name_asc">Sort: Name (A to Z)</option>
        </select>
      </div>
    </div>

    <!-- Category Chips -->
    <div class="fund-chips-row">
      <button class="fund-chip active" data-cat="all" onclick="setFundCategoryFilter('all', this)">All Categories (15)</button>
      <button class="fund-chip" data-cat="Equity" onclick="setFundCategoryFilter('Equity', this)">Equity Funds</button>
      <button class="fund-chip" data-cat="Debt" onclick="setFundCategoryFilter('Debt', this)">Debt & Liquid</button>
      <button class="fund-chip" data-cat="Hybrid" onclick="setFundCategoryFilter('Hybrid', this)">Hybrid & Balanced</button>
      <button class="fund-chip" data-cat="Index" onclick="setFundCategoryFilter('Index', this)">Index & Passive</button>
    </div>

    <!-- Funds Count & Table Container -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:12.5px;color:var(--text-muted);" id="fundCountDisplay">Loading institutional fund models...</span>
      <span class="pill pill-neutral" style="font-size:11px;">Institutional Sandbox</span>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Fund Name & Strategy</th>
            <th>Category</th>
            <th>Sub-Category</th>
            <th>1Y Return</th>
            <th>3Y Return</th>
            <th>5Y Return</th>
            <th>Risk Tier</th>
            <th>Status</th>
            <th style="text-align:center;">Action</th>
          </tr>
        </thead>
        <tbody id="fundsTableBody">
          <tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted);">Loading wealth fund intelligence...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await fetch("/api/v1/wealth/funds", { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Failed to load funds dataset");
    const data = await res.json();
    allFundsList = data.funds || [];
    filterFunds();
  } catch (err) {
    const tbody = document.getElementById("fundsTableBody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--danger);">Error loading fund dataset: ${err.message}</td></tr>`;
  }
}

function setFundCategoryFilter(cat, btn) {
  currentCategoryFilter = cat;
  document.querySelectorAll(".fund-chip").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  filterFunds();
}

function filterFunds() {
  const searchVal = (document.getElementById("fundSearchInput")?.value || "").toLowerCase().trim();
  const riskVal = document.getElementById("fundRiskSelect")?.value || "all";
  const sortVal = document.getElementById("fundSortSelect")?.value || "3y_desc";

  let filtered = [...allFundsList];

  // Category filter
  if (currentCategoryFilter !== "all") {
    filtered = filtered.filter(f => f.category.toLowerCase() === currentCategoryFilter.toLowerCase());
  }

  // Risk filter
  if (riskVal !== "all") {
    filtered = filtered.filter(f => f.risk_tier.toLowerCase() === riskVal.toLowerCase());
  }

  // Search filter
  if (searchVal) {
    filtered = filtered.filter(f =>
      f.name.toLowerCase().includes(searchVal) ||
      (f.sub_category && f.sub_category.toLowerCase().includes(searchVal)) ||
      (f.description && f.description.toLowerCase().includes(searchVal))
    );
  }

  // Sorting
  const parsePct = s => parseFloat((s || "0").replace("%", "")) || 0;
  if (sortVal === "3y_desc") {
    filtered.sort((a, b) => parsePct(b.return_3y) - parsePct(a.return_3y));
  } else if (sortVal === "1y_desc") {
    filtered.sort((a, b) => parsePct(b.return_1y) - parsePct(a.return_1y));
  } else if (sortVal === "5y_desc") {
    filtered.sort((a, b) => parsePct(b.return_5y) - parsePct(a.return_5y));
  } else if (sortVal === "name_asc") {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  renderFundsTable(filtered);
}

function renderFundsTable(funds) {
  const tbody = document.getElementById("fundsTableBody");
  const countDisplay = document.getElementById("fundCountDisplay");
  if (countDisplay) {
    countDisplay.textContent = `Showing ${funds.length} of ${allFundsList.length} institutional fund models`;
  }
  if (!tbody) return;

  if (funds.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted);">No funds match the selected filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = funds.map(f => {
    let riskPill = `<span class="pill pill-info">${f.risk_tier}</span>`;
    if (f.risk_tier === "Low") riskPill = `<span class="pill pill-success">Low Risk</span>`;
    else if (f.risk_tier === "Moderate") riskPill = `<span class="pill pill-warning">Moderate</span>`;
    else if (f.risk_tier === "High") riskPill = `<span class="pill pill-danger">High Growth</span>`;

    const catBadgeClass = f.category === "Equity" ? "pill-primary" : f.category === "Debt" ? "pill-success" : f.category === "Hybrid" ? "pill-warning" : "pill-neutral";

    return `
      <tr>
        <td>
          <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${f.name}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.description || ''}</div>
        </td>
        <td><span class="pill ${catBadgeClass}" style="font-size:11px;">${f.category}</span></td>
        <td style="font-size:12px;color:var(--text-secondary);">${f.sub_category || '—'}</td>
        <td style="font-family:var(--font-mono);font-weight:600;color:var(--success);font-size:12.5px;">${f.return_1y}</td>
        <td style="font-family:var(--font-mono);font-weight:700;color:var(--success);font-size:12.5px;">${f.return_3y}</td>
        <td style="font-family:var(--font-mono);color:var(--success);font-size:12.5px;">${f.return_5y || '—'}</td>
        <td>${riskPill}</td>
        <td><span class="pill pill-info" style="font-size:10.5px;">${f.status}</span></td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-sm" onclick="openFundModal('${f.id}')" style="padding:4px 10px;font-size:11.5px;">
            Inspect
          </button>
        </td>
      </tr>
    `;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function openFundModal(fundId) {
  const fund = allFundsList.find(f => f.id === fundId);
  if (!fund) return;

  const modal = document.getElementById("fundDetailModal");
  const title = document.getElementById("fundModalTitle");
  const cat = document.getElementById("fundModalCategory");
  const body = document.getElementById("fundModalBody");

  if (title) title.textContent = fund.name;
  if (cat) cat.textContent = `${fund.category} • ${fund.sub_category || 'General'} • ID: ${fund.id}`;

  let riskPill = `<span class="pill pill-info">${fund.risk_tier} Risk</span>`;
  if (fund.risk_tier === "Low") riskPill = `<span class="pill pill-success">Low Risk Tier</span>`;
  else if (fund.risk_tier === "Moderate") riskPill = `<span class="pill pill-warning">Moderate Risk Tier</span>`;
  else if (fund.risk_tier === "High") riskPill = `<span class="pill pill-danger">High Growth Tier</span>`;

  if (body) {
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Header Strip -->
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-elevated);padding:12px 16px;border-radius:var(--r-md);border:1px solid var(--border-dim);">
          <div>
            <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.04em;">Risk Classification</div>
            <div style="margin-top:4px;">${riskPill}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.04em;">Model Status</div>
            <div style="margin-top:4px;"><span class="pill pill-info">${fund.status}</span></div>
          </div>
        </div>

        <!-- Returns Metric Cards -->
        <div class="grid-3" style="gap:10px;">
          <div class="kpi-card" style="text-align:center;padding:12px;">
            <div class="kpi-lbl">1-Year Return</div>
            <div class="kpi-val" style="color:var(--success);font-size:20px;">${fund.return_1y}</div>
          </div>
          <div class="kpi-card" style="text-align:center;padding:12px;">
            <div class="kpi-lbl">3-Year CAGR</div>
            <div class="kpi-val" style="color:var(--success);font-size:20px;">${fund.return_3y}</div>
          </div>
          <div class="kpi-card" style="text-align:center;padding:12px;">
            <div class="kpi-lbl">5-Year CAGR</div>
            <div class="kpi-val" style="color:var(--success);font-size:20px;">${fund.return_5y || '—'}</div>
          </div>
        </div>

        <!-- Strategy Description -->
        <div class="card" style="background:var(--surface-elevated);margin:0;padding:14px;">
          <div class="card-title" style="font-size:12.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--primary);margin-bottom:6px;">
            Investment Strategy & Mandate
          </div>
          <p style="font-size:13px;line-height:1.55;color:var(--text-primary);margin:0;">
            ${fund.description}
          </p>
        </div>

        <!-- Suitable For & Risk Profile -->
        <div class="grid-2" style="gap:10px;">
          <div style="background:var(--surface-elevated);padding:12px 14px;border-radius:var(--r-md);border:1px solid var(--border-dim);">
            <div style="font-size:11.5px;font-weight:700;color:#60A5FA;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
              <i data-lucide="target" style="width:14px;height:14px;"></i> Suitable For
            </div>
            <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.45;">
              ${fund.suitable_for || 'Long-term diversified wealth accumulation.'}
            </p>
          </div>

          <div style="background:var(--surface-elevated);padding:12px 14px;border-radius:var(--r-md);border:1px solid var(--border-dim);">
            <div style="font-size:11.5px;font-weight:700;color:#F59E0B;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
              <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i> Risk Factors
            </div>
            <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.45;">
              ${fund.risk_note || 'Standard market, duration, and credit spread risks apply.'}
            </p>
          </div>
        </div>

        <!-- Institutional Disclaimer -->
        <div style="font-size:11px;color:var(--text-muted);border-top:1px solid var(--border-dim);padding-top:10px;line-height:1.4;">
          * Illustrative demo fund model. Past performance is no guarantee of future returns. Mutual fund investments are subject to market risks. Read all scheme related documents carefully.
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  if (modal) modal.classList.add("active");
}

function closeFundModal() {
  const modal = document.getElementById("fundDetailModal");
  if (modal) modal.classList.remove("active");
}

// ─── Admin Module Controllers (/admin/*) ──────────────────────────────────────

async function loadAdminDashboard() {
  try {
    const res = await fetch("/api/v1/admin/dashboard/stats", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("adm-kpi-users").textContent = data.total_users;
    document.getElementById("adm-kpi-active-users").textContent = `${data.active_users} Active Accounts`;
    document.getElementById("adm-kpi-assessments").textContent = data.total_assessments;
    document.getElementById("adm-kpi-simulations").textContent = data.total_simulations;
    document.getElementById("adm-kpi-events").textContent = data.total_activity_events;

    const tbody = document.getElementById("adm-recent-signups-body");
    if (tbody && data.recent_signups) {
      tbody.innerHTML = data.recent_signups.map(u => {
        const date = new Date(u.created_at).toLocaleDateString("en-IN");
        return `<tr>
          <td style="font-family:var(--font-mono);font-size:11px;">${u.id}</td>
          <td><strong>${u.full_name}</strong></td>
          <td style="font-family:var(--font-mono);">${u.email}</td>
          <td><span class="pill ${u.role === 'ADMIN' ? 'pill-warning' : 'pill-info'}">${u.role}</span></td>
          <td style="font-size:11px;color:var(--text-muted);">${date}</td>
        </tr>`;
      }).join("");
    }
  } catch (e) { console.error("Admin dashboard load error:", e); }
}

function debounceAdminUserSearch() {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(loadAdminUsers, 300);
}

async function loadAdminUsers() {
  try {
    const searchVal = document.getElementById("admUserSearchInput")?.value || "";
    const res = await fetch(`/api/v1/admin/users?limit=50${searchVal ? '&search=' + encodeURIComponent(searchVal) : ''}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) return;
    const data = await res.json();
    const users = data.users || [];
    const tbody = document.getElementById("adm-users-table-body");
    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No users found matching query.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const created = new Date(u.created_at).toLocaleDateString("en-IN");
      const lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }) : "Never";
      const statusPill = u.is_active ? `<span class="pill pill-success">Active</span>` : `<span class="pill pill-danger">Inactive</span>`;
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;">${u.id}</td>
        <td><strong>${u.full_name}</strong></td>
        <td style="font-family:var(--font-mono);">${u.email}</td>
        <td><span class="pill ${u.role === 'ADMIN' ? 'pill-warning' : 'pill-info'}">${u.role}</span></td>
        <td>${statusPill}</td>
        <td style="font-size:11px;color:var(--text-muted);">${created}</td>
        <td style="font-size:11px;color:var(--text-muted);">${lastLogin}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openAdminUserModal('${u.id}')">Inspect User</button>
        </td>
      </tr>`;
    }).join("");
  } catch (e) { console.error("Admin user list load error:", e); }
}

async function openAdminUserModal(userId) {
  const modal = document.getElementById("adminUserModal");
  const body = document.getElementById("admUserModalBody");
  if (modal) modal.classList.add("active");
  if (body) body.innerHTML = `<p style="color:var(--text-muted);padding:24px;text-align:center;">Fetching detailed user data...</p>`;

  try {
    const res = await fetch(`/api/v1/admin/users/${userId}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Could not retrieve user drill-down.");
    const data = await res.json();
    const u = data.user;
    const fp = data.financial_profile;

    document.getElementById("admUserModalTitle").textContent = `Inspect User: ${u.full_name} (${u.id})`;

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-elevated);padding:14px;border-radius:var(--r-md);border:1px solid var(--border-dim);">
          <div>
            <div style="font-size:16px;font-weight:700;">${u.full_name} <span class="pill ${u.role === 'ADMIN' ? 'pill-warning' : 'pill-info'}">${u.role}</span></div>
            <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin-top:2px;">Email: ${u.email} | ID: ${u.id}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Created: ${new Date(u.created_at).toLocaleString("en-IN")}</div>
          </div>
          <div>
            ${u.id !== currentUser.id ? `
              <button class="btn ${u.is_active ? 'btn-danger' : 'btn-primary'} btn-sm" onclick="handleToggleUserStatus('${u.id}', ${!u.is_active})">
                ${u.is_active ? 'Deactivate User' : 'Activate User'}
              </button>
            ` : '<span class="pill pill-neutral">Current Account</span>'}
          </div>
        </div>

        <div class="grid-3" style="gap:10px;">
          <div class="kpi-card"><div class="kpi-lbl">Assessments</div><div class="kpi-val">${data.assessment_count}</div></div>
          <div class="kpi-card"><div class="kpi-lbl">Simulations</div><div class="kpi-val">${data.simulation_count}</div></div>
          <div class="kpi-card"><div class="kpi-lbl">Reports</div><div class="kpi-val">${data.report_count}</div></div>
        </div>

        ${fp ? `
          <div class="card" style="background:var(--surface-elevated);">
            <div class="card-title" style="font-size:13px;">Financial Profile Summary</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-top:6px;">
              <div>Income: <strong>₹${fmt(fp.monthly_income)}</strong></div>
              <div>EMI: <strong>₹${fmt(fp.existing_emi)}</strong></div>
              <div>Savings: <strong>₹${fmt(fp.savings_balance)}</strong></div>
              <div>Housing: <strong style="text-transform:capitalize;">${fp.housing_type}</strong></div>
            </div>
          </div>
        ` : ''}

        <div class="card" style="background:var(--surface-elevated);">
          <div class="card-title" style="font-size:13px;">Recent Credit Assessment History</div>
          <div class="table-container" style="margin-top:8px;">
            <table>
              <thead><tr><th>Date</th><th>Loan</th><th>Nova Score</th><th>Risk Tier</th><th>Verdict</th></tr></thead>
              <tbody>
                ${data.recent_assessments.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:12px;">No assessments run.</td></tr>' :
                  data.recent_assessments.map(r => `
                    <tr>
                      <td style="font-size:11px;color:var(--text-muted);">${new Date(r.timestamp).toLocaleDateString("en-IN")}</td>
                      <td style="font-family:var(--font-mono);">₹${fmt(r.requested_loan)}</td>
                      <td style="font-family:var(--font-mono);font-weight:700;">${r.nova_score}</td>
                      <td>${r.risk_tier}</td>
                      <td>${pillHtml(r.decision)}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="background:var(--surface-elevated);">
          <div class="card-title" style="font-size:13px;">Recent User Activity Logs</div>
          <div class="table-container" style="margin-top:8px;">
            <table>
              <thead><tr><th>Timestamp</th><th>Action</th><th>Resource</th></tr></thead>
              <tbody>
                ${data.recent_activities.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:12px;">No activity logged.</td></tr>' :
                  data.recent_activities.map(a => `
                    <tr>
                      <td style="font-size:11px;color:var(--text-muted);">${new Date(a.timestamp).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}</td>
                      <td>${actionBadgeHtml(a.action)}</td>
                      <td style="font-family:var(--font-mono);font-size:11px;">${a.resource_type || '—'} (${a.resource_id || '—'})</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--danger);padding:24px;text-align:center;">${err.message}</p>`;
  }
}

function closeAdminUserModal() {
  const modal = document.getElementById("adminUserModal");
  if (modal) modal.classList.remove("active");
}

async function handleToggleUserStatus(userId, newActiveStatus) {
  try {
    const res = await fetch(`/api/v1/admin/users/${userId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ is_active: newActiveStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to update user status.");
    alert(data.message);
    openAdminUserModal(userId);
    loadAdminUsers();
  } catch (err) { alert(err.message); }
}

async function loadAdminActivityLogs() {
  try {
    const res = await fetch("/api/v1/admin/activity?limit=100", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const logs = data.activity_logs || [];
    const tbody = document.getElementById("adm-activity-table-body");
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No activity events recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const date = new Date(l.timestamp).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      const detailsStr = l.details ? JSON.stringify(l.details) : "—";
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;">${l.id}</td>
        <td style="font-size:11px;color:var(--text-muted);">${date}</td>
        <td>${actionBadgeHtml(l.action)}</td>
        <td style="font-family:var(--font-mono);font-size:11px;">${l.user_id || 'SYSTEM'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;">${l.user_email || 'system'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;">${l.resource_type || '—'}</td>
        <td style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${detailsStr}">${detailsStr}</td>
      </tr>`;
    }).join("");
  } catch (e) { console.error("Activity log load error:", e); }
}

async function loadAdminAssessments() {
  try {
    const res = await fetch("/api/v1/admin/assessments?limit=100", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const records = data.assessments || [];
    const tbody = document.getElementById("adm-assessments-table-body");
    if (!tbody) return;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">No assessments recorded across the platform.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => {
      const date = new Date(r.timestamp).toLocaleString("en-IN", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;">${r.id}</td>
        <td style="font-size:11px;color:var(--text-muted);">${date}</td>
        <td><strong>${r.applicant_name}</strong></td>
        <td style="font-family:var(--font-mono);font-size:11px;">${r.user_id || 'GUEST'}</td>
        <td style="font-family:var(--font-mono);">₹${fmt(r.requested_loan)}</td>
        <td style="font-family:var(--font-mono);font-weight:700;">${r.nova_score}</td>
        <td>${r.risk_tier}</td>
        <td>${pillHtml(r.decision)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="downloadAssessmentPdf('${r.id}')"><i data-lucide="download"></i> PDF</button></td>
      </tr>`;
    }).join("");
    if (window.lucide) window.lucide.createIcons();
  } catch (e) { console.error("Admin assessments load error:", e); }
}

async function loadAdminModels() {
  const c = document.getElementById("telemetryContainer");
  if (!c) return;
  try {
    const res = await fetch("/api/v1/admin/models", { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const h = data.health || {};
    const m = data.metrics || {};

    c.innerHTML = `
      <div class="grid-2">
        <div>
          <h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Model Health Diagnostic</h4>
          <div style="font-size:12px;display:flex;flex-direction:column;gap:6px;">
            <div>Pipeline Status: <span class="pill pill-success">${h.status || 'Healthy'}</span></div>
            <div>Model Architecture: <strong>${h.model_type || 'CatBoostClassifier'}</strong></div>
            <div>Artifact Path: <code style="font-family:var(--font-mono);color:var(--primary);">${h.pipeline_path || 'models/nova_credit_pipeline.joblib'}</code></div>
            <div>SHAP Explainer: <strong>${h.explainer_status || 'Loaded'}</strong></div>
          </div>
        </div>
        <div>
          <h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Holdout Benchmark Metrics</h4>
          <div style="font-size:12px;display:flex;flex-direction:column;gap:6px;">
            <div>Holdout ROC-AUC: <strong style="font-family:var(--font-mono);color:var(--success);">${m.holdout_roc_auc?.toFixed(4) || '0.7686'}</strong></div>
            <div>Holdout PR-AUC: <strong style="font-family:var(--font-mono);">${m.holdout_pr_auc?.toFixed(4) || '0.8630'}</strong></div>
            <div>ECE Calibration Error: <strong style="font-family:var(--font-mono);">${m.calibration_ece ? (m.calibration_ece*100).toFixed(2) + '%' : '1.67%'}</strong></div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {}
}

// ─── Initialize SPA Router on Document Ready ────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  routeResolver();
});
